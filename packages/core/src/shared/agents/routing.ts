/**
 * Rol yönlendirmesi.
 *
 * "Kim, neyi yapacak?" sorusunun tek cevap noktası burasıdır. Karar saf
 * fonksiyonlarla verilir: aynı plan ve aynı dosya listesi her zaman aynı
 * rolü üretir. Modelin rol adı uydurmasına ya da kullanıcının her adımda
 * elle seçim yapmasına gerek kalmaz.
 *
 * Sıra: (1) dosya yolları, (2) görev metni, (3) varsayılan rol.
 */
import { PlanStep } from '../../shared/types';

/** Rol adları `AgentDefinition.name` ile birebir aynı olmalıdır. */
export type OrchestratorRole =
  | 'manager'
  | 'analyst'
  | 'architect'
  | 'backend'
  | 'frontend'
  | 'mobile'
  | 'native'
  | 'database'
  | 'devops'
  | 'explorer'
  | 'git'
  | 'quality'
  | 'security';

/**
 * Yol kalıpları → rol. İlk eşleşen kazanır; bu yüzden özel kalıplar
 * (migration, güvenlik) genel olanlardan önce gelir.
 */
const PATH_RULES: ReadonlyArray<{ pattern: RegExp; role: OrchestratorRole }> = [
  { pattern: /(^|\/)(migrations?|schema|seeds?)\//i, role: 'database' },
  { pattern: /\.(sql|prisma)$/i, role: 'database' },
  { pattern: /(^|\/)(dockerfile|docker-compose[^/]*\.ya?ml|\.dockerignore)$/i, role: 'devops' },
  { pattern: /(^|\/)\.github\/workflows\//i, role: 'devops' },
  { pattern: /(^|\/)(k8s|helm|terraform|infra|deploy)\//i, role: 'devops' },
  { pattern: /\.(tf|hcl)$/i, role: 'devops' },
  { pattern: /(^|\/)(security|auth|permissions?)\//i, role: 'security' },
  { pattern: /(^|\/)(test|tests|__tests__|spec)\//i, role: 'quality' },
  { pattern: /\.(test|spec)\.[cm]?[jt]sx?$/i, role: 'quality' },
  { pattern: /(^|\/)(\.eslintrc|eslint\.config|prettier|vitest|jest|tsconfig)[^/]*$/i, role: 'quality' },
  { pattern: /\.(tsx|jsx)$/i, role: 'frontend' },
  { pattern: /(^|\/)(components|pages|views|styles|ui)\//i, role: 'frontend' },
  { pattern: /\.css$/i, role: 'frontend' },
  { pattern: /\.(swift|kt|dart)$/i, role: 'mobile' },
  { pattern: /(^|\/)(android|ios)\//i, role: 'mobile' },
  { pattern: /\.(rs|go|c|h|cc|cpp|zig)$/i, role: 'native' },
  { pattern: /(^|\/)(providers?|services?|api|server|routes?|controllers?)\//i, role: 'backend' },
  { pattern: /(^|\/)src\/core\//i, role: 'backend' },
  { pattern: /\.ts$/i, role: 'backend' },
  { pattern: /\.(md|mdx)$/i, role: 'analyst' }
];

/** Görev metnindeki anahtar kelimeler → rol. */
const TEXT_RULES: ReadonlyArray<{ pattern: RegExp; role: OrchestratorRole }> = [
  { pattern: /(migration|migrasyon|şema|schema|sql|veritaban|database|index optimiz)/i, role: 'database' },
  {
    pattern: /(docker|ci\/?cd|pipeline|deploy|dağıtım|workflow dosya|github actions|kubernetes)/i,
    role: 'devops'
  },
  {
    pattern: /(güvenlik|security|yetkilendirme|authentication|authorization|şifrele|encrypt|token sız)/i,
    role: 'security'
  },
  { pattern: /(test yaz|testleri|coverage|kapsam|lint|regresyon|kalite)/i, role: 'quality' },
  { pattern: /(arayüz|ui|bileşen|component|react|css|tasarım|ekran|frontend)/i, role: 'frontend' },
  { pattern: /(mobil|react native|expo|android|ios|flutter)/i, role: 'mobile' },
  { pattern: /(rust|golang|go dili|c\+\+|native|sistem çağrı|performans kritik)/i, role: 'native' },
  { pattern: /(mimari|architecture|tasarım kararı|modül sınır|refactor plan)/i, role: 'architect' },
  { pattern: /(gereksinim|spec|kabul kriter|analiz et|sözleşme)/i, role: 'analyst' },
  { pattern: /(commit|branch|dal|pull request|pr hazırla|merge)/i, role: 'git' },
  { pattern: /(araştır|keşfet|haritala|explore|bul nerede|kod tabanını tara)/i, role: 'explorer' },
  { pattern: /(api|endpoint|servis|backend|sunucu|route|controller)/i, role: 'backend' }
];

/** Hiçbir kural eşleşmezse uygulama işi backend'dir. */
const DEFAULT_ROLE: OrchestratorRole = 'backend';

/** Bir dosya yolundan rol çıkarır. */
export function roleForPath(filePath: string): OrchestratorRole | undefined {
  const normalized = String(filePath || '')
    .replace(/\\/g, '/')
    .trim();
  if (!normalized) return undefined;
  return PATH_RULES.find((rule) => rule.pattern.test(normalized))?.role;
}

/** Serbest metinden rol çıkarır. */
export function roleForText(text: string): OrchestratorRole | undefined {
  const value = String(text || '').trim();
  if (!value) return undefined;
  return TEXT_RULES.find((rule) => rule.pattern.test(value))?.role;
}

/**
 * Güvenlik açısından hassas dosya adı kalıbı. Yol kuralı yalnızca `security/`
 * dizinine bakardı; isim kalıbı eklenir ki `src/auth/session.ts` gibi bir
 * dosyada çalışan backend adımında security ajanı da incelemeye katılsın.
 */
const SECURITY_FILE_PATTERN =
  /(auth|login|logout|token|password|passwd|credential|secret|crypt|oauth|jwt|session|permission|privilege|cors|csrf|xss|pay|billing|invoice)/i;

/** Kod yazan roller: kendi değişikliklerini kendileri onaylayamaz. */
const WRITER_ROLES: ReadonlySet<OrchestratorRole> = new Set([
  'backend',
  'frontend',
  'mobile',
  'native',
  'database',
  'devops'
]);

/** Adımın dosyalarındaki en sık rol. */
function roleFromFiles(files: readonly string[]): OrchestratorRole | undefined {
  const counts = new Map<OrchestratorRole, number>();
  for (const file of files) {
    const role = roleForPath(file);
    if (!role) continue;
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  let best: OrchestratorRole | undefined;
  let bestCount = 0;
  for (const [role, count] of counts) {
    // Eşitlikte deterministik kalsın: ilk giren kazanır.
    if (count > bestCount) {
      best = role;
      bestCount = count;
    }
  }
  return best;
}

export interface StepRoutingInput {
  title?: string;
  description?: string;
  files?: readonly string[];
  /** Model zaten bir rol belirttiyse ona saygı duyulur. */
  ownerRole?: string;
}

export interface StepRoles {
  primary: OrchestratorRole;
  /** Birincil rolün işini bağımsız denetleyecek/destekleyecek roller. */
  collaborators: OrchestratorRole[];
  reason: string;
}

/**
 * Bir plan adımı için birincil rol ve işbirlikçileri belirler.
 *
 * Birincil rol eski davranışla aynıdır (dosyalar → metin → varsayılan).
 * İşbirlikçiler niyet ve etki analiziyle eklenir:
 * - Kod yazan her rolün değişikliği @quality tarafından bağımsız incelenir.
 * - Güvenlik sinyali (dosya adı veya görev metni) varsa @security katılır.
 * - Üçten farklı uzmanlık alanı tek adımda değişiyorsa @architect katılır.
 */
export function rolesForStep(input: StepRoutingInput): StepRoles {
  const files = input.files ?? [];
  const text = `${input.title ?? ''} ${input.description ?? ''}`;
  const declared = normalizeRole(input.ownerRole);

  let primary: OrchestratorRole;
  let reason: string;
  if (declared) {
    primary = declared;
    reason = 'model tarafından atandı';
  } else {
    const fromFiles = roleFromFiles(files);
    const fromText = roleForText(text);
    if (fromFiles) {
      primary = fromFiles;
      reason = 'dosya yollarına göre';
    } else if (fromText) {
      primary = fromText;
      reason = 'görev metnine göre';
    } else {
      primary = DEFAULT_ROLE;
      reason = 'varsayılan rol';
    }
  }

  const collaborators = new Set<OrchestratorRole>();
  // Bağımsız inceleme kuralı: yazan rol kendi çıktısını onaylamaz.
  if (WRITER_ROLES.has(primary) || primary === 'security') collaborators.add('quality');
  const securitySignal =
    files.some((file) => SECURITY_FILE_PATTERN.test(file)) ||
    /(güvenlik|security|yetkilendirme|authentication|authorization|şifrele|encrypt|token sız|zafiyet|vulnerab)/i.test(
      text
    );
  if (securitySignal && primary !== 'security') collaborators.add('security');
  // Geniş etki alanı: birden çok uzmanlık alanına dokunan adımda mimar izlesin.
  const distinctRoles = new Set(
    files.map((file) => roleForPath(file)).filter((role): role is OrchestratorRole => Boolean(role))
  );
  if (distinctRoles.size >= 3 && primary !== 'architect') collaborators.add('architect');
  collaborators.delete(primary);
  collaborators.delete('manager');

  return { primary, collaborators: [...collaborators], reason };
}

/**
 * Bir plan adımı için rol seçer.
 *
 * Model açıkça geçerli bir rol verdiyse korunur; aksi hâlde dosyalar, sonra
 * metin, en son varsayılan rol kullanılır. İşbirlikçiler de gerekiyorsa
 * `rolesForStep` kullanın.
 */
export function roleForStep(input: StepRoutingInput): OrchestratorRole {
  return rolesForStep(input).primary;
}

/** Değişen dosya listesi için incelemeye katılması gereken roller. */
export function rolesForChangedFiles(files: readonly string[]): OrchestratorRole[] {
  const roles = new Set<OrchestratorRole>();
  // Yazılan her kod bağımsız kalite incelemesi görür.
  roles.add('quality');
  for (const file of files) {
    const normalized = String(file || '').replace(/\\/g, '/');
    if (SECURITY_FILE_PATTERN.test(normalized) || roleForPath(normalized) === 'security') {
      roles.add('security');
    }
  }
  return [...roles];
}

/** Bilinen bir rol adıysa döndürür; alias'lar da çözülür. */
export function normalizeRole(value: string | undefined): OrchestratorRole | undefined {
  const name = String(value || '')
    .trim()
    .toLowerCase();
  if (!name) return undefined;
  const aliased = ROLE_ALIASES[name] ?? name;
  return isOrchestratorRole(aliased) ? aliased : undefined;
}

const KNOWN_ROLES: ReadonlySet<string> = new Set<string>([
  'manager',
  'analyst',
  'architect',
  'backend',
  'frontend',
  'mobile',
  'native',
  'database',
  'devops',
  'explorer',
  'git',
  'quality',
  'security'
]);

function isOrchestratorRole(value: string): value is OrchestratorRole {
  return KNOWN_ROLES.has(value);
}

/** Eski rol adları korunur; mevcut tanımlar bunları kullanıyor. */
const ROLE_ALIASES: Readonly<Record<string, OrchestratorRole>> = Object.freeze({
  coder: 'backend',
  tester: 'quality',
  reviewer: 'quality'
});

export interface StepAssignment {
  stepId: string;
  title: string;
  role: OrchestratorRole;
  reason: string;
  /** Bağımsız incelemeye/desteğe katılacak roller (birincil rolü onaylamaz). */
  collaborators: OrchestratorRole[];
}

/**
 * Planı rollere dağıtır. Aynı rolü paylaşan ve bağımlılığı olmayan adımlar
 * tek bir delege turunda birleştirilebilir.
 */
export function assignPlanRoles(steps: readonly PlanStep[]): StepAssignment[] {
  return steps.map((step) => {
    const { primary, collaborators, reason } = rolesForStep(step);
    return { stepId: step.id, title: step.title, role: primary, reason, collaborators };
  });
}
