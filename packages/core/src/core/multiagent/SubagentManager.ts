import { ModelProvider, ModelCompletionResponse, ProviderMessage } from '../../providers/base';
import { ALL_TOOLS } from '../../tools';
import { ToolDefinition, coerceToolArguments, validateToolArguments, TerminalRunner } from '../../tools/base';
import { ToolCall, ToolName } from '../../shared/types';
import { errorMessage, isRecord } from '../../shared/errors';
import { logWarning } from '../../shared/logging';
import { parseSubagentTaskParams, SubagentTaskParams } from '../../shared/agents/params';
import * as fs from 'fs/promises';
import * as path from 'path';
import { formatTaskGraphResults, runTaskGraph, type TaskNode } from './parallelScheduler';
import type { AgentModelChoice } from '../routing/agentModelPolicy';

import { SkillManager } from '../skills/SkillManager';
import type { LspClientPort } from '../lsp/port';
import { SnapshotManager } from '../snapshot/SnapshotManager';
import { PermissionManager } from '../permission/PermissionManager';
import { policyFor } from '../permission/toolPolicy';
import { CheckpointManager } from '../checkpoint/CheckpointManager';
import { WorktreeManager } from '../worktree/WorktreeManager';
import { SandboxConfig } from '../verification/CommandRunner';
import { ContextManager, trimSmart } from '../context/ContextManager';
import type { HookResult } from '../hooks/HookManager';
import type { CallGraphManager } from '../callgraph/CallGraphManager';
import type { GitManager } from '../git/GitManager';
import {
  BUILT_IN_SUBAGENT_ROLE_IDS,
  getAgentDefinition,
  ROLE_ALIASES,
  AgentDefinition
} from '../../shared/agents';

export type { SubagentTaskParams };

/** Bir `run_parallel_tasks` çağrısında izin verilen en fazla eşzamanlı görev. */
export const MAX_PARALLEL_TASKS = 4;

/** Rol tanımındaki araç adlarını gerçek araç nesnelerine çevirir. */
function toolsForAgent(agent: AgentDefinition): ToolDefinition[] {
  const resolved: ToolDefinition[] = [];
  for (const name of agent.tools) {
    const tool = (ALL_TOOLS as Record<string, ToolDefinition | undefined>)[name];
    if (tool) resolved.push(tool);
  }
  return resolved;
}

/** Dosya/komut durumunu değiştiren araçlar; salt-okunur alt ajanda verilmez. */
const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'execute_command',
  'run_tests',
  'run_linter',
  'run_verification',
  'git_create_branch',
  'git_commit',
  'merge_worktree',
  'write_knowledge_file',
  'add_knowledge_note',
  'undo_change',
  'update_acceptance_criteria'
]);

function buildSubagentPrompt(agent: AgentDefinition): string {
  const parts = [
    `You are the "AhiCode - ${agent.displayName}" (${agent.role}) subagent.`,
    `Identity: ${agent.instructions.identity}`,
    `Mission: ${agent.instructions.mission}`,
    '',
    'MANDATORY CODING STANDARD - STRICT ENGLISH IDENTIFIERS:',
    '- ALL code symbols, types, interfaces, classes, methods, functions, variables, parameters, and filenames MUST BE 100% IN ENGLISH.',
    '- NEVER use Turkish terms in code identifiers or filenames (strictly forbidden: ayarlariAl, MailAyar, ilerlemeBildir; mandatory: getSettings, MailSettings, notifyProgress).',
    '- Brief comments (explaining "why") and user explanations are in Turkish, but all code syntax, types, and identifiers are strictly English.',
    '',
    'Chain of Thought Protocol:',
    agent.instructions.chainOfThought,
    '',
    'Mandatory Discipline Rules:',
    ...agent.instructions.rules.map((rule, idx) => `${idx + 1}. ${rule}`)
  ];
  if (agent.instructions.knowledgeFiles && agent.instructions.knowledgeFiles.length > 0) {
    parts.push('', `Reference Standards: ${agent.instructions.knowledgeFiles.join(', ')}`);
  }
  return parts.join('\n');
}

export interface SubagentStatusDetails {
  tool?: string;
  step?: number;
  maxSteps?: number;
  worktreePath?: string;
  isolate?: boolean;
  state?: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
}

