import * as path from 'path';
import { realpathSync } from 'fs';
import { AHI_DIR, AHI_FILES } from '../../shared/constants';
import * as fs from 'fs/promises';
import { ToolName, UserSettings } from '../../shared/types';
import { isRecord } from '../../shared/errors';
import { assessCommand, describeAssessment } from '../../shared/commandPolicy';
import { isFlowMetadataTool, policyFor, targetPathFor } from './toolPolicy';
import { isBroadPattern, matchCommandPattern, matchPathPattern } from './patterns';

/** Çalışma alanını değiştirebilen politika türleri; bozuk izin dosyası bunları engeller. */
const MUTATING_POLICIES = new Set(['write', 'git-write', 'command']);

/**
 * İçeriği açık onay olmadan okunmaması gereken dosyalar.
 * Bilgi tabanı indeksleyicisinin `SENSITIVE_PATTERNS` listesiyle aynı
 * hassasiyeti taşır; aksi hâlde indekse girmeyen bir dosya `read_file`
 * ile onaysız okunabiliyordu.
 */
const PROTECTED_READ_PATHS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  'id_rsa',
  'id_rsa.*',
  'id_dsa*',
  'id_ecdsa*',
  'id_ed25519*',
  '.npmrc',
  '.pypirc',
  '.git/**',
  '**/.git/**',
  'secrets/**',
  'secrets.*',
  'secret/**',
  'credentials/**',
  'credentials.*',
  'credential/**'
];

/** Kod çalıştırma izni veren ya da güvenliği gevşeten dosyalar; ajan bunlara asla otomatik yazmaz. */
const PROTECTED_WRITE_PATHS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa',
  'id_rsa.*',
  '.git/**',
  '.ahi/hooks.json',
  '.ahi/mcp_config.json',
  '.ahi/permissions.json',
  'ahi.permissions.json',
  'opencode.json',
  'mcp_config.json',
  '.mcp.json',
  'AGENTS.md',
  '.agents/**'
];

export interface ProjectPermissionsConfig {
  allow?: {
    readFiles?: string[];
    writeFiles?: string[];
    commands?: string[];
  };
  deny?: {
    readFiles?: string[];
    writeFiles?: string[];
    commands?: string[];
  };
  autoApprove?: {
    readFiles?: boolean;
    writeFiles?: boolean;
    executeCommands?: boolean;
  };
}

export class PermissionManager {
  private projectPermissions?: ProjectPermissionsConfig;
  private workspaceRoot?: string;
  private configError?: string;
  private workspaceTrusted = true;

  constructor(private settings: UserSettings) {}

  public updateSettings(settings: UserSettings) {
    this.settings = settings;
  }

  /**
   * Proje izinleri deponun kendisinden gelir, bu yüzden yalnızca güvenilir
   * çalışma alanında dikkate alınır. Güvenilmeyen çalışma alanları kullanıcının
   * global ayarlarına döner (deny ve hassas dosya kuralları yine geçerlidir).
   */
  public async loadProjectPermissions(workspaceRoot?: string, workspaceTrusted = true): Promise<void> {
    this.projectPermissions = undefined;
    this.configError = undefined;
    this.workspaceRoot = workspaceRoot;
    this.workspaceTrusted = workspaceTrusted;
    if (!workspaceRoot) return;

    const possiblePaths = [
      path.join(workspaceRoot, AHI_DIR, AHI_FILES.permissions),
      path.join(workspaceRoot, 'ahi.permissions.json'),
      path.join(workspaceRoot, 'opencode.json')
    ];

    for (const p of possiblePaths) {
      let raw: string;
      try {
        raw = await fs.readFile(p, 'utf-8');
      } catch {
        continue; // File does not exist; try the next candidate.
      }

      try {
        this.projectPermissions = this.sanitizeConfig(JSON.parse(raw));
      } catch {
        // Bu dosya varsa ama geçersizse daha zayıf bir dosyaya düşme.
        this.configError = `Invalid permission file: ${p}`;
      }
      break;
    }
  }

