/**
 * Ajan döngüsü, izin motoru, hook'lar ve CLI'ın paylaştığı merkezi komut risk politikası.
 * hooks, and the CLI.
 *
 * Üç sonuç:
 * - `blocked`: asla çalıştırılmaz, hiçbir onay bunu geçersiz kılamaz.
 * - `risky`: yalnızca açık, komut bazlı kullanıcı onayından sonra çalışır. Global
 * ayarlar ya da proje allow listesi bunu asla otomatik onaylayamaz.
 * - `safe`: normal izin kurallarına göre otomatik onaylanabilir.
 *
 * Politika allow listesi tabanlıdır: bir komut yalnızca bilinen güvenli bir
 * kalıba uyuyorsa (salt-okunur inceleme, standart test/build/lint akışları) ve
 * kabuk metakarakteri ya da hassas dosya referansı içermiyorsa `safe` olur.
 * Diğer her şey — `bash -c "..."` gibi kabuk sarmalayıcıları, kök dışı
 * `git -C`, dosya taşıma ve ağ araçları dahil — varsayılan olarak `risky`
 * sayılır ve kullanıcıya sorar.
 *
 * Bu bir sandbox değildir; güvenilmeyen kod için tek sert sınır Docker yalıtımıdır.
 * untrusted code.
 */

export type CommandRisk = 'safe' | 'risky' | 'blocked';

export interface CommandAssessment {
  risk: CommandRisk;
  reasons: string[];
}

interface Rule {
  pattern: RegExp;
  reason: string;
}

/**
 * Geri alınamaz ya da ana makineyi bozan işlemler. Sandbox içinde bile engelli
 * kalırlar çünkü genellikle istem enjeksiyonuna uğramış ya da şaşkın bir ajanı
 */