export type SubagentStatusListener = (role: string, status: string, details?: SubagentStatusDetails) => void;

/**
 * Alt ajanın ana ajanla aynı güvenlik/sağlık çıpalarından pay alması için
 * asgari liman arayüzü (denetim m.2/7/8): istek zaman aşımı, gerçek bağlam
 * penceresi, workspace hook'ları ve kaydedilmemiş editör koruması.
 */
export interface SubagentPorts {
  requestTimeoutSeconds?: () => number | undefined;
  contextWindowTokens?: () => number | undefined;
  hookRunner?: () => {
    runPreToolUse(
      toolName: string,
      args: Record<string, unknown>,
      workspaceRoot?: string
    ): Promise<HookResult>;
    runPostToolUse(
      toolName: string,
      args: Record<string, unknown>,
      result?: string,
      error?: string,
      workspaceRoot?: string
    ): Promise<HookResult>;
  };
  /** Dosya kaydedilmemiş editör değişiklikleri taşıyorsa engel gerekçesi. */
  dirtyFileReason?: (absolutePath: string) => string | undefined;
}

export class SubagentManager {
  constructor(
    private provider: ModelProvider,
    private onSubagentStatus?: SubagentStatusListener,
    private skillManager?: SkillManager,
    private lspClient?: LspClientPort,
    private snapshotManager?: SnapshotManager,
    private permissionManager?: PermissionManager,
    private checkpointManager?: CheckpointManager,
    private onAudit?: (tc: ToolCall, decision: string, workspaceRoot?: string) => void,
    private worktreeManager?: WorktreeManager,
    private sandboxProvider?: () => SandboxConfig | undefined,
    private terminalProvider?: () => TerminalRunner | undefined,
    private callGraphManager?: CallGraphManager,
    private gitManager?: GitManager,
    /** Rol + görev için model kararı; yoksa tüm alt ajanlar ana modeli kullanır. */
    private agentModelRouter?: (role: string, task: string) => AgentModelChoice,
    /** Verilen model kimliğiyle sağlayıcı üretir; başarısız olursa undefined. */
    private providerForModel?: (model: string) => ModelProvider | undefined,
    /** Zaman aşımı / bağlam penceresi / hook / kirli editör limanları. */
    private ports?: SubagentPorts
  ) {}

  /**
   * Kullanıcının istek zaman aşımı alt ajanlara da uygulanır (denetim m.2):
   * takılan bir HTTP isteği tüm görevi süresiz bekletmesin.
   */
  private withRequestTimeout(signal?: AbortSignal): AbortSignal | undefined {
    const seconds = this.ports?.requestTimeoutSeconds?.();
    if (!seconds || seconds <= 0 || typeof AbortSignal.timeout !== 'function') return signal;
    const timeout = AbortSignal.timeout(seconds * 1000);
    if (!signal) return timeout;
    return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal;
  }

  /**
   * Alt ajanlar arası salt-okunur dosya önbelleği: aynı dosyayı ikinci bir
   * alt ajan yeniden okuduğunda içerik sağlayıcıya değil önbelleğe döner.
   * Anahtar, yol + mtime; yazma işlemi ya da içerik değişimi anahtarı düşürür.
   * Amaç aynı bilgiyi tekrar tekrar token olarak taşımamak.
   */
  private sharedFileReadCache = new Map<string, { mtimeMs: number; content: string }>();

  /**
   * Anahtar satır aralığını da taşımalıdır: aynı dosyanın farklı offset/limit
   * istekleri ilk aralığın içeriyle "cached" diye dönerse model yanlış içerik
   * görür (denetim bulgusu).
   */
  private static readCacheKey(
    root: string | undefined,
    targetPath: string,
    args?: Record<string, unknown>
  ): string {
    const offset = typeof args?.offset === 'number' ? args.offset : '';
    const limit = typeof args?.limit === 'number' ? args.limit : '';
    return `${root ?? ''}::${targetPath}::${offset}::${limit}`;
  }

  public setSkillManager(skillManager: SkillManager) {
    this.skillManager = skillManager;
  }