  /**
   * Deny/allow kuralları eşleşmeden önce yolları çalışma alanına göre
   * normalize eder. Böylece "./secret/x" ile mutlak çalışma alanı yolu aynı kalıba uyar.
   */
  private normalizeTarget(target: string): string {
    let value = String(target || '')
      .replace(/\\/g, '/')
      .trim();
    if (!value) return '';

    if (this.workspaceRoot) {
      const absolute = path.isAbsolute(value) ? value : path.resolve(this.workspaceRoot, value);
      const relative = path.relative(this.workspaceRoot, absolute).replace(/\\/g, '/');
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        value = relative;
      } else if (path.isAbsolute(value)) {
        value = value.replace(/\\/g, '/');
      }
    }

    return value.replace(/^\.\//, '').replace(/\/+/g, '/');
  }

  /**
   * Bozuk permissions.json değerlerinin ajan döngüsünü çökertmesini önler;
   * yalnızca geçerli dizi ve boolean alanlar kabul edilir.
   */
  private sanitizeConfig(input: unknown): ProjectPermissionsConfig {
    const list = (value: unknown): string[] | undefined =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
    const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

    const config: ProjectPermissionsConfig = {};
    if (!isRecord(input)) return config;

    if (isRecord(input.allow)) {
      config.allow = {
        readFiles: list(input.allow.readFiles),
        writeFiles: list(input.allow.writeFiles),
        commands: list(input.allow.commands)
      };
    }
    if (isRecord(input.deny)) {
      config.deny = {
        readFiles: list(input.deny.readFiles),
        writeFiles: list(input.deny.writeFiles),
        commands: list(input.deny.commands)
      };
    }
    if (isRecord(input.autoApprove)) {
      config.autoApprove = {
        readFiles: bool(input.autoApprove.readFiles),
        writeFiles: bool(input.autoApprove.writeFiles),
        executeCommands: bool(input.autoApprove.executeCommands)
      };
    }

    return config;
  }

