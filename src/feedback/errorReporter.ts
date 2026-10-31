/**
 * Otomatik hata bildirimi (GitHub Issues).
 *
 * Kullanıcı açıksa (`ahiCode.reportErrors`) eklenti kendi hatalarını
 * `ysf-bkr/ahi-code` deposunda issue olarak bildirir. Üç söz verilir:
 * 1. Mükerrer yok: hata mesajı normalize edilip parmak izine çevrilir; aynı
 *    parmak izi hem yerel kayıtta hem GitHub'da aranır, ikisi de yoksa açılır.
 * 2. Gizlilik: gövde yazılmadan önce mutlak yollar, API anahtarı benzeri
 *    diziler, uzun hex/UUID ve sayısal zaman damgaları maskelenir.
 * 3. Gürültü yok: oturum başına üst sınır ve iki bildirim arası bekleme.
 *
 * VS Code API'sine bağımlılık yoktur; taşıyıcı olarak `gh` CLI argüman
 * üreticisi enjekte edilir ve testler sahte taşıyıcıyla koşar.
 */
import * as crypto from 'crypto';

/** Bildirimin gideceği depo. */
export const ERROR_REPORT_REPO = 'ysf-bkr/ahi-code';

/** Issue gövdesinde aranabilir sabit imza satırının başı. */
export const FINGERPRINT_MARKER = 'ahi-hata-imzasi';

/** Oturum başına en fazla gönderilecek farklı hata sayısı. */
const SESSION_BUDGET = 5;

/** İki yeni bildirim arasındaki en kısa süre (ms). */
const REPORT_COOLDOWN_MS = 60_000;

/** Bilinen sırların yerel kayıt listesi üst sınırı. */
const MAX_TRACKED_FINGERPRINTS = 200;

/** Yerel kalıcılık için gereken minimum arayüz (vscode.Memento ile uyumlu). */
export interface FingerprintStore {
  get(key: string): string[] | undefined;
  update(key: string, value: string[]): Thenable<void>;
}

/** `gh` CLI taşıyıcısı: argüman dizisini çalıştırır, stdout döndürür. */
export type GitHubRunner = (args: string[]) => Promise<string>;

export interface ErrorReporterContext {
  extensionVersion: string;
  appHost: string;
  platform: string;
}

export interface ErrorReporterDependencies {
  runGitHub: GitHubRunner;
  store: FingerprintStore;
  context: ErrorReporterContext;
  /** Ayar her bildirimde yeniden okunur; kapalıyken hiçbir ağ çağrısı olmaz. */
  isEnabled: () => boolean;
  /** Başarılı bildirimden sonra çağrılır (kullanıcıya link göstermek için). */
  onReported?: (issueUrl: string, fingerprint: string) => void;
  /** Sessiz başarısızlıklar için günlüğe yazma kancası. */
  onSilentFailure?: (reason: string) => void;
  now?: () => number;
}

const FINGERPRINT_STORE_KEY = 'ahi_error_fingerprint';

/**
 * Hata mesajını normalize eder: makineye özgü (yol, sürüm, id, anahtar,
 * zaman damgası) kısımlar maskelenir ki aynı hatanın farklı dizinlerdeki
 * iki görünümü aynı parmak izine düşsün.
 */
