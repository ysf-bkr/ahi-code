import { ModelProvider, ProviderMessage } from '../../providers/base';
import { ALL_TOOLS } from '../../tools';
import { ToolDefinition, coerceToolArguments, validateToolArguments, TerminalRunner } from '../../tools/base';
import { ToolCall, ToolName } from '../../shared/types';
import { errorMessage, isRecord } from '../../shared/errors';
import { parseSubagentTaskParams, SubagentTaskParams } from '../../shared/agents/params';

import { SkillManager } from '../skills/SkillManager';
import type { LspClient } from '../lsp/LspClient';
import { SnapshotManager } from '../snapshot/SnapshotManager';
import { PermissionManager } from '../permission/PermissionManager';
import { policyFor } from '../permission/toolPolicy';
import { CheckpointManager } from '../checkpoint/CheckpointManager';
import { WorktreeManager } from '../worktree/WorktreeManager';
import { SandboxConfig } from '../verification/CommandRunner';
import { trimSmart } from '../context/ContextManager';
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

export class SubagentManager {
  constructor(
    private provider: ModelProvider,
    private onSubagentStatus?: SubagentStatusListener,
    private skillManager?: SkillManager,
    private lspClient?: LspClient,
    private snapshotManager?: SnapshotManager,
    private permissionManager?: PermissionManager,
    private checkpointManager?: CheckpointManager,
    private onAudit?: (tc: ToolCall, decision: string, workspaceRoot?: string) => void,
    private worktreeManager?: WorktreeManager,
    private sandboxProvider?: () => SandboxConfig | undefined,
    private terminalProvider?: () => TerminalRunner | undefined,
    private callGraphManager?: CallGraphManager,
    private gitManager?: GitManager
  ) {}

  public setSkillManager(skillManager: SkillManager) {
    this.skillManager = skillManager;
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

    let maxSteps = 8;
    this.onSubagentStatus?.(params.role, 'Started...', {
      state: 'starting',
      maxSteps: 8,
      isolate: isolated,
      worktreePath: isolated ? workspaceRoot : undefined
    });

    while (maxSteps > 0) {
      if (signal?.aborted) {
        this.onSubagentStatus?.(params.role, 'Cancelled', {
          state: 'cancelled',
          isolate: isolated,
          worktreePath: isolated ? workspaceRoot : undefined
        });
        return `[Subagent (${params.role})]: Task cancelled by the user.`;
      }

      maxSteps--;
      const response = await this.provider.sendMessage(messages, tools, undefined, signal);

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
          step: 8 - maxSteps,
          maxSteps: 8,
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

    this.onSubagentStatus?.(params.role, 'Completed', {
      state: 'completed',
      isolate: isolated,
      worktreePath: isolated ? workspaceRoot : undefined
    });

    return `[Subagent (${params.role})]: Maximum step limit (8) reached. Partial results are included in the tool outputs above.`;
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
    const tasks: SubagentTaskParams[] = list
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        role: typeof item.role === 'string' ? item.role : 'backend',
        task: typeof item.task === 'string' ? item.task : '',
        context: typeof item.context === 'string' ? item.context : undefined,
        isolate: item.isolate === true,
        // Okuma modu paralel görevlere de geçer.
        readOnly: readOnly || item.readOnly === true
      }))
      .filter((item) => item.task.trim().length > 0);

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

    const results = await Promise.all(
      tasks.map((task) => this.runSubagent(task, workspaceRoot, depth + 1, signal, isolated))
    );
    return { output: results.join('\n\n') };
  }
}