const BLOCKED_RULES: Rule[] = [
  {
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: 'fork bomb'
  },
  { pattern: /\bmkfs(\.\w+)?\b/, reason: 'filesystem formatting (mkfs)' },
  { pattern: /\bdd\b[^\n]*\bof=\/dev\//, reason: 'raw write to a block device (dd of=/dev/...)' },
  {
    pattern: /(^|[^0-9a-zA-Z_])>\s*\/dev\/(sd|disk|nvme|hd|ada|mmcblk)/,
    reason: 'raw write to a block device'
  },
  {
    pattern: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b|\binit\s+0\b/,
    reason: 'host shutdown or reboot'
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?[a-zA-Z]*\s+(\/|~|\$HOME|\*|\.\.)(\s|$)/,
    reason: 'recursive deletion of a root or home path'
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+(\/|~|\$HOME|\*|\.\.)(\s|$)/,
    reason: 'recursive deletion of a root or home path'
  },
  {
    pattern: /\bchmod\s+(-R\s+)?(777|000)\s+(\/|~)(\s|$)/,
    reason: 'world-writable or locked-down root permissions'
  },
  { pattern: /\bchown\s+-R\s+[^\n]+\s+(\/|~)(\s|$)/, reason: 'recursive ownership change on a root path' },
  {
    pattern: /\bgit\s+clean\b(?![^\n]*(?:-n\b|--dry-run))/,
    reason: 'git clean without --dry-run deletes untracked files irrecoverably'
  },
  { pattern: /\bsudo\b/, reason: 'privilege escalation (sudo) is never allowed' },
  { pattern: /\b(curl|wget)\b[^\n]*\|\s*(ba|z|da|k)?sh\b/, reason: 'piping a remote download into a shell' },
  {
    pattern: /\bgit\s+push\b[^\n]*--force\b|\bgit\s+push\b[^\n]*\s-f(\s|$)/,
    reason: 'force push rewrites remote history'
  },
  { pattern: /\bdrop\s+(database|schema|table)\b/i, reason: 'destructive SQL (DROP)' },
  { pattern: /\btruncate\s+table\b/i, reason: 'destructive SQL (TRUNCATE)' }
];

/**
 * Yıkıcı ama bazen meşru işlemler. Otomatik onay ayarlarından veya proje allow
 * listelerinden bağımsız olarak her zaman açık bir onay kartı ister.
 */
const RISKY_RULES: Rule[] = [
  { pattern: /(^|[;&|]\s*|\s)rm\s+/, reason: 'file deletion (rm)' },
  { pattern: /\brmdir\s+/, reason: 'directory deletion (rmdir)' },
  { pattern: /\bshred\s+/, reason: 'irrecoverable overwrite (shred)' },
  { pattern: /\bgit\s+reset\b[^\n]*--hard/, reason: 'git reset --hard discards uncommitted work' },
  { pattern: /\bgit\s+checkout\b[^\n]*\s--\s/, reason: 'git checkout -- discards uncommitted work' },
  { pattern: /\bgit\s+restore\b/, reason: 'git restore discards uncommitted work' },
  { pattern: /\bgit\s+clean\b/, reason: 'git clean deletes untracked files' },
  { pattern: /\bgit\s+rebase\b/, reason: 'git rebase rewrites local history' },
  { pattern: /\bgit\s+push\b/, reason: 'git push publishes to a remote' },
  { pattern: /\bsed\s+(-[a-zA-Z]*i|--in-place)/, reason: 'in-place file editing (sed -i)' },
  { pattern: /\bperl\s+-[a-zA-Z]*i/, reason: 'in-place file editing (perl -i)' },
  { pattern: /\btruncate\s+-s\b/, reason: 'file truncation' },
  { pattern: /\bfind\b[^\n]*\s-delete\b/, reason: 'find -delete removes files' },
  { pattern: /\bchmod\s+/, reason: 'permission changes (chmod)' },
  { pattern: /\bchown\s+/, reason: 'ownership changes (chown)' },
  { pattern: /\bln\s+-[a-zA-Z]*s/, reason: 'symlink creation' },
  { pattern: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/, reason: 'package publication' },
  { pattern: /\bdocker\s+(run|rm|rmi|prune|system)\b/, reason: 'container lifecycle operations' },
  { pattern: /\bkill\b|\bpkill\b|\bkillall\b/, reason: 'process termination' },
  { pattern: /(^|[^0-9a-zA-Z_])>>?\s*[^&\s]/, reason: 'output redirection overwrites files' },
  { pattern: /\btee\b/, reason: 'tee writes to files' },
  { pattern: /\bgit\s+commit\b/, reason: 'git commit records changes' },
  {
    pattern:
      /\bnpm\s+install\b|\bnpm\s+i\b|\bnpm\s+ci\b|\bnpm\s+uninstall\b|\byarn\s+add\b|\byarn\s+remove\b|\bpnpm\s+add\b|\bpnpm\s+remove\b/,
    reason: 'dependency installation runs lifecycle scripts'
  },
  {
    pattern: /\bpip[23]?\s+(install|uninstall)\b|\bpython[23]?\s+-m\s+pip\s+(install|uninstall)\b/,
    reason: 'Python package installation runs setup code'
  },
  {
    pattern:
      /\bbrew\s+(install|uninstall|upgrade)\b|\bapt(-get)?\s+(install|remove|purge|upgrade)\b|\bdnf\s+(install|remove)\b/,
    reason: 'system package installation'
  },
  {
    pattern: /\bgit\s+merge\b|\bgit\s+tag\b|\bgit\s+branch\s+-[a-zA-Z]*[dD]/,
    reason: 'git history or branch mutation'
  },
  {
    pattern: /\bnode\s+-e\b|\bnode\s+--eval\b|\bpython[23]?\s+-c\b|\bperl\s+-e\b/,
    reason: 'inline code execution'
  }
];

const SHELL_METACHARACTERS = /[;&|<>`\n]|\$\(/;

/**
 * Kimlik bilgisi ya da anahtar malzemesi gibi görünen komut argümanları. Bunları
 * `execute_command` üzerinden okumak read aracının hassas dosya kurallarını
 * atlatırdı, bu yüzden her zaman açık onay isterler.
 */
const SENSITIVE_FILE_PATTERN =
  /(\.env($|[^a-z0-9])|id_rsa|\.pem($|[^a-z0-9])|\.key($|[^a-z0-9])|\.ssh($|[\\/\s])|\.aws($|[\\/\s])|\.gnupg($|[\\/\s]))/i;

/**
 * Bilinen güvenli komut biçimlerinin allow listesi. Bunlardan hiçbirine
 * uymayan (ve engelli olmayan) komut `risky` sayılır, böylece kullanıcıya sorulur.
 *
 * Bilinçli olarak hariç tutulanlar: kabuk yorumlayıcıları (`bash`, `sh`, `cmd`,
 * `powershell`), komut sarmalayıcıları (`xargs`, `env`, `nohup`, `timeout`,
 * `watch`, keyfi paketler için `npx`), argümanlardan keyfi kod çalıştırabilen
 * her şey (`awk`, `find -exec`, `node <dosya>`, `python <dosya>`), dosya
 * değiştirenler (`mv`, `cp`, `unlink`, `rsync`) ve ağ araçları
 * (`curl`, `wget`, `ssh`, `scp`, `nc`).
 */
const SAFE_COMMAND_PATTERNS: RegExp[] = [
  // Salt-okunur kabuk araçları ve zararsız dosya/klasör oluşturma.
  // `printenv`/`env` hariç: tüm ortam değişkenlerini (API anahtarları dahil)
  // dökerler. `git branch` hariç çünkü `git branch <ad>` dal oluşturur
  // (yalnızca `git branch -d/-D` riskli kurala yakalanır).
  /^(ls|ll|la|pwd|cd|echo|printf|date|cal|whoami|id|uname|hostname|which|type|whatis|file|wc|head|tail|stat|du|df|tree|basename|dirname|realpath|readlink|cat|less|more|grep|egrep|fgrep|rg|ag|diff|cmp|sort|uniq|cut|column|rev|nl|sleep|true|false|test|mkdir|touch|dir|where|ver)(\s|$)/,
  // Standart test/build/lint/typecheck akışları.
  /^(npm|yarn|pnpm)\s+(test|start|ls|outdated|audit|view|info)(\s|$)/,
  /^(npm|yarn|pnpm)\s+run\s+(test|build|lint|typecheck|check|format|verify|bench|dev|watch|start|compile)[a-z0-9:_-]*(\s|$)/,
  /^(npm|yarn|pnpm)\s+(-v|--version)(\s|$)/,
  // Araç zinciri kontrolleri ve test çalıştırıcıları.
  /^(node|python|python3)\s+(-v|--version)(\s|$)/,
  /^node\s+--test(\s|$)/,
  /^tsx\s+--test(\s|$)/,
  /^tsc(\s|$)/,
  /^npx\s+tsc(\s|$)/,
  /^(eslint|prettier|jest|vitest|mocha|pytest)(\s|$)/,
  /^(python|python3)\s+-m\s+(pytest|unittest)(\s|$)/,
  // Rust (Cargo) test, clippy ve kontrol
  /^cargo\s+(test|check|clippy|build|bench|verify|fmt|--version)(\s|$)/,
  // Go test ve vet
  /^go\s+(test|vet|version)(\s|$)/,
  // Flutter & Dart mobil test ve analiz
  /^flutter\s+(test|analyze|doctor|--version)(\s|$)/,
  /^dart\s+(test|analyze|format|--version)(\s|$)/,
  // Android Gradle test ve lint
  /^\.?\/?gradlew?\s+(test|lint|check|build|tasks|--version)(\s|$)/,
  // Swift iOS/native test ve build
  /^swift\s+(test|build|package|--version)(\s|$)/,
  // Çapraz platform derleyici ve araç zinciri kontrolleri
  /^(rustc|cargo|go|flutter|dart|swift|clang|gcc|ninja|cmake)\s+(-v|--version)(\s|$)/,
  // Salt-okunur Git incelemesi. Değiştiren alt komutlar (push, reset, clean,
  // checkout, stash, switch, dal oluşturma, ...) bilinçli olarak yok; ya riskli
  // kurala uyarlar ya da varsayılan `risky` sınıflandırmasına düşerler.
  /^git\s+(status|diff|log|show|rev-parse|ls-files|blame|shortlog|describe|reflog)(\s|$)/,
  /^git\s+(remote|stash)\s+(-v|--verbose|--list|list)(\s|$)/,
  /^git\s+config\s+(--get|--list|-l)(\s|$)/
];

function matchingReasons(command: string, rules: Rule[]): string[] {
  return rules.filter((rule) => rule.pattern.test(command)).map((rule) => rule.reason);
}

export function assessCommand(command: string): CommandAssessment {
  const value = String(command || '').trim();
  if (!value) {
    return { risk: 'safe', reasons: [] };
  }

  const blocked = matchingReasons(value, BLOCKED_RULES);
  if (blocked.length > 0) {
    return { risk: 'blocked', reasons: blocked };
  }

  const risky = matchingReasons(value, RISKY_RULES);
  if (risky.length > 0) {
    return { risk: 'risky', reasons: risky };
  }

  if (SHELL_METACHARACTERS.test(value)) {
    return {
      risk: 'risky',
      reasons: ['shell chaining, pipes, or redirection can run additional commands']
    };
  }

  if (SENSITIVE_FILE_PATTERN.test(value)) {
    return {
      risk: 'risky',
      reasons: ['the command references sensitive files such as keys or environment secrets']
    };
  }

  if (SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(value))) {
    return { risk: 'safe', reasons: [] };
  }

  return {
    risk: 'risky',
    reasons: ['the command is not on the safe-command allowlist; it requires explicit approval']
  };
}

/** Hook'lar ve komut çalıştırıcısı tarafından kullanılan geriye dönük uyumlu yardımcı. */
export function isDangerousCommand(command: string): boolean {
  return assessCommand(command).risk === 'blocked';
}

export function describeAssessment(assessment: CommandAssessment): string {
  if (assessment.reasons.length === 0) return '';
  return assessment.reasons.join('; ');
}