export function normalizeErrorMessage(message: string): string {
  return String(message || '')
    .replace(/sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|xox[bap]-[A-Za-z0-9-]+/g, '<anahtar>')
    .replace(/(?:\/[\w.@ -]+){2,}|(?:[A-Za-z]:\\[\w.@ \\-]+)+/g, '<yol>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\b\d{7,}\b/g, '<sayi>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Normalize edilmiş mesajdan kısa, arama dostu parmak izi üretir. */
export function fingerprintOf(message: string): string {
  const normalized = normalizeErrorMessage(message);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 12);
}

/** Issue başlığı: önek + maskelenmiş mesajın ilk satırı (uzunluk sınırlı). */
export function buildIssueTitle(message: string): string {
  const firstLine = normalizeErrorMessage(message).split('\n')[0] || 'bilinmeyen hata';
  const clipped = firstLine.length > 68 ? `${firstLine.slice(0, 65)}…` : firstLine;
  return `[Otomatik Hata] ${clipped}`;
}

/** Kullanıcıya gösterilecek, sırlardan arındırılmış hata metni. */
export function sanitizeForReport(message: string, maxChars = 2000): string {
  const masked = normalizeErrorMessage(message);
  return masked.length > maxChars ? `${masked.slice(0, maxChars)}…` : masked;
}

/** Issue gövdesi: imza satırı, ortam bilgisi ve maskelenmiş hata. */
export function buildIssueBody(message: string, fingerprint: string, context: ErrorReporterContext): string {
  const sanitized = sanitizeForReport(message);
  return [
    'AhiCode eklentisi bu hatayı kendi çalışma sırasında algıladı ve kullanıcı onaylı otomatik bildirimle raporluyor.',
    '',
    `Hata imzası: \`${FINGERPRINT_MARKER}-${fingerprint}\``,
    '',
    '| Ortam | Değer |',
    '| --- | --- |',
    `| Eklenti sürümü | ${context.extensionVersion} |`,
    `| Uygulama | ${context.appHost} |`,
    `| Platform | ${context.platform} |`,
    `| Zaman | ${new Date().toISOString()} |`,
    '',
    '## Hata (duyarlı alanlar maskelendi)',
    '',
    '```text',
    sanitized || '(boş mesaj)',
    '```',
    '',
    '> Not: Bu konu AhiCode tarafından açılmıştır. Yol adları, anahtarlar ve',
    '> kimlik benzeri diziler kasıtlı olarak maskelenmiştir.'
  ].join('\n');
}

/**
 * Hata bildirim yöneticisi: parmak izi, mükerrer kontrolü, bütçe ve
 * `gh` çağrılarını tek yerde toplar. Hata yolları asla istemciyi
 * düşürmez; başarısız bildirim sessizce günlüğe yazılır.
 */
export class ErrorReporter {
  private sessionReports = 0;
  private lastReportAt = 0;
  private ghUnavailable = false;
  private inFlight = new Set<string>();
  private localHits: Set<string> | undefined;

  constructor(private readonly deps: ErrorReporterDependencies) {}

  private async knownFingerprints(): Promise<Set<string>> {
    if (!this.localHits) {
      this.localHits = new Set(this.deps.store.get(FINGERPRINT_STORE_KEY) || []);
    }
    return this.localHits;
  }

  private async remember(fingerprint: string): Promise<void> {
    const known = await this.knownFingerprints();
    if (known.has(fingerprint)) return;
    known.add(fingerprint);
    const list = Array.from(known).slice(-MAX_TRACKED_FINGERPRINTS);
    await this.deps.store.update(FINGERPRINT_STORE_KEY, list);
  }

  /**
   * Tek giriş noktası: kullanıcıya görünen her hata mesajı buradan geçer.
   * Kapalı ayar, tanıdık parmak izi, bitmiş bütçe veya `gh` yokluğu
   * durumunda hiçbir şey yayınlanmaz.
   */
  public async report(message: string): Promise<void> {
    try {
      if (!this.deps.isEnabled()) return;
      const text = String(message || '').trim();
      if (!text) return;
      if (this.ghUnavailable) return;
      if (this.sessionReports >= SESSION_BUDGET) return;
      const now = (this.deps.now || Date.now)();
      if (now - this.lastReportAt < REPORT_COOLDOWN_MS && this.sessionReports > 0) return;

      const fingerprint = fingerprintOf(text);
      if (this.inFlight.has(fingerprint)) return;
      const known = await this.knownFingerprints();
      if (known.has(fingerprint)) return;

      this.inFlight.add(fingerprint);
      try {
        // Mükerrer kontrolü: imza GitHub'da (açık-kapalı tüm konularda) var mı?
        const searchArgs = [
          'issue',
          'list',
          '--repo',
          ERROR_REPORT_REPO,
          '--state',
          'all',
          '--limit',
          '5',
          '--search',
          `${FINGERPRINT_MARKER}-${fingerprint}`
        ];
        const found = await this.deps.runGitHub(searchArgs);
        if (found.trim()) {
          await this.remember(fingerprint);
          return;
        }

        const body = buildIssueBody(text, fingerprint, this.deps.context);
        const created = await this.deps.runGitHub([
          'issue',
          'create',
          '--repo',
          ERROR_REPORT_REPO,
          '--title',
          buildIssueTitle(text),
          '--body',
          body
        ]);
        this.sessionReports += 1;
        this.lastReportAt = now;
        await this.remember(fingerprint);
        const url = created.trim().split('\n').pop() || '';
        this.deps.onReported?.(url, fingerprint);
      } catch (err) {
        // gh kurulu değil / oturum yok / ağ yok: bir daha denemeyi yorma.
        const reason = err instanceof Error ? err.message : String(err);
        if (/ENOENT|not found|command not found/i.test(reason)) {
          this.ghUnavailable = true;
        }
        this.deps.onSilentFailure?.(reason);
      } finally {
        this.inFlight.delete(fingerprint);
      }
    } catch {
      // Bildirimcinin kendi hatası kullanıcı akışını asla düşürmez.
    }
  }
}
