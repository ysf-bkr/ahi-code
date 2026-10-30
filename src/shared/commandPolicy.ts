/**
 * Ajan döngüsü, izin motoru, hook'lar ve CLI'ın paylaştığı merkezi komut risk politikası.
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
  {
    pattern: /(^|[^0-9a-zA-Z_])>>?\s*(?!\/dev\/null\b)[^&\s]/,
    reason: 'output redirection overwrites files'
  },
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
  },
  // Güvenli listedeki komutların argümanlarıyla ek kod çalıştırma ya da
  // çalışma alanı dışına okuma/yazma (denetim bulgusu F01).
  {
    pattern: /(^|\s)(rg|ripgrep)\b[^;&|\n]*\s--pre(-glob)?\b/,
    reason: 'ripgrep --pre executes an external preprocessor program'
  },
  {
    pattern: /\bgit\s+(diff|log|show|shortlog)\b[^;&|\n]*\s--output(=|\s)/,
    reason: 'git writes its output to a file (--output)'
  },
  { pattern: /\bgit\s+reflog\s+expire\b/, reason: 'git reflog expire discards recoverable history' },
  {
    pattern: /(^|\s)\.\.[/\\]/,
    reason: 'the command references a parent directory outside the workspace'
  },
  {
    pattern:
      /(^|\s)(\/(etc|var|usr|bin|sbin|root|opt|lib|sys|proc|private\/etc)($|[\s/\\])|~[/\\]|\$HOME[/\\]|[A-Za-z]:[/\\](Windows|Program Files))/i,
    reason: 'the command references an absolute or home path outside the workspace'
  }
];

/** Salt-okunur ardışık düzen (pipeline) filtre araçları. */
const SAFE_PIPELINE_FILTER_PATTERN =
  /^(grep|egrep|fgrep|rg|head|tail|wc|sort|uniq|cut|column|less|more|cat|tr|sed)(\s|$)/;

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
 * `watch`), keyfi paket indirip çalıştıran `npx` (yerelde kurulu olmasa bile
 * kayıt defterinden çeker), depodaki `package.json` içinde tanımlı keyfi
 * betikleri çalıştıran `npm start` / `npm run dev` / `npm run watch`
 * (doğrulama akışı değiller; sonsuza dek süren geliştirme sunucularıdır),
 * argümanlardan keyfi kod çalıştırabilen her şey (`awk`, `find -exec`,
 * `node <dosya>`, `python <dosya>`), dosya değiştirenler (`mv`, `cp`,
 * `unlink`, `rsync`) ve ağ araçları (`curl`, `wget`, `ssh`, `scp`, `nc`).
 *
 * Bilinen ve kabul edilmiş sınır: `npm test`, `npm run build`, `cargo test`,
 * `gradlew test` gibi standart doğrulama akışları deponun kendi kodunu
 * (test dosyaları, build script'leri, yapılandırma dosyaları) çalıştırır.
 * Bu, bu politikanın tehdit modelinin parçasıdır; güvenilmeyen depolarda
 * tek sert sınır Docker yalıtımıdır.
 */
const SAFE_COMMAND_PATTERNS: RegExp[] = [
  // Salt-okunur kabuk araçları ve zararsız dosya/klasör oluşturma.
  // `printenv`/`env` hariç: tüm ortam değişkenlerini (API anahtarları dahil)
  // dökerler. `git branch` hariç çünkü `git branch <ad>` dal oluşturur
  // (yalnızca `git branch -d/-D` riskli kurala yakalanır).
  // `sed` için salt-okunur kullanım serbesttir (`sed -i` zaten RISKY_RULES ile engellenir).
  /^(ls|ll|la|pwd|cd|echo|printf|date|cal|whoami|id|uname|hostname|which|type|whatis|file|wc|head|tail|stat|du|df|tree|basename|dirname|realpath|readlink|cat|less|more|grep|egrep|fgrep|rg|ag|diff|cmp|sort|uniq|cut|column|rev|nl|sleep|true|false|test|mkdir|touch|dir|where|ver|sed)(\s|$)/,
  // Güvenli dosya arama (yıkıcı -delete veya -exec parametreleri hariç)
  /^find\s+(?![^\n]*\s(-exec|-execdir|-delete)\b)/,
  // Standart test/build/lint/typecheck akışları. `start`/`dev`/`watch`
  // bilinçli olarak yok: bunlar package.json'da tanımlı keyfi betiklerdir ve
  // doğrulama değil, sürekli çalışan geliştirme sunucusu akışlarıdır.
  /^(npm|yarn|pnpm)\s+(test|ls|outdated|audit|view|info)(\s|$)/,
  /^(npm|yarn|pnpm)\s+run\s+(test|build|lint|typecheck|check|format|verify|bench|compile|package|bundle|clean|generate|validate)[a-z0-9:_-]*(\s|$)/,
  /^(npm|yarn|pnpm)\s+(-v|--version)(\s|$)/,
  // Araç zinciri kontrolleri ve test çalıştırıcıları.
  /^(node|python|python3)\s+(-v|--version)(\s|$)/,
  /^node\s+--test(\s|$)/,
  /^tsx\s+--test(\s|$)/,
  /^tsc(\s|$)/,
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
  // Güvenli Git işlemleri: inceleme, staging (add), dal değiştirme (switch/checkout dal)
  /^git\s+(status|diff|log|show|rev-parse|ls-files|blame|shortlog|describe|reflog|merge-base)(\s|$)/,
  /^git\s+add(\s|$)/,
  /^git\s+fetch(\s|$)/,
  /^git\s+branch(\s+(-a|-r|-v|--list|--show-current\b))*$/,
  /^git\s+checkout\s+(?!--|\.|\s-f)(?!.*(--|\s\.|\s-f))[a-zA-Z0-9_\-./]+(\s|$)/,
  /^git\s+switch\s+(?!-f\b)(?!.*-f\b)[a-zA-Z0-9_\-./]+(\s|$)/,
  /^git\s+(remote|stash)\s+(-v|--verbose|--list|list)(\s|$)/,
  /^git\s+config\s+(--get|--list|-l)(\s|$)/
];

function matchingReasons(command: string, rules: Rule[]): string[] {
  return rules.filter((rule) => rule.pattern.test(command)).map((rule) => rule.reason);
}

/**
 * Komut dizesini tırnakları (`'` ve `"`) ve kaçışları (`\`) dikkate alarak
 * `;`, `&&`, `||` operatörlerine göre alt mantıksal ifadelere (clauses) böler.
 */
export function splitCompoundCommand(command: string): string[] {
  const clauses: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    // Tırnak dışında kalan operatörler:
    if (!inSingleQuote && !inDoubleQuote) {
      if ((char === '&' && command[i + 1] === '&') || (char === '|' && command[i + 1] === '|')) {
        if (current.trim()) {
          clauses.push(current.trim());
        }
        current = '';
        i++; // ikinci karakteri atla
        continue;
      }
      if (char === ';') {
        if (current.trim()) {
          clauses.push(current.trim());
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    clauses.push(current.trim());
  }

  return clauses;
}

/**
 * Bir ifadeyi tırnakları dikkate alarak `|` (boru) aşamalarına böler.
 */
export function splitPipeline(clause: string): string[] {
  const stages: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < clause.length; i++) {
    const char = clause[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '|') {
      if (current.trim()) {
        stages.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    stages.push(current.trim());
  }

  return stages;
}

/**
 * Tekil bir komut veya boru hattı filtresi aşamasını değerlendirir.
 */
function assessSingleStage(stage: string, isPipelineFilter: boolean): CommandAssessment {
  const cleaned = stage.replace(/\s*(2>&1|2>\/dev\/null|1?>\s*\/dev\/null)\b/g, '').trim();
  if (!cleaned) {
    return { risk: 'safe', reasons: [] };
  }

  const blocked = matchingReasons(cleaned, BLOCKED_RULES);
  if (blocked.length > 0) {
    return { risk: 'blocked', reasons: blocked };
  }

  const risky = matchingReasons(cleaned, RISKY_RULES);
  if (risky.length > 0) {
    return { risk: 'risky', reasons: risky };
  }

  // Komut ikamesi (`...` veya $(...)) tehlikelidir; keyfi alt komut çalıştırabilir
  if (/`|\$\(/.test(cleaned)) {
    return {
      risk: 'risky',
      reasons: ['command substitution (`...` or $(...)) can run arbitrary commands']
    };
  }

  if (SENSITIVE_FILE_PATTERN.test(cleaned)) {
    return {
      risk: 'risky',
      reasons: ['the command references sensitive files such as keys or environment secrets']
    };
  }

  if (isPipelineFilter) {
    if (
      SAFE_PIPELINE_FILTER_PATTERN.test(cleaned) ||
      SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(cleaned))
    ) {
      return { risk: 'safe', reasons: [] };
    }
    return {
      risk: 'risky',
      reasons: ['pipeline filter stage is not on the safe allowlist']
    };
  }

  if (SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return { risk: 'safe', reasons: [] };
  }

  return {
    risk: 'risky',
    reasons: ['the command is not on the safe-command allowlist; it requires explicit approval']
  };
}

export function assessCommand(command: string, _workspaceRoot?: string): CommandAssessment {
  const value = String(command || '').trim();
  if (!value) {
    return { risk: 'safe', reasons: [] };
  }

  // 1. Tüm komut genelinde sert kural kontrolü (blocked)
  const rootBlocked = matchingReasons(value, BLOCKED_RULES);
  if (rootBlocked.length > 0) {
    return { risk: 'blocked', reasons: rootBlocked };
  }

  // 2. Tırnakları koruyarak `;`, `&&`, `||` ile ayrılmış mantıksal ifadelere böl
  const clauses = splitCompoundCommand(value);

  // Eğer hiçbir ifade çıkmadıysa
  if (clauses.length === 0) {
    return { risk: 'safe', reasons: [] };
  }

  const allBlockedReasons: string[] = [];
  const allRiskyReasons: string[] = [];

  for (const clause of clauses) {
    // Her bir clause boru hattı (`|`) içerebilir
    const stages = splitPipeline(clause);
    if (stages.length === 0) continue;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      if (!stage) continue;
      const isFilter = i > 0;
      const res = assessSingleStage(stage, isFilter);
      if (res.risk === 'blocked') {
        allBlockedReasons.push(...res.reasons);
      } else if (res.risk === 'risky') {
        allRiskyReasons.push(...res.reasons);
      }
    }
  }

  if (allBlockedReasons.length > 0) {
    return { risk: 'blocked', reasons: Array.from(new Set(allBlockedReasons)) };
  }

  if (allRiskyReasons.length > 0) {
    return { risk: 'risky', reasons: Array.from(new Set(allRiskyReasons)) };
  }

  return { risk: 'safe', reasons: [] };
}

/** Hook'lar ve komut çalıştırıcısı tarafından kullanılan geriye dönük uyumlu yardımcı. */
export function isDangerousCommand(command: string): boolean {
  return assessCommand(command).risk === 'blocked';
}

export function describeAssessment(assessment: CommandAssessment): string {
  if (assessment.reasons.length === 0) return '';
  return assessment.reasons.join('; ');
}
