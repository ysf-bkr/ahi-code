/**
 * Çağrı haritasının kalıcı depolaması.
 *
 * Dosya `.ahi/callgraph.json` altında tek parça tutulur. Yazma atomiktir
 * (geçici dosya + yer değiştirme), böylece eklenti yarıda kapanırsa bozuk
 * dosya kalmaz. Biçim sürümü uyuşmazsa harita sessizce yok sayılır ve yeniden
 * üretilir.
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import { CallGraphDocument, CallGraphMeta } from './types';
import { AHI_DIR } from '../../shared/constants';

/** Diskteki biçim sürümü. Uyumsuz kayıt yeniden üretilir. */
export const CALLGRAPH_VERSION = 1;

/** Dosya adı; `.ahi` altında tutulur. */
export const CALLGRAPH_FILENAME = 'callgraph.json';

/** Yazma sırasında kullanılan geçici dosya eki. */
const TEMP_SUFFIX = '.tmp';

/**
 * Süreç içi yazma kilidi.
 *
 * Aynı haritayı iki farklı dosya güncellemesi eşzamanlı yazarsa son yazan
 * diğerinin değişikliğini ezerdi. Tüm yazımlar bu kuyruktan geçer.
 */
let writeQueue: Promise<void> = Promise.resolve();

/** Kök başına harita yolu. */
export function callGraphPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, AHI_DIR, CALLGRAPH_FILENAME);
}

/** Boş bir harita üretir. */
export function emptyDocument(workspaceRoot: string): CallGraphDocument {
  const now = Date.now();
  const meta: CallGraphMeta = {
    version: CALLGRAPH_VERSION,
    root: workspaceRoot,
    createdAt: now,
    updatedAt: now,
    languageServers: [],
    nodeCount: 0,
    edgeCount: 0,
    fileCount: 0,
    incompleteFiles: 0
  };
  return { meta, nodes: [], edges: [], files: {} };
}

/**
 * Diskteki haritayı okur. Dosya yoksa, bozuksa ya da sürüm uyumsuzsa
 * `undefined` döner; çağıran temiz bir tarama başlatır.
 */
export async function loadCallGraph(workspaceRoot: string): Promise<CallGraphDocument | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(callGraphPath(workspaceRoot), 'utf-8');
  } catch {
    return undefined; // Dosya yok: henüz üretilmemiş.
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined; // Bozuk JSON: yeniden üretilecek.
  }

  if (!isCallGraphDocument(parsed)) return undefined;
  if (parsed.meta.version !== CALLGRAPH_VERSION) return undefined;
  return parsed;
}

/**
 * Haritayı atomik olarak yazar.
 *
 * Önce `callgraph.json.tmp` yazılır, sonra `rename` ile yer değiştirilir;
 * `rename` aynı dosya sistemi içinde atomiktir.
 */
export async function saveCallGraph(workspaceRoot: string, document: CallGraphDocument): Promise<void> {
  // Yazımları sıraya koy: eşzamanlı güncellemeler birbirini ezmesin.
  const previous = writeQueue;
  let release: () => void = () => {};
  writeQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    await writeDocument(workspaceRoot, document);
  } finally {
    release();
  }
}

/** Gerçek yazma; sıra garantisi `saveCallGraph` tarafından verilir. */
async function writeDocument(workspaceRoot: string, document: CallGraphDocument): Promise<void> {
  const target = callGraphPath(workspaceRoot);
  // Kuyruk süreç içi; farklı süreçler için de benzersiz ad kullanılır.
  const temp = `${target}.${process.pid}.${Date.now()}${TEMP_SUFFIX}`;
  await fs.mkdir(path.dirname(target), { recursive: true });

  const payload: CallGraphDocument = {
    ...document,
    meta: {
      ...document.meta,
      updatedAt: Date.now(),
      nodeCount: document.nodes.length,
      edgeCount: document.edges.length,
      fileCount: Object.keys(document.files).length,
      incompleteFiles: Object.values(document.files).filter(
        (file) => file.status === 'partial' || file.status === 'failed'
      ).length
    }
  };

  await fs.writeFile(temp, JSON.stringify(payload), { encoding: 'utf-8', mode: 0o600 });
  try {
    await fs.rename(temp, target);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
}

/** Haritayı diskten siler (yeniden oluşturma ve temizlik için). */
export async function deleteCallGraph(workspaceRoot: string): Promise<void> {
  const target = callGraphPath(workspaceRoot);
  await fs.rm(target, { force: true });
  // Benzersiz geçici adlar kalabilir; klasörde kalanları da temizle.
  const dir = path.dirname(target);
  try {
    for (const entry of await fs.readdir(dir)) {
      if (entry.startsWith(CALLGRAPH_FILENAME) && entry.endsWith(TEMP_SUFFIX)) {
        await fs.rm(path.join(dir, entry), { force: true });
      }
    }
  } catch {
    // Klasör yoksa temizlenecek bir şey de yok.
  }
}

/** Biçim doğrulaması; eksik alanlı bir dosya harita sayılmaz. */
function isCallGraphDocument(value: unknown): value is CallGraphDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!candidate.meta || typeof candidate.meta !== 'object') return false;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return false;
  if (!candidate.files || typeof candidate.files !== 'object') return false;

  const meta = candidate.meta as Record<string, unknown>;
  return typeof meta.version === 'number' && typeof meta.root === 'string';
}