  /**
   * Rol için çözümlenmiş sağlayıcıyı döndürür; model kullanılamaz ya da
   * üretilemezse ana sağlayıcıya düşer. Router yalnızca seçili modelden
   * farklı bir model çözüldüğünde `model` alanını doldurur; böylece her alt
   * ajan kendi modelini bağımsız kullanır.
   */
  private providerForRole(
    role: string,
    task: string
  ): {
    provider: ModelProvider;
    choice?: AgentModelChoice;
  } {
    if (!this.agentModelRouter || !this.providerForModel) {
      return { provider: this.provider };
    }
    const choice = this.agentModelRouter(role, task);
    if (choice.model) {
      try {
        const provider = this.providerForModel(choice.model);
        if (provider) return { provider, choice };
      } catch (err) {
        logWarning(`Could not create provider for agent model ${choice.model}`, err);
      }
    }
    return { provider: this.provider, choice };
  }

  /**
   * Model çağrısı merdiveni: yolama ile seçilen uzman model → onun yedeği →
   * kullanıcının seçili ana modeli. Son basamak kritik: uzman model hesapta
   * yok ya da kotası biterse tüm görev ölmek yerine ana modelle sürer — ana
   * model zaten çalışıyor (yönetici onu kullanıyor). Yollanmamış (ana)
   * sağlayıcı hata verirse eski davranış korunur: hata fırlatılır.
   * Mesaj geçmişi korunduğu için bağlam kaybolmaz.
   */
  private async callModel(
    provider: ModelProvider,
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal | undefined,
    choice: AgentModelChoice | undefined,
    onFallback?: (from: string, to: string, reason: string, provider: ModelProvider) => void
  ): Promise<ModelCompletionResponse> {
    const timed = this.withRequestTimeout(signal);
    try {
      return await provider.sendMessage(messages, tools, undefined, timed);
    } catch (err) {
      if (signal?.aborted) throw err;
      let lastError: unknown = err;
      const steps: Array<{ label: string; provider: ModelProvider }> = [];
      const fallback = choice?.fallbackModel;
      if (fallback && this.providerForModel) {
        try {
          const fallbackProvider = this.providerForModel(fallback);
          if (fallbackProvider) steps.push({ label: `yedek model ${fallback}`, provider: fallbackProvider });
        } catch (fallbackErr) {
          logWarning(`Could not create fallback provider ${fallback}`, fallbackErr);
        }
      }
      if (provider !== this.provider) {
        steps.push({ label: 'ana model', provider: this.provider });
      }
      for (const step of steps) {
        onFallback?.(
          choice?.model || 'seçili model',
          step.label,
          errorMessage(lastError, 'model request failed'),
          step.provider
        );
        try {
          return await step.provider.sendMessage(messages, tools, undefined, timed);
        } catch (stepErr) {
          if (signal?.aborted) throw stepErr;
          lastError = stepErr;
        }
      }
      throw lastError;
    }
  }

