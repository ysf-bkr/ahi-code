import * as path from 'path';
import { AHI_DIR, AHI_FILES } from '../../shared/constants';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolName } from '../../shared/types';
import { logWarning } from '../../shared/logging';
import { errorMessage } from '../../shared/errors';
import { sanitizeEnv } from '../verification/CommandRunner';
import { assessCommand, describeAssessment } from '../../shared/commandPolicy';

const execAsync = promisify(exec);

export type HookLifecycle = 'PreToolUse' | 'PostToolUse' | 'Stop';

const HOOK_LIFECYCLES: readonly HookLifecycle[] = ['PreToolUse', 'PostToolUse', 'Stop'];
/** Bozuk bir dosyanın her araç çağrısını toplu işe çevirmemesi için üst sınır. */
const MAX_HOOKS = 50;
/** Hook çıktısı atılır; yalnızca başarı/başarısızlık önemlidir. */
const MAX_HOOK_OUTPUT_BYTES = 1024 * 1024;

export interface HookDefinition {
  lifecycle: HookLifecycle;
  toolMatcher?: string; // Regex or string matching tool name
  command?: string; // Shell command to run
  handler?: (context: HookContext) => Promise<HookResult>;
}

export interface HookContext {
  lifecycle: HookLifecycle;
  toolName?: ToolName | string;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
  workspaceRoot?: string;
}

export interface HookResult {
  proceed: boolean;
  modifiedResult?: string;
  message?: string;
}

/**
 * Deponun bildirdiği hook'ların çalışıp çalışamayacağını kullanıcıya sorar.
 *
 * Parmak izi dosyanın ham içeriğini kapsar, bu yüzden her düzenleme yeniden
 * sorar. MCP hub'ın depo sunucuları için kullandığı sözleşmenin aynısı.
 */
export type HookApprovalRequest = (fingerprint: string, commands: string[]) => Promise<boolean>;

export class HookManager {
  private hooks: HookDefinition[] = [];

  constructor(
    private isWorkspaceTrusted: () => boolean = () => true,
    private requestApproval?: HookApprovalRequest
  ) {}

  /**
   * `.ahi/hooks.json` dosyasını yükler.
   *
   * Hook'lar depodan gelen kabuk komutlarıdır, bu yüzden MCP sunucularıyla
   * aynı kapıya tabidir: güvenilmeyen çalışma alanında asla yüklenmez,
   * güvenilir olanda parmak izi başına açık kullanıcı onayı gerekir. Onay
   * kanalı yoksa (birim testleri, başsız CLI) proje hook'ları hiç yüklenmez:
   * güvenli tarafta kalınır.
   */
  public async loadWorkspaceHooks(workspaceRoot?: string): Promise<void> {
    this.hooks = [];
    if (!workspaceRoot) return;

    if (!this.isWorkspaceTrusted()) {
      return;
    }

    const hookFile = path.join(workspaceRoot, AHI_DIR, AHI_FILES.hooks);
    let raw: string;
    try {
      raw = await fs.readFile(hookFile, 'utf-8');
    } catch {
      return; // hooks.json not found.
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      logWarning('[Hook] hooks.json is not valid JSON; project hooks were not loaded.');
      return;
    }

    const hooks = this.parseHooks(data);
    if (hooks.length === 0) return;

    const commands = hooks.map((hook) => hook.command || '').filter((command) => command.length > 0);
    const fingerprint = crypto.createHash('sha256').update(raw).digest('hex');
    if (commands.length > 0) {
      if (!this.requestApproval) {
        logWarning('[Hook] No approval channel available; project hooks were not loaded.');
        return;
      }
      const approved = await this.requestApproval(fingerprint, commands);
      if (!approved) {
        logWarning('[Hook] Project hooks were not approved by the user; they were not loaded.');
        return;
      }
    }

    this.hooks = hooks;
  }

  /** Dosya içeriğini olduğu gibi kabul etmek yerine doğrular ve normalize eder. */
  private parseHooks(data: unknown): HookDefinition[] {
    if (!data || typeof data !== 'object') return [];
    const rawHooks = (data as { hooks?: unknown }).hooks;
    if (!Array.isArray(rawHooks)) return [];

    const hooks: HookDefinition[] = [];
    for (const item of rawHooks.slice(0, MAX_HOOKS)) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Record<string, unknown>;
      const lifecycle = candidate.lifecycle;
      if (typeof lifecycle !== 'string' || !HOOK_LIFECYCLES.includes(lifecycle as HookLifecycle)) {
        continue;
      }
      const command = typeof candidate.command === 'string' ? candidate.command.trim() : '';
      if (!command) continue;
      const toolMatcher =
        typeof candidate.toolMatcher === 'string' && candidate.toolMatcher.trim()
          ? candidate.toolMatcher.trim()
          : undefined;
      hooks.push({ lifecycle: lifecycle as HookLifecycle, toolMatcher, command });
    }
    return hooks;
  }

  public registerHook(hook: HookDefinition) {
    this.hooks.push(hook);
  }

  public async runPreToolUse(
    toolName: string,
    args: Record<string, unknown>,
    workspaceRoot?: string
  ): Promise<HookResult> {
    return this.executeHooks({
      lifecycle: 'PreToolUse',
      toolName,
      args,
      workspaceRoot
    });
  }

  public async runPostToolUse(
    toolName: string,
    args: Record<string, unknown>,
    result?: string,
    error?: string,
    workspaceRoot?: string
  ): Promise<HookResult> {
    return this.executeHooks({
      lifecycle: 'PostToolUse',
      toolName,
      args,
      result,
      error,
      workspaceRoot
    });
  }

  public async runStop(workspaceRoot?: string): Promise<void> {
    await this.executeHooks({
      lifecycle: 'Stop',
      workspaceRoot
    });
  }

  private async executeHooks(context: HookContext): Promise<HookResult> {
    const applicable = this.hooks.filter((h) => {
      if (h.lifecycle !== context.lifecycle) return false;
      if (h.toolMatcher && context.toolName) {
        try {
          return new RegExp(h.toolMatcher).test(context.toolName);
        } catch {
          // Geçersiz regex tüm ajan döngüsünü engellememeli.
          logWarning(`[Hook] Invalid toolMatcher pattern: ${h.toolMatcher}`);
          return false;
        }
      }
      return true;
    });

    for (const h of applicable) {
      if (h.handler) {
        const res = await h.handler(context);
        if (!res.proceed) return res;
      }

      if (h.command && context.workspaceRoot) {
        // Geri alınamaz komutlar kullanıcı onaylı hook dosyasında bile engellenir:
        // istem enjeksiyonuyla gelen bir hook makineyi silememeli.
        const assessment = assessCommand(h.command);
        if (assessment.risk === 'blocked') {
          logWarning(`[Hook] Blocked a dangerous hook command (${describeAssessment(assessment)}).`);
          continue;
        }
        try {
          const env = {
            ...sanitizeEnv(process.env),
            AHI_HOOK: context.lifecycle,
            AHI_TOOL: context.toolName || '',
            AHI_TOOL_ARGS: JSON.stringify(context.args || {})
          };
          await execAsync(h.command, {
            cwd: context.workspaceRoot,
            env,
            timeout: 15_000,
            maxBuffer: MAX_HOOK_OUTPUT_BYTES
          });
        } catch (err) {
          logWarning(`[Hook Error: ${context.lifecycle}]: ${errorMessage(err)}`);
        }
      }
    }

    return { proceed: true };
  }
}
