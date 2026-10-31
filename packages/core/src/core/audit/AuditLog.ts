import * as path from 'path';
import { AHI_DIR } from '../../shared/constants';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';

/**
 * Değiştirildiği anlaşılabilen denetim günlüğü.
 *
 * Her kayıt bir öncekinin hash'ini ve kendi hash'ini saklar; bir zincir
 * oluşur. Ortadaki bir kaydı düzenlemek ya da silmek doğrulamayı bozar,
 * böylece ele geçirilmiş bir çalışma alanı geçmişini iz bırakmadan
 * yeniden yazamaz.
 *
 * Zincir bir imza değildir: makineyi kontrol eden saldırgan tüm zinciri
 * yeniden hesaplayabilir. Gündelik düzenlemelere ve kazara bozulmaya karşı
 * korur; günlük başka bir yere kopyalandığında ya da önceki uç hash ile
 * karşılaştırıldığında kasıtlı müdahaleyi belirginleştirir.
 */

export const AUDIT_FILE_NAME = 'audit.log';
export const GENESIS_HASH = '0'.repeat(64);

export interface AuditEntryInput {
  decision: string;
  tool: string;
  /** Önceden maskelenmiş, boyutu sınırlandırılmış argüman özeti. */
  args: string;
  timestamp?: string;
}

export interface AuditEntry extends AuditEntryInput {
  timestamp: string;
  prevHash: string;
  hash: string;
}

export interface AuditVerifyResult {
  ok: boolean;
  entries: number;
  legacyEntries: number;
  /** Doğrulamada başarısız olan ilk kaydın sıfır tabanlı satır indeksi. */
  brokenAt?: number;
  message: string;
  headHash?: string;
}

export function auditFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, AHI_DIR, AUDIT_FILE_NAME);
}

function computeHash(entry: Omit<AuditEntry, 'hash'>): string {
  // Hash'in her koşuda ve platformda aynı çıkması için sabit alan sırası.
  const payload = [entry.timestamp, entry.decision, entry.tool, entry.args, entry.prevHash].join('\u0000');
  return createHash('sha256').update(payload, 'utf-8').digest('hex');
}

/**
 * Eklemeleri dosya başına sıraya koyar; böylece iki eşzamanlı ajan aynı
 * `prevHash` ile iki kayıt üretemez.
 */
const writeQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  // Zinciri ayakta tut ama bir hatanın sonraki yazımları bozmasına izin verme.
  writeQueues.set(
    key,
    next.catch(() => undefined)
  );
  return next;
}

async function readEntries(filePath: string): Promise<{ entries: AuditEntry[]; malformed: number }> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    // Henüz denetim günlüğü yok: boş günlük doğrulamadan geçmeli.
    return { entries: [], malformed: 0 };
  }

  const entries: AuditEntry[] = [];
  let malformed = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as AuditEntry).hash === 'string' &&
        typeof (parsed as AuditEntry).prevHash === 'string'
      ) {
        entries.push(parsed as AuditEntry);
      } else {
        malformed++;
      }
    } catch {
      // Tek bozuk satır zincirin geri kalanını geçersiz kılmamalı.
      malformed++;
    }
  }
  return { entries, malformed };
}

export class AuditLog {
  /**
   * Bir kayıt ekler ve saklanan kaydı döndürür. Yalnızca dosya sistemi
   * hatalarında istisna fırlatır; gösterip göstermemeye çağıran karar verir.
   */
  public static async append(workspaceRoot: string, input: AuditEntryInput): Promise<AuditEntry> {
    const filePath = auditFilePath(workspaceRoot);
    return enqueue(filePath, async () => {
      const { entries } = await readEntries(filePath);
      // Zinciri son geçerli kayıttan sürdür. Eski ya da bozuk satırlar atlanır;
      // verify() bunları ayrıca bildirir, böylece boşluk görünür kalır.
      const last = entries[entries.length - 1];
      const prevHash = last?.hash || GENESIS_HASH;

      const base: Omit<AuditEntry, 'hash'> = {
        timestamp: input.timestamp || new Date().toISOString(),
        decision: input.decision,
        tool: input.tool,
        args: input.args,
        prevHash
      };
      const entry: AuditEntry = { ...base, hash: computeHash(base) };

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf-8', mode: 0o600 });
      return entry;
    });
  }

  /**
   * Tüm zinciri doğrular. Eski (hash öncesi) satırlar ayrı sayılır:
   * doğrulanamazlar ama günlüğü başarısız yapmazlar, çünkü bu biçimden
   * önce yazılmışlardır.
   */
  public static async verify(workspaceRoot: string): Promise<AuditVerifyResult> {
    const filePath = auditFilePath(workspaceRoot);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch {
      // Günlük dosyasının olmaması geçerli bir boş durumdur, doğrulama hatası değil.
      return { ok: true, entries: 0, legacyEntries: 0, message: 'No audit log yet.' };
    }

    const lines = raw.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return { ok: true, entries: 0, legacyEntries: 0, message: 'Audit log is empty.' };
    }

    let expectedPrev = GENESIS_HASH;
    let verified = 0;
    let legacy = 0;
    let headHash: string | undefined;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Eski sekme ayraçlı biçim: zaman damgası \t karar \t araç \t argümanlar
        if (line.includes('\t')) {
          legacy++;
          continue;
        }
        return {
          ok: false,
          entries: verified,
          legacyEntries: legacy,
          brokenAt: index,
          message: `Line ${index + 1} is not valid JSON; the log may have been edited.`
        };
      }

      const entry = parsed as Partial<AuditEntry>;
      if (
        typeof entry.hash !== 'string' ||
        typeof entry.prevHash !== 'string' ||
        typeof entry.timestamp !== 'string' ||
        typeof entry.decision !== 'string' ||
        typeof entry.tool !== 'string' ||
        typeof entry.args !== 'string'
      ) {
        return {
          ok: false,
          entries: verified,
          legacyEntries: legacy,
          brokenAt: index,
          message: `Line ${index + 1} is missing required fields.`
        };
      }

      const recomputed = computeHash({
        timestamp: entry.timestamp,
        decision: entry.decision,
        tool: entry.tool,
        args: entry.args,
        prevHash: entry.prevHash
      });
      if (recomputed !== entry.hash) {
        return {
          ok: false,
          entries: verified,
          legacyEntries: legacy,
          brokenAt: index,
          message: `Hash mismatch at line ${index + 1}: the entry was modified after it was written.`
        };
      }

      if (entry.prevHash !== expectedPrev) {
        return {
          ok: false,
          entries: verified,
          legacyEntries: legacy,
          brokenAt: index,
          message: `Chain break at line ${index + 1}: previous hash does not match (entry removed or reordered).`
        };
      }

      expectedPrev = entry.hash;
      headHash = entry.hash;
      verified++;
    }

    const legacyNote =
      legacy > 0 ? ` ${legacy} legacy entry(ies) predating the hash chain were skipped.` : '';
    return {
      ok: true,
      entries: verified,
      legacyEntries: legacy,
      message: `Audit chain verified: ${verified} entry(ies).${legacyNote}`,
      headHash
    };
  }
}