  public async runSubagent(
    params: SubagentTaskParams,
    workspaceRoot?: string,
    depth: number = 0,
    signal?: AbortSignal,
    isolated = false
  ): Promise<string> {
    if (depth >= 2) {
      return `[Subagent Error]: Maximum subagent depth limit (maxDepth = 2) reached. Recursive subagent calls are blocked.`;
    }

    // Yalıtılmış iş: ana çalışma alanına dokunmadan ayrı bir worktree kullan.
    if (params.isolate && !isolated && workspaceRoot) {
      if (!this.worktreeManager) {
        return '[Subagent Error]: Worktree manager is not ready; isolated work could not be started.';
      }
      const safeRole = params.role.replace(/[^a-zA-Z0-9_-]/g, '-');
      const name = `${safeRole}-${Date.now().toString(36)}`;
      let created: { name: string; path: string; branch: string };
      try {
        created = await this.worktreeManager.create(workspaceRoot, name);
      } catch (err) {
        return `[Subagent Error]: Could not create isolated worktree: ${errorMessage(err)}`;
      }

      this.onSubagentStatus?.(params.role, `Isolated worktree ready: ${created.path}`, {
        worktreePath: created.path,
        isolate: true,
        state: 'starting'
      });
      const innerResult = await this.runSubagent(
        { ...params, isolate: false },
        created.path,
        depth,
        signal,
        true
      );
      const diff = await this.worktreeManager.diff(created.path);
      return `${innerResult}

=== ISOLATED WORK REPORT ===
Worktree: ${created.path}
Branch: ${created.branch}
${diff}

Note: Changes were not automatically applied to the main workspace. Review and approve them before merging; remove the worktree if it is no longer needed.`;
    }

    const resolvedRole = (ROLE_ALIASES[params.role.toLowerCase()] || params.role).toLowerCase();

    // İç içe yönetici çağrısı engellenir; yönetici doğrudan uzmanlara devreder.
    if (depth > 0 && resolvedRole === 'manager') {
      return '[Subagent Error]: Nested managers are not allowed. The manager delegates to specialists directly.';
    }

    // 1. Önce kullanıcının .agents/agents/ altında tanımladığı veya özelleştirdiği ajanı kontrol et
    const customAgents = this.skillManager?.getCustomAgents() || [];
    const custom = customAgents.find(
      (a) =>
        a.name.toLowerCase() === params.role.toLowerCase() ||
        a.role.toLowerCase() === params.role.toLowerCase() ||
        a.name.toLowerCase() === resolvedRole ||
        a.role.toLowerCase() === resolvedRole
    );

    let basePrompt: string | undefined;
    let tools: ToolDefinition[] | undefined;

    if (custom) {
      basePrompt = `You are the customized "AhiCode - ${custom.name}" (${custom.role}) subagent.\nDescription: ${custom.description}\n\nCUSTOM AGENT INSTRUCTIONS:\n${custom.prompt}`;
      const declaredTools =
        custom.allowedTools && custom.allowedTools.length > 0 ? new Set(custom.allowedTools) : null;
      tools = Object.values(ALL_TOOLS).filter((t) => {
        if ((t.name === 'invoke_subagent' || t.name === 'run_parallel_tasks') && resolvedRole !== 'manager') {
          return false;
        }
        if (t.name === 'ask_followup_question' || t.name === 'merge_worktree') {
          return false;
        }
        if (declaredTools) return declaredTools.has(t.name);
        // AGENT.md'de araç belirtilmemişse güvenli varsayılan: salt-okunur.
        return [
          'read_file',
          'list_directory',
          'search_files',
          'read_skill',
          'git_status',
          'git_diff',
          'get_diagnostics',
          'get_definition',
          'get_hover'
        ].includes(t.name);
      });
    } else {
      // 2. Özel tanım yoksa yerleşik Atabey ajan tanımını kullan
      const builtInDef = getAgentDefinition(resolvedRole);
      if (builtInDef) {
        basePrompt = buildSubagentPrompt(builtInDef);
        tools = toolsForAgent(builtInDef);
      } else {
        const available = BUILT_IN_SUBAGENT_ROLE_IDS.join(', ');
        return `[Subagent Error]: No subagent named '${params.role}' was found. Available roles: ${available}, or custom agents defined under .agents/agents.`;
      }
    }

    if (!tools) {
      tools = Object.values(ALL_TOOLS).filter(
        (t) => t.name !== 'invoke_subagent' && t.name !== 'ask_followup_question'
      );
    }

    // Okuma aşamasında ana ajanın aşama kilidi alt ajana da uygulanır; yazma ve
    // komut araçları verilmez. Böylece devretme, spec/plan onayından önce
    // dosya değiştirmenin arka kapısı olmaz.
    if (params.readOnly) {
      // Paralel görevler izole worktree açar ve yazar; okuma modunda gereksiz.
      tools = tools.filter((tool) => !MUTATING_TOOLS.has(tool.name) && tool.name !== 'run_parallel_tasks');
      basePrompt +=
        '\n\nREAD-ONLY MODE: The main agent is still in the analysis stage. Do not modify files and do not run commands; inspect and report only.';
    }

    const allowedToolNames = new Set(tools.map((t) => t.name));

    // Ajan bazlı model kararı: her alt ajan rolüne göre kendi modelini kullanır.
    const { provider: agentProvider, choice: modelChoice } = this.providerForRole(resolvedRole, params.task);
    let activeProvider = agentProvider;

    const customizationContext = this.skillManager?.getPromptContext() || '';
    const systemPrompt = `${basePrompt}
Workspace: ${workspaceRoot || '.'}
TASK: ${params.task}
${params.context ? `ADDITIONAL CONTEXT: ${params.context}` : ''}
${customizationContext}

Complete your task and provide a clear report of the results to the main agent when finished.`;
    const messages: ProviderMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: params.task }
    ];

    // Uzun alt görevlerde istek taşmasın: ana ajanın kullandığı aynı bütçe
    // motoru, kullanıcının bağlam penceresi ayarıyla burada da çalışır
    // (denetim m.2/7). Geçmiş yerinde büyür; modele giden gövde sıkışır.
    const budgetManager = new ContextManager({
      contextWindowTokens: this.ports?.contextWindowTokens?.(),
      tools
    });

    // Adım bütçesi kaldırıldı: alt ajan, model görevi bitirene ya da kullanıcı
    // iptal edene kadar sürer. Kaçak döngü koruması model yanıtı ve iptal
    // sinyalidir; sayısal tur sınırı davranış sürprizi üretiyordu.
    let stepCount = 0;
    this.onSubagentStatus?.(params.role, 'Started...', {
      state: 'starting',
      isolate: isolated,
      worktreePath: isolated ? workspaceRoot : undefined
    });
    if (modelChoice?.model && modelChoice.routed) {
      this.onSubagentStatus?.(
        params.role,
        `Model: ${modelChoice.model}${modelChoice.fallbackModel ? ` (yedek: ${modelChoice.fallbackModel})` : ''}`,
        { state: 'starting' }
      );
    }

    for (;;) {
      if (signal?.aborted) {
        this.onSubagentStatus?.(params.role, 'Cancelled', {
          state: 'cancelled',
          isolate: isolated,
          worktreePath: isolated ? workspaceRoot : undefined
        });
        return `[Subagent (${params.role})]: Task cancelled by the user.`;
      }

      stepCount++;
      let response: ModelCompletionResponse;
      try {
        response = await this.callModel(
          activeProvider,
          budgetManager.pruneMessages(budgetManager.compactHistory(messages), tools),
          tools,
          signal,
          modelChoice,
          (from, to, reason, fallbackProvider) => {
            // Fallback kalıcıdır: sonraki turlar da seçilen sağlayıcıyla sürer,
            // bağlam korunur. Sağlayıcı hazır gelir; "ana model" adından
            // yeniden üretilmez.
            activeProvider = fallbackProvider;
            logWarning(
              `Subagent ${params.role}: model ${from} failed, degrading to another provider`,
              reason
            );
            this.onSubagentStatus?.(params.role, `Model ${from} başarısız; ${to} ile sürüyor.`, {
              state: 'running'
            });
          }
        );
      } catch (err) {
        // Ölüm kalım: uzman + yedek + ana model merdiveni de tükendiyse ham
        // istisna yöneticiyi şaşırtır. Dürüst, okunabilir rapor döner ve alt
        // ajan arayüzü 'başarısız' olarak temizlenir.
        const detail = errorMessage(err, 'Model isteği tamamlanamadı.');
        this.onSubagentStatus?.(params.role, `Failed: ${detail}`, {
          state: 'failed',
          isolate: isolated,
          worktreePath: isolated ? workspaceRoot : undefined
        });
        return `[Subagent Error]: Subagent '${params.role}' could not reach any model (${detail}). The manager should continue this work directly or retry later.`;
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        this.onSubagentStatus?.(params.role, 'Completed', {
          state: 'completed',
          isolate: isolated,
          worktreePath: isolated ? workspaceRoot : undefined
        });
        return `[Subagent (${params.role}) Report]:\n${response.text}`;
      }

      messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls
      });

      for (const tc of response.toolCalls) {
        this.onSubagentStatus?.(params.role, `Running ${tc.name}...`, {
          tool: tc.name,
          step: stepCount,
          state: 'running',
          isolate: isolated,
          worktreePath: isolated ? workspaceRoot : undefined
        });

        const auditTc = {
          id: tc.id,
          name: tc.name as ToolName,
          args: tc.arguments || {},
          requiresApproval: false,
          status: 'pending'
        } as ToolCall;

        if (!allowedToolNames.has(tc.name as ToolName)) {
          this.onAudit?.(auditTc, 'subagent_unauthorized', workspaceRoot);
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            content: `[Authorization Error]: Subagent '${params.role}' is not allowed to use tool '${tc.name}'. Use only permitted tools.`
          });
          continue;
        }

        // Ana ajanın allow/deny kuralları alt ajanlar için de geçerlidir.
        const blockCheck = this.permissionManager?.isToolBlocked(tc.name as ToolName, tc.arguments);
        if (blockCheck?.blocked) {
          this.onAudit?.(auditTc, 'subagent_blocked', workspaceRoot);
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            content: `[Permission Error]: ${blockCheck.reason}`
          });
          continue;
        }

        // Alt ajan kullanıcı onayı gerektiren işlemi yapamaz; ana ajan bu
        // işlemi normal onay akışından geçirmelidir. Karar hardcoded bir araç
        // listesinden değil, ana ajanın kullandığı aynı politika tablosundan
        // gelir; böylece okuma onayı kapatılmışsa ya da 'always' politikalı
        // araçlar (ağ, kalıcı bilgi kanalları) alt ajanda sessizce çalışamaz
        // (denetim bulgusu F05). Devretme ('delegate') ve akış araçları
        // ('never') onay istemez; undo_change yalnızca ana akışa aittir.
        const policy = policyFor(tc.name as ToolName);
        const approvalRequired =
          tc.name === 'undo_change' ||
          policy === 'always' ||
          policy === 'unknown' ||
          (policy !== 'never' &&
            policy !== 'delegate' &&
            this.permissionManager?.requiresApproval(tc.name as ToolName, tc.arguments || {}) === true);
        if (approvalRequired) {
          this.onAudit?.(auditTc, 'subagent_approval_required', workspaceRoot);
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            content:
              `[Approval Required]: '${tc.name}' requires user approval. ` +
              'The subagent cannot perform this operation directly; the main agent must use the approval flow or ' +
              'ask the user to enable automatic approvals.'
          });
          continue;
        }

        const toolDef = (ALL_TOOLS as Record<string, ToolDefinition | undefined>)[tc.name];
        if (toolDef) {
          tc.arguments = coerceToolArguments(toolDef, tc.arguments);
          const argError = validateToolArguments(toolDef, tc.arguments);
          if (argError) {
            messages.push({
              role: 'tool',
              toolCallId: tc.id,
              content: `[Argument Error]: ${argError}`
            });
            continue;
          }

          // Kirli editör koruması (denetim m.8): alt ajan da kaydedilmemiş
          // kullanıcı değişikliklerinin üstüne sessizce yazamaz.
          const dirtyTarget = tc.arguments?.path;
          if (
            (tc.name === 'write_file' || tc.name === 'edit_file') &&
            typeof dirtyTarget === 'string' &&
            dirtyTarget &&
            this.ports?.dirtyFileReason
          ) {
            const absoluteTarget = path.isAbsolute(dirtyTarget)
              ? dirtyTarget
              : path.resolve(workspaceRoot || process.cwd(), dirtyTarget);
            const dirtyReason = this.ports.dirtyFileReason(absoluteTarget);
            if (dirtyReason) {
              this.onAudit?.(auditTc, 'subagent_dirty_editor', workspaceRoot);
              messages.push({ role: 'tool', toolCallId: tc.id, content: `[Blocked]: ${dirtyReason}` });
              continue;
            }
          }

          // Workspace hook'ları alt ajanlara da uygulanır (denetim m.8):
          // PreToolUse herhangi bir aracı bloklayabilir.
          const hookRunner = this.ports?.hookRunner?.();
          if (hookRunner) {
            const preHook = await hookRunner.runPreToolUse(tc.name, tc.arguments ?? {}, workspaceRoot);
            if (!preHook.proceed) {
              this.onAudit?.(auditTc, 'subagent_hook_blocked', workspaceRoot);
              messages.push({
                role: 'tool',
                toolCallId: tc.id,
                content: `[Blocked by hook]: ${preHook.message || 'The PreToolUse hook rejected this tool.'}`
              });
              continue;
            }
          }
          try {
            // Delege araçları araç yürütücüsünde kaybolmaz; derinlik artırılarak
            // gerçekten yürütülür (bkz. `runDelegatedCall`).
            if (tc.name === 'invoke_subagent' || tc.name === 'run_parallel_tasks') {
              const delegated = await this.runDelegatedCall(
                tc.name,
                tc.arguments ?? {},
                workspaceRoot,
                depth,
                signal,
                isolated,
                params.readOnly === true
              );
              if ('error' in delegated) {
                messages.push({ role: 'tool', toolCallId: tc.id, content: delegated.error });
                continue;
              }
              this.onAudit?.(
                auditTc,
                tc.name === 'invoke_subagent' ? 'subagent_delegated' : 'subagent_delegated_parallel',
                workspaceRoot
              );
              messages.push({
                role: 'tool',
                toolCallId: tc.id,
                content: trimSmart(delegated.output, 6000, `${tc.name} output`)
              });
              continue;
            }

            // Alt ajanın dosya değişiklikleri de geri alınabilir olmalı.
            // Yalıtılmış worktree'deki yollar farklı kök kullanır, bu yüzden ana checkpoint'e bağlanmaz.
            const subagentPath = tc.arguments?.path;

            // Salt-okunur paylaşımlı önbellek: aynı dosyayı ikinci alt ajan
            // yeniden okumaz; mtime değişmediyse içerik doğrudan döner.
            if (tc.name === 'read_file' && typeof subagentPath === 'string' && subagentPath) {
              const cacheKey = SubagentManager.readCacheKey(workspaceRoot, subagentPath, tc.arguments);
              try {
                const stat = await fs.stat(
                  path.isAbsolute(subagentPath)
                    ? subagentPath
                    : path.resolve(workspaceRoot || process.cwd(), subagentPath)
                );
                const cached = this.sharedFileReadCache.get(cacheKey);
                if (cached && cached.mtimeMs === stat.mtimeMs) {
                  this.onAudit?.(auditTc, 'subagent_cached_read', workspaceRoot);
                  messages.push({
                    role: 'tool',
                    toolCallId: tc.id,
                    content: `${cached.content}\n\n[cached: this file was already read in this session and has not changed; no need to read it again]`
                  });
                  continue;
                }
              } catch {
                // stat alınamıyorsa normal okuma yolu dener ve gerçek hatayı verir.
              }
            }

            if (
              !isolated &&
              (tc.name === 'write_file' || tc.name === 'edit_file') &&
              this.snapshotManager &&
              typeof subagentPath === 'string' &&
              subagentPath
            ) {
              try {
                const snapshotId = await this.snapshotManager.createSnapshot(
                  subagentPath,
                  workspaceRoot,
                  tc.id,
                  `Subagent (${params.role}) file change`
                );
                this.checkpointManager?.addSnapshotToLatestCheckpoint(snapshotId);
              } catch {
                // Anlık görüntü oluşturulamazsa araç kendi güvenlik kontrolleriyle devam eder.
              }
            }

            const result = await toolDef.execute(tc.arguments, {
              workspaceRoot,
              lspClient: this.lspClient,
              snapshotManager: this.snapshotManager,
              permissionManager: this.permissionManager,
              sandbox: this.sandboxProvider?.(),
              terminal: this.terminalProvider?.(),
              callGraph: this.callGraphManager,
              gitManager: this.gitManager,
              signal
            });
            this.onAudit?.(auditTc, 'subagent_completed', workspaceRoot);
            messages.push({
              role: 'tool',
              toolCallId: tc.id,
              content: trimSmart(result, 6000, `${tc.name} output`)
            });
            if (hookRunner) {
              // PostToolUse en iyi çabadır: hook başarısızlığı aracı geriye dönük kırmaz.
              void hookRunner
                .runPostToolUse(
                  tc.name,
                  tc.arguments ?? {},
                  trimSmart(result, 2_000, 'hook result'),
                  undefined,
                  workspaceRoot
                )
                .catch((hookErr) => logWarning('Subagent PostToolUse hook failed', hookErr));
            }

            // Okuma önbelleği: dosya içeride değişmeden tekrar sorulmasın.
            if (tc.name === 'read_file' && typeof subagentPath === 'string' && subagentPath) {
              try {
                const stat = await fs.stat(
                  path.isAbsolute(subagentPath)
                    ? subagentPath
                    : path.resolve(workspaceRoot || process.cwd(), subagentPath)
                );
                // Trim'li hâli sakla: önbellek isabetiyle normal okuma aynı
                // boyut ve biçimde dönsün.
                this.sharedFileReadCache.set(
                  SubagentManager.readCacheKey(workspaceRoot, subagentPath, tc.arguments),
                  {
                    mtimeMs: stat.mtimeMs,
                    content: trimSmart(result, 6000, `${tc.name} output`)
                  }
                );
              } catch {
                // Okunamayan dosya zaten hata döndürmüştür; önbelleğe yazılmaz.
              }
            }
            // Yazma: dosyanın TÜM satır aralığı anahtarlarını düşür; bayat
            // içerik hangi aralıkla istenirse istensin bir daha dönmesin.
            if ((tc.name === 'write_file' || tc.name === 'edit_file') && typeof subagentPath === 'string') {
              const invalidated = `${workspaceRoot ?? ''}::${subagentPath}::`;
              for (const key of this.sharedFileReadCache.keys()) {
                if (key.startsWith(invalidated)) this.sharedFileReadCache.delete(key);
              }
            }
          } catch (err) {
            this.onAudit?.(auditTc, 'subagent_error', workspaceRoot);
            messages.push({
              role: 'tool',
              toolCallId: tc.id,
              content: `Error: ${errorMessage(err)}`
            });
          }
        } else {
          // Her araç çağrısı bir araç yanıtı almalı (API tutarlılığı).
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            content: `[Error]: No tool named '${tc.name}' was found.`
          });
        }
      }
    }
  }

  /**
   * Yönetici rolünün delege araçlarını yürütür.
   *
   * `invoke_subagent` tek bir uzmanı, `run_parallel_tasks` bağımsız uzmanları
   * paralel çalıştırır. Derinlik artırılır; sınır `runSubagent` içindedir.
   */
  private async runDelegatedCall(
    toolName: string,
    args: Record<string, unknown>,
    workspaceRoot: string | undefined,
    depth: number,
    signal: AbortSignal | undefined,
    isolated: boolean,
    readOnly = false
  ): Promise<{ output: string } | { error: string }> {
    if (toolName === 'invoke_subagent') {
      let delegated: SubagentTaskParams;
      try {
        delegated = parseSubagentTaskParams(args);
      } catch (err) {
        return { error: `[Argument Error]: ${errorMessage(err)}` };
      }
      // Okuma modu zincir boyunca taşınır: kısıtlı bir alt ajan, kendi
      // devrettiği uzmana yazma yetkisi veremez.
      return {
        output: await this.runSubagent(
          { ...delegated, readOnly: readOnly || delegated.readOnly === true },
          workspaceRoot,
          depth + 1,
          signal,
          isolated
        )
      };
    }

    const raw = args.tasks;
    const list = Array.isArray(raw) ? raw : [];
    const tasks: Array<TaskNode<SubagentTaskParams>> = list
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item, index) => ({
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `task-${index + 1}`,
        role: typeof item.role === 'string' ? item.role : 'backend',
        payload: {
          role: typeof item.role === 'string' ? item.role : 'backend',
          task: typeof item.task === 'string' ? item.task : '',
          context: typeof item.context === 'string' ? item.context : undefined,
          isolate: item.isolate === true,
          // Okuma modu paralel görevlere de geçer.
          readOnly: readOnly || item.readOnly === true
        },
        dependsOn: Array.isArray(item.dependsOn)
          ? item.dependsOn.filter((dep): dep is string => typeof dep === 'string')
          : []
      }))
      .filter((node) => node.payload.task.trim().length > 0);

    if (tasks.length === 0) {
      return { error: '[Argument Error]: At least one parallel task is required.' };
    }

    // Paralel görev sayısı sınırlanır: sınırsız Promise.all bellek, API hız
    // sınırı ve terminal çakışması riski taşır. Fazlası açıkça reddedilir.
    if (tasks.length > MAX_PARALLEL_TASKS) {
      return {
        error: `[Argument Error]: At most ${MAX_PARALLEL_TASKS} parallel tasks are allowed (received ${tasks.length}).`
      };
    }

    try {
      const results = await runTaskGraph(
        tasks,
        (node) => this.runSubagent(node.payload, workspaceRoot, depth + 1, signal, isolated),
        { maxConcurrency: MAX_PARALLEL_TASKS }
      );
      return { output: formatTaskGraphResults(results) };
    } catch (err) {
      return { error: `[Argument Error]: ${errorMessage(err)}` };
    }
  }
}