  /**
   * Hedefin, sembolik bağlar çözüldükten sonraki çalışma alanı göreli yolu.
   *
   * İzin kuralları istenen yolun adıyla eşleşiyor; kök içinde kalan bir
   * symlink (`alias.txt -> .env`) hassas hedefe alternatif ad sağlıyordu.
   * Dosya henüz yoksa en yakın var olan üst dizin kanonikleştirilir ve
   * kalan parçalar yeniden eklenir (denetim bulgusu F03).
   */
  private realRelativeTarget(target: string): string | undefined {
    if (!this.workspaceRoot) return undefined;
    const absolute = path.isAbsolute(target) ? target : path.resolve(this.workspaceRoot, target);

    let real: string | undefined;
    try {
      real = realpathSync(absolute);
    } catch {
      // Dosya yok: en yakın var olan üst dizini kanonikleştir.
      let current = path.dirname(absolute);
      const tail: string[] = [];
      while (current !== path.dirname(current)) {
        try {
          const canonicalDir = realpathSync(current);
          real = tail.length > 0 ? path.join(canonicalDir, ...tail) : canonicalDir;
          break;
        } catch {
          tail.unshift(path.basename(current));
          current = path.dirname(current);
        }
      }
    }
    if (!real) return undefined;

    let rootReal = this.workspaceRoot;
    try {
      rootReal = realpathSync(this.workspaceRoot);
    } catch {
      // Kök çözümlenemiyorsa olduğu gibi kullan.
    }

    const relative = path.relative(rootReal, real).replace(/\\/g, '/');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    return relative.replace(/^\.\//, '');
  }

  /**
   * İzin eşleştirmesinde denetlenecek yol adayları: normalize edilmiş istenen
   * yol ve kanonik gerçek hedef. Symlink ve büyük/küçük harf farkları iki
   * adayda da yakalanır.
   */
  private targetCandidates(target: string): string[] {
    const normalized = this.normalizeTarget(target);
    const candidates = new Set<string>();
    if (normalized) candidates.add(normalized);
    const real = this.realRelativeTarget(target);
    if (real) candidates.add(real);
    return [...candidates];
  }

  /**
   * Aracın güvenlik kurallarıyla tamamen engellenip engellenmediği.
   */
  public isToolBlocked(
    toolName: ToolName,
    args: Record<string, unknown>
  ): { blocked: boolean; reason?: string } {
    const deny = this.projectPermissions?.deny;
    const rawTarget = String(args.path || args.skill_name || '');
    const targetPath = this.normalizeTarget(rawTarget);

    const readTools: ToolName[] = [
      'read_file',
      'list_directory',
      'search_files',
      'read_skill',
      'get_diagnostics',
      'get_definition',
      'get_hover',
      'get_references',
      'get_workspace_symbols',
      'index_workspace',
      'find_symbol',
      'analyze_impact',
      'prepare_pr',
      'search_memory',
      'read_notebook',
      'git_status',
      'git_diff'
    ];

    if (readTools.includes(toolName) && targetPath) {
      // Hassas dosya ve deny kuralları istenen adla VE kanonik gerçek hedefle
      // eşleşir; kök içindeki symlink alternatif adları aşılamaz (F03/F04).
      const candidates = this.targetCandidates(rawTarget);
      for (const candidate of candidates) {
        const criticalRead = PROTECTED_READ_PATHS;
        if (criticalRead.some((glob) => matchPathPattern(glob.toLowerCase(), candidate.toLowerCase()))) {
          return {
            blocked: true,
            reason: `Security: Reading "${candidate}" is blocked because it is a sensitive file.`
          };
        }
      }

      if (deny?.readFiles) {
        for (const candidate of candidates) {
          for (const glob of deny.readFiles) {
            if (matchPathPattern(glob, candidate)) {
              return {
                blocked: true,
                reason: `Reading "${candidate}" is blocked by the .ahi/permissions.json rule.`
              };
            }
          }
        }
      }
    }

    if (toolName === 'write_file' || toolName === 'edit_file') {
      const candidates = targetPath ? this.targetCandidates(rawTarget) : [];

      // Varsayılan hassas dosya koruması deny kurallarından bağımsız uygulanır.
      for (const p of candidates) {
        if (PROTECTED_WRITE_PATHS.some((glob) => matchPathPattern(glob.toLowerCase(), p.toLowerCase()))) {
          return {
            blocked: true,
            reason: `Security: Writing to "${p}" is blocked by default because it is a sensitive file.`
          };
        }
      }

      if (deny?.writeFiles) {
        for (const p of candidates) {
          for (const glob of deny.writeFiles) {
            if (matchPathPattern(glob, p)) {
              return {
                blocked: true,
                reason: `Writing to "${p}" is blocked by the .ahi/permissions.json rule.`
              };
            }
          }
        }
      }
    }

    if (
      toolName === 'execute_command' ||
      toolName === 'run_tests' ||
      toolName === 'run_linter' ||
      toolName === 'run_verification'
    ) {
      const cmd = String(args.command || '').trim();
      const assessment = assessCommand(cmd, this.workspaceRoot);
      if (assessment.risk === 'blocked') {
        return {
          blocked: true,
          reason: `Security: blocked destructive command (${describeAssessment(assessment)}).`
        };
      }

      if (deny?.commands) {
        for (const glob of deny.commands) {
          if (matchCommandPattern(glob, cmd)) {
            return {
              blocked: true,
              reason: `The command "${cmd}" is blocked by the .ahi/permissions.json rule.`
            };
          }
        }
      }
    }

    return { blocked: false };
  }

  /**
   * Bir çalışma alanı izin dosyası kullanıcının global otomatik onay
   * tercihlerini daraltabilir ama asla genişletemez. Aksi hâlde kötü niyetli
   * bir depo `.ahi/permissions.json` içine `autoApprove.executeCommands: true`
   * koyup kullanıcının bilinçli olarak elle bıraktığı komutları sessizce çalıştırabilirdi.
   */
  private effectiveAutoApprove(projectValue: boolean | undefined, globalValue: boolean): boolean {
    if (!globalValue) return false;
    return projectValue !== false;
  }

  /**
   * Proje allow listesi var ama hedefi kapsamıyorsa doğrudur.
   *
   * Liste, kullanıcının ana otomatik onay anahtarından *sonra* uygulanan bir
   * filtredir; yalnızca ajanın daha sık sormasına yol açabilir. Her şeyi
   * yakalayan kalıplar yok sayılır: genel bir izne dönüşemezler.
   */
  private isNarrowedByAllowList(patterns: string[] | undefined, target: string | undefined): boolean {
    const usable = (patterns || []).filter((pattern) => !isBroadPattern(pattern));
    if (usable.length === 0) return false;
    if (!target) return true;
    return !usable.some((pattern) => matchPathPattern(pattern, target));
  }

  private get activeProjectPermissions(): ProjectPermissionsConfig | undefined {
    return this.workspaceTrusted ? this.projectPermissions : undefined;
  }

  public requiresApproval(toolName: ToolName, args: Record<string, unknown>): boolean {
    if (this.configError && MUTATING_POLICIES.has(policyFor(toolName))) {
      return true;
    }

    const allow = this.activeProjectPermissions?.allow;
    const projectAuto = this.activeProjectPermissions?.autoApprove;
    const targetPath = this.normalizeTarget(targetPathFor(toolName, args));

    switch (policyFor(toolName)) {
      case 'read': {
        // Öncelik: deny (isToolBlocked) > ana otomatik onay > allow filtresi.
        // Proje dosyası kullanıcı tercihini daraltabilir, asla genişletemez.
        const autoRead = this.effectiveAutoApprove(
          projectAuto?.readFiles,
          this.settings.autoApprove.readFiles
        );
        if (!autoRead) return true;
        return this.isNarrowedByAllowList(allow?.readFiles, targetPath);
      }

      case 'write': {
        // Akış üst verisi (spec taslağı, kriter işaretleme) yalnızca
        // `.ahi/specs/` altına dokunur. Yazma otomatik onayı kapalı olsa bile
        // onay istemez; aksi hâlde spec onay kartı hiç görünmez ve ajan
        // `write_spec` için 10 dakikalık onay zaman aşımını bekler.
        if (isFlowMetadataTool(toolName)) return false;
        const autoWrite = this.effectiveAutoApprove(
          projectAuto?.writeFiles,
          this.settings.autoApprove.writeFiles
        );
        if (!autoWrite) return true;
        return this.isNarrowedByAllowList(allow?.writeFiles, targetPath);
      }

      case 'git-write':
        return !this.effectiveAutoApprove(projectAuto?.writeFiles, this.settings.autoApprove.writeFiles);

      case 'always':
        return true;

      case 'delegate': {
        // Devretme akış adımıdır: otonom modda kullanıcıyı bekletmez. Alt ajanın
        // kendi yazma/komut çağrıları ayrıca onaya tabidir, bu yüzden burada
        // güvenlik gevşemesi oluşmaz.
        return (this.settings.autonomy ?? 'manual') === 'manual';
      }

      case 'never':
        return false;

      case 'command': {
        const cmd = String(args.command || '');
        const assessment = assessCommand(cmd, this.workspaceRoot);

        // Komut politikası allow listesi tabanlıdır: bilinen güvenli olmayan her
        // komut (yıkıcı, zincirlenmiş, `bash -c "rm -rf ~"` gibi alıntı hileleri ya
        // da tamamen bilinmeyen) otomatik onay ya da proje allow listesi açık olsa
        // bile açık, komut bazlı onay ister.
        if (assessment.risk === 'blocked') {
          return true;
        }

        const autoCmd = this.effectiveAutoApprove(
          projectAuto?.executeCommands,
          this.settings.autoApprove.executeCommands
        );
        if (!autoCmd) {
          return true;
        }

        if (assessment.risk === 'risky') {
          return true;
        }

        // Proje allow listesi hangi güvenli komutların otomatik çalışacağını
        // daraltabilir; kullanıcının elle onayını asla geri açamaz.
        const usable = (allow?.commands || []).filter((pattern) => !isBroadPattern(pattern));
        if (usable.length > 0 && !usable.some((pattern) => matchCommandPattern(pattern, cmd))) {
          return true;
        }
        return false;
      }

      default:
        // Bilinmeyen araçlar güvenli tarafta kalır. Politikası eklenmeden kayıt
        // defterine eklenen yeni bir araç bir şey yapmadan önce onay ister.
        return true;
    }
  }

  /**
   * Bir aracın neden hâlâ onay istediği; doğrudan arayüzde gösterilecek biçimde.
   *
   * Kullanıcı tüm otomatik onay anahtarlarını açsa bile sorulabilir; çünkü bir
   * proje izin dosyası ayarı daraltıyordur ya da komut her zaman risklidir. Bu
   * açıklama olmadan onay hata gibi görünür.
   */
  public explainApproval(toolName: ToolName, args: Record<string, unknown>): string | undefined {
    if (!this.requiresApproval(toolName, args)) return undefined;

    if (this.configError) {
      return `İzin dosyası okunamadı (${this.configError}); güvenlik için her işlem onay ister.`;
    }

    const projectAuto = this.activeProjectPermissions?.autoApprove;
    const isWriteTool = toolName === 'write_file' || toolName === 'edit_file' || toolName === 'write_spec';
    const isCommandTool =
      toolName === 'execute_command' ||
      toolName === 'run_tests' ||
      toolName === 'run_linter' ||
      toolName === 'run_verification';

    if (toolName === 'add_knowledge_note') {
      return "Bilgi tabanı notları sonraki tüm görevlerin prompt'una girdiği için açık kullanıcı onayı gerekir.";
    }

    if (toolName === 'write_knowledge_file') {
      return "Bilgi dosyaları (project/conventions/decisions) sonraki tüm görevlerin prompt'una girdiği için açık kullanıcı onayı gerekir.";
    }

    if (isWriteTool) {
      if (this.settings.autoApprove.writeFiles && projectAuto?.writeFiles === false) {
        return 'Proje izin dosyası (.ahi/permissions.json) yazma otomatik onayını kapatıyor; dosyadaki autoApprove.writeFiles değerini kaldırın veya true yapın.';
      }
      return 'Ayarlar ekranında "Dosya yazma/düzenleme" otomatik onayı kapalı.';
    }

    if (isCommandTool) {
      const assessment = assessCommand(String(args.command || ''), this.workspaceRoot);
      if (assessment.risk === 'risky' || assessment.risk === 'blocked') {
        return 'Riskli komutlar güvenlik için her zaman açık onay ister.';
      }
      if (this.settings.autoApprove.executeCommands && projectAuto?.executeCommands === false) {
        return 'Proje izin dosyası (.ahi/permissions.json) komut otomatik onayını kapatıyor; dosyadaki autoApprove.executeCommands değerini kaldırın veya true yapın.';
      }
      return 'Ayarlar ekranında "Terminal komutları" otomatik onayı kapalı.';
    }

    if (toolName === 'web_fetch' || toolName === 'web_search') {
      return 'Bu araç türü tasarımdan dolayı her zaman onay ister (ağ erişimi).';
    }

    if (toolName === 'invoke_subagent' || toolName === 'run_parallel_tasks') {
      return 'Görev devri elle modda onay ister; otonomi açıkken akışı durdurmaz. Alt ajanın yazma/komut işlemleri yine onaya tabidir.';
    }

    return 'Bu araç onay gerektiriyor.';
  }

  public getToolExplanation(toolName: ToolName, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'read_file':
        return `Read file "${args.path}".`;
      case 'write_file':
        return `Create or write file "${args.path}".`;
      case 'edit_file':
        return `Edit file "${args.path}".`;
      case 'execute_command': {
        const command = String(args.command || '');
        const chained = /[;&|<>`\n]|\$\(/.test(command);
        return (
          `Run terminal command: \`${command}\`` +
          (chained ? ' (contains shell chaining or a pipe; additional commands may run)' : '')
        );
      }
      case 'run_tests':
        return 'Run tests.';
      case 'run_linter':
        return 'Run lint checks.';
      case 'run_verification':
        return 'Verify changes by running tests, lint, and type checks.';
      case 'update_plan':
        return 'Update the task plan.';
      case 'update_module_plan':
        return 'Split the work into layered modules (layer, paths, responsibility, dependencies, owner role).';
      case 'get_references':
        return 'Find all references to a symbol.';
      case 'get_workspace_symbols':
        return `Search workspace symbols for "${args.query || ''}".`;
      case 'index_workspace':
        return 'Build the codebase symbol index.';
      case 'find_symbol':
        return `Search for symbol "${args.query || ''}".`;
      case 'analyze_impact':
        return `Analyze files affected by symbol "${args.symbol || ''}".`;
      case 'git_create_branch':
        return `Create a new Git branch named "${args.name || ''}".`;
      case 'git_commit':
        return 'Save changes as a Git commit.';
      case 'prepare_pr':
        return 'Prepare a pull request description.';
      case 'web_fetch':
        return `Fetch content from "${args.url || ''}".`;
      case 'web_search':
        return `Search the web for "${args.query || ''}".`;
      case 'search_memory':
        return 'Search project memory.';
      case 'read_notebook':
        return 'Read Jupyter notebook contents.';
      case 'run_parallel_tasks':
        return 'Run multiple subagents in parallel.';
      case 'merge_worktree':
        return 'Apply isolated worktree changes to the main workspace.';
      case 'invoke_subagent':
        return `Delegate a task to the "${args.role}" subagent: ${String(args.task || '').slice(0, 200)}`;
      case 'read_skill':
        return `Read instructions for the "${args.skill_name}" skill.`;
      case 'write_knowledge_file':
        return `Propose the content of knowledge file "${args.file || ''}.md" for user approval.`;
      case 'search_files':
        return `Search project files for "${args.query}".`;
      case 'list_directory':
        return `List directory "${args.path || '.'}".`;
      case 'git_diff':
        return 'Review Git changes (diff).';
      case 'get_diagnostics':
        return 'Inspect compiler and linter diagnostics.';
      case 'undo_change':
        return 'Undo the most recent file change.';
      default:
        return `Run the ${toolName} tool.`;
    }
  }

  public async createTemplatePermissions(workspaceRoot: string): Promise<string> {
    const dir = path.join(workspaceRoot, AHI_DIR);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, 'permissions.json');

    const template: ProjectPermissionsConfig = {
      allow: {
        readFiles: ['**/*'],
        writeFiles: ['src/**/*', 'tests/**/*', 'webview-ui/**/*'],
        commands: [
          'npm test*',
          'npm run build*',
          'npm run lint*',
          'npm run typecheck*',
          'git status*',
          'git diff*'
        ]
      },
      deny: {
        writeFiles: ['.env*', '**/*.pem', '**/*.key', 'package-lock.json'],
        commands: ['rm -rf /*', 'git push*', 'mkfs*']
      },
      autoApprove: {
        readFiles: true,
        writeFiles: false,
        executeCommands: false
      }
    };

    await fs.writeFile(target, JSON.stringify(template, null, 2), 'utf-8');
    return target;
  }
}
