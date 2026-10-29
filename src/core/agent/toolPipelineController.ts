/**
 * Araç hattı denetleyicisi.
 *
 * Bir araç çağrısının iki aşaması burada: **hazırlık** (aşama kilidi, izin
 * kuralları, kaydedilmemiş editör koruması, diff önizlemesi, sorular, hook'lar,
 * kullanıcı onayı, yazma öncesi snapshot) ve **yürütme** (özel araçlar ve
 * genel araç yolu + komut checkpoint'i).
 *
 * `AgentCore` yalnızca ince delegasyon tutar.
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { ToolCall, ToolName } from '../../shared/types';
import { isRecord } from '../../shared/errors';
import { errorMessage } from '../../shared/errors';
import { AHI_DIR, AHI_SUBDIRS } from '../../shared/constants';
import { resolveWorkspacePath } from '../../tools/pathSafety';
import { coerceToolArguments, validateToolArguments, ToolDefinition } from '../../tools/base';
import { parsePlanUpdateInput, parseSubagentTaskParams } from '../../tools/parsers';
import { logWarning } from '../../shared/logging';
import type { AgentHost } from './agentHost';
import type { SubagentTaskParams } from '../multiagent/SubagentManager';
import { ROLE_ALIASES, getAgentDefinition } from '../../shared/agents';
import { skipsApprovalGates } from './autonomy';

/** Araç argümanından metin okur. */
function toolArgString(args: Record<string, unknown>, key: string, fallback = ''): string {
  const value = args[key];
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function toolArgBoolean(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true || args[key] === 'true';
}

export class ToolPipelineController {
  constructor(private host: AgentHost) {}

  /**
   * Pre-execution gate chain for a single tool call: stage/mode lock,
   * argument coercion, project deny rules, unsaved-editor guard, diff
   * preview, follow-up questions, PreToolUse hooks, the user-approval wait,
   * and the pre-write snapshot.
   *
   * - 'abort-turn': the whole turn must stop (cancellation, session change).
   * - 'skip': this call is settled (blocked, rejected, or answered); continue
   *   with the next call.
   * - 'execute': all gates passed; the call is marked 'executing'.
   */
  public async prepareToolCall(
    tc: ToolCall,
    context: {
      allowedToolNames: Set<ToolName>;
      tools: ToolDefinition[];
      workspaceRoot: string | undefined;
      generation: number;
    }
  ): Promise<'abort-turn' | 'skip' | 'execute'> {
    const { allowedToolNames, tools, workspaceRoot, generation } = context;

    // Stage/mode lock is authoritative: a model can hallucinate a tool that
    // was filtered out (or replay an old call), so every branch below must
    // respect the same allowlist instead of trusting the tool list lookup.
    if (!allowedToolNames.has(tc.name)) {
      tc.status = 'error';
      tc.error = `Tool is not allowed at this stage: ${tc.name}.`;
      await this.host.auditTool(tc, workspaceRoot, 'blocked');
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'skip';
    }

    const loopToolDef = tools.find((tool) => tool.name === tc.name);
    if (loopToolDef) {
      tc.args = coerceToolArguments(loopToolDef, tc.args);
    }

    // 1. Check Project Permissions (Deny Rules)
    const blockCheck = this.host.permissionManager.isToolBlocked(tc.name, tc.args);
    if (blockCheck.blocked) {
      tc.status = 'error';
      tc.error = blockCheck.reason;
      await this.host.auditTool(tc, workspaceRoot, 'blocked');
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'skip';
    }

    // 1.5 Prevent conflicts with unsaved editor changes.
    const targetPath = toolArgString(tc.args, 'path');
    if ((tc.name === 'write_file' || tc.name === 'edit_file') && targetPath && workspaceRoot) {
      try {
        const target = resolveWorkspacePath(targetPath, workspaceRoot);
        const dirtyDoc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === target && d.isDirty);
        if (dirtyDoc) {
          tc.status = 'error';
          tc.error = `"${targetPath}" contains unsaved editor changes. Save or revert them first.`;
          await this.host.saveCurrentState();
          this.host.emitState();
          return 'skip';
        }
      } catch {
        // Invalid path: the tool's own path validation will report the error.
      }
    }

    // 2. Open a visual diff preview when approval is required (avoid cluttering tabs for automatic approvals).
    // Diff önizlemesi onaydan bağımsızdır: otomatik onay açık olsa bile
    // kullanıcı değişikliği editörde kıyaslayabilsin. Ayar kapatılabilir.
    const showDiff = this.host.settings.showDiffBeforeWrite !== false;
    if (tc.requiresApproval || showDiff) {
      const content = toolArgString(tc.args, 'content');
      if (tc.name === 'write_file' && targetPath && content) {
        await this.host.openDiffPreview(targetPath, content);
      } else if (tc.name === 'edit_file' && targetPath) {
        try {
          const safePath = resolveWorkspacePath(targetPath, workspaceRoot);
          const current = await fs.readFile(safePath, 'utf-8');
          const targetText = toolArgString(tc.args, 'targetText');
          const replacementText = toolArgString(tc.args, 'replacementText');
          const allowMultiple = toolArgBoolean(tc.args, 'allowMultiple');
          const occurrences = targetText ? current.split(targetText).length - 1 : 0;
          // Do not show a misleading diff for an ambiguous target; the tool will report an error.
          if (occurrences === 1 || (occurrences > 1 && allowMultiple)) {
            const modified = allowMultiple
              ? current.split(targetText).join(replacementText)
              : current.replace(targetText, () => replacementText);
            await this.host.openDiffPreview(targetPath, modified);
          }
        } catch (diffErr) {
          // Yol geçersizse ya da diff açılamazsa araç kendi güvenlik
          // kontrolleriyle devam eder; yine de nedeni görünür olsun.
          logWarning('Diff önizlemesi oluşturulamadı', diffErr);
        }
      }
    }

    // 4. ask_followup_question: PAUSE THE AGENT AND WAIT FOR USER INPUT!
    // Otonom modda kullanıcıyı beklemek "baştan sona bitir" sözleşmesini bozar.
    // Soru yine görünür, ancak ajan en makul varsayımla ilerler ve varsayımı
    // spec'e yazmakla yükümlüdür.
    if (tc.name === 'ask_followup_question' && skipsApprovalGates(this.host.settings)) {
      tc.status = 'completed';
      tc.result =
        `[Autonomy] Soru kullanıcıya sorulmadı (otonomi: ${this.host.settings.autonomy}). ` +
        `En makul varsayımla ilerle ve varsayımı spec'in assumptions alanına ekle. Soru: ` +
        toolArgString(tc.args, 'question');
      await this.host.auditTool(tc, workspaceRoot, 'auto_answered');
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'skip';
    }

    if (tc.name === 'ask_followup_question') {
      tc.status = 'executing';
      let questionResolver: ((answer: string) => void) | undefined;
      const answerPromise = new Promise<string>((resolve) => {
        const timer = setTimeout(
          () => {
            if (this.host.pendingQuestionResolver === questionResolver) {
              this.host.pendingQuestionResolver = undefined;
              resolve('The user did not respond in time; skip this step and continue.');
            }
          },
          10 * 60 * 1000
        );
        timer.unref?.();
        questionResolver = (answer) => {
          clearTimeout(timer);
          resolve(answer);
        };
      });

      this.host.pendingQuestionResolver = questionResolver;
      this.host.state.status = 'waiting_user_input';
      this.host.state.pendingQuestion = {
        toolCallId: tc.id,
        question: toolArgString(
          tc.args,
          'question',
          'Please provide the clarification you would like to make:'
        )
      };
      await this.host.auditTool(tc, workspaceRoot, 'waiting_user_input');
      await this.host.saveCurrentState();
      this.host.emitState();

      const userAnswer = await answerPromise;

      // Do not modify the new session's state if the session changed.
      if (generation !== this.host.runGeneration) {
        return 'abort-turn';
      }

      this.host.state.pendingQuestion = undefined;

      // Do not leave the loop in the "running" state if the task was cancelled while waiting for an answer.
      if (this.host.isCancelled) {
        this.host.state.status = 'cancelled';
        tc.status = 'rejected';
        tc.error = 'The user cancelled the operation.';
        await this.host.saveCurrentState();
        this.host.emitState();
        return 'abort-turn';
      }

      this.host.state.status = 'running';
      tc.status = 'completed';
      tc.result = `User response: ${userAnswer}`;
      await this.host.auditTool(tc, workspaceRoot, 'completed');
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'skip';
    }

    // 5. PreToolUse Hook
    const preHook = await this.host.hookManager.runPreToolUse(tc.name, tc.args, workspaceRoot);
    if (!preHook.proceed) {
      tc.status = 'rejected';
      tc.error = preHook.message || 'Blocked by the PreToolUse hook.';
      await this.host.auditTool(tc, workspaceRoot, 'hook_blocked');
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'skip';
    }

    // 6. User Approval check
    if (tc.requiresApproval) {
      let approvalResolver: ((app: boolean, reason?: string) => void) | undefined;
      const approvalPromise = new Promise<boolean>((resolve) => {
        const timer = setTimeout(
          () => {
            if (this.host.pendingResolver === approvalResolver) {
              this.host.pendingResolver = undefined;
              tc.error = 'Approval timed out (10 minutes).';
              resolve(false);
            }
          },
          10 * 60 * 1000
        );
        timer.unref?.();
        approvalResolver = (app, reason) => {
          clearTimeout(timer);
          if (!app) {
            tc.error = reason || 'Rejected by the user.';
          }
          resolve(app);
        };
      });

      this.host.pendingResolver = approvalResolver;
      this.host.state.status = 'waiting_approval';
      this.host.state.pendingToolCall = tc;
      await this.host.saveCurrentState();
      this.host.emitState();

      const approved = await approvalPromise;

      // Do not modify the new session's state if the session changed.
      if (generation !== this.host.runGeneration) {
        return 'abort-turn';
      }

      this.host.state.pendingToolCall = undefined;

      // Do not leave the task in the "running" state if it was cancelled while awaiting approval.
      if (this.host.isCancelled) {
        this.host.state.status = 'cancelled';
        tc.status = 'rejected';
        tc.error = tc.error || 'The user cancelled the task.';
        await this.host.saveCurrentState();
        this.host.emitState();
        return 'abort-turn';
      }

      this.host.state.status = 'running';

      if (!approved) {
        tc.status = 'rejected';
        tc.error = tc.error || 'Rejected by the user.';
        await this.host.auditTool(tc, workspaceRoot, 'rejected');
        await this.host.saveCurrentState();
        this.host.emitState();
        return 'skip';
      }
    }

    // 7. Snapshot files immediately before approval (rejected operations do not pollute the undo stack).
    if ((tc.name === 'write_file' || tc.name === 'edit_file') && tc.args.path) {
      try {
        const snapshotId = await this.host.snapshotManager.createSnapshot(
          targetPath,
          workspaceRoot,
          tc.id,
          tc.explanation
        );
        // Attach the snapshot to this turn's checkpoint so a rewind also restores these files.
        this.host.checkpointManager.addSnapshotToLatestCheckpoint(snapshotId);
      } catch (snapshotErr) {
        this.host.notify({
          level: 'warning',
          message: `Dosya değişikliği için geri alma anlık görüntüsü oluşturulamadı: ${errorMessage(snapshotErr)}`
        });
      }
    }

    tc.status = 'executing';
    this.host.emitState();
    return 'execute';
  }

  /**
   * Executes a single prepared tool call: the special tools (parallel
   * subagents, worktree merge, plan and spec interception, subagent
   * delegation) and the generic tool path with command checkpoints.
   *
   * - paused: the turn must stop for a spec/plan approval card.
   * - filesChanged: the call may have modified files; the caller triggers
   *   the quick-verification loop.
   */
  public async executeToolCall(
    tc: ToolCall,
    context: {
      modelToolCalls: ToolCall[];
      tools: ToolDefinition[];
      workspaceRoot: string | undefined;
    }
  ): Promise<{ paused: boolean; filesChanged: boolean }> {
    const { modelToolCalls, tools, workspaceRoot } = context;

    if (tc.name === 'run_parallel_tasks') {
      try {
        const rawTasks = tc.args.tasks;
        if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
          throw new Error('At least one parallel task is required.');
        }
        if (rawTasks.length > 4) {
          throw new Error('A maximum of 4 parallel tasks can run at the same time.');
        }
        const tasks: SubagentTaskParams[] = rawTasks
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map((item) => ({
            role: typeof item.role === 'string' ? item.role : 'coder',
            task: typeof item.task === 'string' ? item.task : '',
            context: typeof item.context === 'string' ? item.context : undefined,
            isolate: true
          }))
          .filter((item) => item.task.trim().length > 0);
        if (tasks.length === 0) throw new Error('No valid task definitions found.');

        const results = await Promise.all(
          tasks.map((task, index) =>
            this.host.subagentManager
              .runSubagent(task, workspaceRoot, 0, this.host.activeAbortController?.signal)
              .then((result) => `## Parallel task ${index + 1} (${task.role})\n${result}`)
          )
        );
        tc.status = 'completed';
        tc.result = results.join('\n\n');
      } catch (err) {
        tc.status = 'error';
        tc.error = errorMessage(err, 'Could not run parallel tasks.');
      }
      return { paused: false, filesChanged: false };
    }

    if (tc.name === 'merge_worktree') {
      try {
        if (!workspaceRoot) throw new Error('Workspace not found.');
        const worktreePath = toolArgString(tc.args, 'path');
        const root = path.resolve(workspaceRoot);
        const resolvedWorktree = path.isAbsolute(worktreePath)
          ? path.resolve(worktreePath)
          : path.resolve(workspaceRoot, worktreePath);
        const allowedRoot = path.join(root, AHI_DIR, AHI_SUBDIRS.worktrees);
        if (!worktreePath || !resolvedWorktree.startsWith(`${allowedRoot}${path.sep}`)) {
          throw new Error('Only worktrees under .ahi/worktrees can be merged.');
        }
        const message = await this.host.worktreeManager.mergeDiffIntoMain(resolvedWorktree, workspaceRoot);
        tc.status = 'completed';
        tc.result = message;
      } catch (err) {
        tc.status = 'error';
        tc.error = errorMessage(err, 'Could not merge worktree.');
      }
      return { paused: false, filesChanged: false };
    }

    if (tc.name === 'update_plan') {
      try {
        const plan = this.host.planner.update(parsePlanUpdateInput(tc.args));
        this.host.state.plan = plan;
        tc.status = 'completed';
        tc.result = this.host.planner.formatForTool();

        // A plan drafted after spec approval must be confirmed by the user
        // before any code is written.
        if (await this.host.workflow.pauseForPlanApproval(plan, modelToolCalls, tc.id)) {
          return { paused: true, filesChanged: false };
        }
      } catch (err) {
        tc.status = 'error';
        tc.error = errorMessage(err, 'Could not update the task plan.');
      }
      return { paused: false, filesChanged: false };
    }

    if (tc.name === 'invoke_subagent') {
      const subParams = parseSubagentTaskParams(tc.args);
      const resolvedRole = (ROLE_ALIASES[subParams.role.toLowerCase()] || subParams.role).toLowerCase();
      if (resolvedRole !== 'manager') {
        tc.status = 'error';
        tc.error =
          `[Subagent Error]: Only the @manager role can be started at the top level. ` +
          `Delegate the task to @manager with a clear goal; the manager picks and runs the specialists (${subParams.role} included).`;
        return { paused: false, filesChanged: false };
      }
      const def = getAgentDefinition(resolvedRole);
      this.host.state.activeSubagent = {
        role: subParams.role,
        displayName: def?.displayName || subParams.role,
        task: subParams.task,
        status: 'starting',
        isolate: subParams.isolate,
        startedAt: Date.now()
      };
      this.host.emitState();
      try {
        const snapshotCountBefore = this.host.snapshotManager.getSnapshots().length;
        const result = await this.host.subagentManager.runSubagent(
          subParams,
          workspaceRoot,
          0,
          this.host.activeAbortController?.signal
        );
        tc.status = 'completed';
        tc.result = result;
        // Trigger the main agent's verification loop if a subagent changed files.
        if (this.host.snapshotManager.getSnapshots().length > snapshotCountBefore) {
          return { paused: false, filesChanged: true };
        }
      } catch (err) {
        tc.status = 'error';
        tc.error = errorMessage(err, 'An error occurred while running the subagent.');
      } finally {
        this.host.state.activeSubagent = undefined;
        this.host.emitState();
      }
      return { paused: false, filesChanged: false };
    }

    const toolDef = tools.find((t) => t.name === tc.name);
    if (!toolDef) {
      tc.status = 'error';
      tc.error = `Unknown tool: ${tc.name}`;
      return { paused: false, filesChanged: false };
    }

    const argError = validateToolArguments(toolDef, tc.args);
    if (argError) {
      tc.status = 'error';
      tc.error = argError;
    }
    try {
      if (argError) throw new Error(argError);
      // Commands can change arbitrary files (installs, migrations, code
      // generators). Record the Git state first so the change is reversible.
      if (workspaceRoot && (tc.name === 'execute_command' || tc.name === 'run_tests')) {
        try {
          const checkpoint = await this.host.gitManager.createCommandCheckpoint(workspaceRoot);
          if (checkpoint) this.host.commandCheckpoints.set(tc.id, checkpoint);
        } catch {
          // Not a Git repository, or the tree is dirty: no command undo.
        }
      }

      const toolResult = await toolDef.execute(tc.args, {
        workspaceRoot,
        terminal:
          this.host.settings.useIntegratedTerminal !== false && !this.host.getSandboxConfig(workspaceRoot)
            ? (command, root, signal) => this.host.runInIntegratedTerminal(command, root, signal)
            : undefined,
        lspClient: this.host.lspClient,
        snapshotManager: this.host.snapshotManager,
        verificationManager: this.host.verificationManager,
        gitManager: this.host.gitManager,
        projectMemory: this.host.projectMemory,
        knowledgeStore: this.host.knowledgeStore,
        vectorMemory: this.host.vectorMemory,
        embeddingIndex: this.host.embeddingIndex,
        specStore: this.host.specStore,
        callGraph: this.host.callGraphManager,
        workflow: this.host.workflow.getWorkflow(),
        sandbox: this.host.getSandboxConfig(workspaceRoot),
        signal: this.host.activeAbortController?.signal
      });
      tc.status = 'completed';
      tc.result = this.host.contextManager.truncateToolOutput(toolResult, tc.name);

      if (tc.name === 'write_spec') {
        // The spec is now drafted: stop and ask the user to approve it
        // before planning or writing any code.
        const drafted = this.host.specStore.list()[0];
        if (drafted && (await this.host.workflow.pauseForSpecApproval(drafted, modelToolCalls, tc.id))) {
          return { paused: true, filesChanged: false };
        }
      }
      if (tc.name === 'update_acceptance_criteria') {
        // Push the new criteria into TaskState immediately; otherwise the
        // counter stays stale until the next unrelated update.
        this.host.workflow.syncProgressToState();
      }
      if (tc.name === 'read_file') {
        // Lazy knowledge curation: summarize the file once so future turns
        // do not need to re-read it to understand it (hash-cached).
        this.host.knowledgeCurator.maybeSummarizeFile(toolArgString(tc.args, 'path'), workspaceRoot);
      }
      if (tc.name === 'write_file' || tc.name === 'edit_file') {
        const targetPath = toolArgString(tc.args, 'path');
        if (targetPath && !this.host.state.stats.filesModified.includes(targetPath)) {
          this.host.state.stats.filesModified.push(targetPath);
        }
        // Çağrı haritası aynı görev içinde bayat kalmasın: yalnızca bu dosya
        // yeniden taranır. Hata olsa bile görev akışı bozulmaz.
        if (targetPath && workspaceRoot) {
          void this.host.callGraphManager.onFileChanged(workspaceRoot, targetPath);
          // Değiştirilen dosyayı doğrudan VS Code editöründe aç ve göster
          void this.host.openFileInEditor(targetPath, workspaceRoot);
        }
        return { paused: false, filesChanged: true };
      }
      if (tc.name === 'execute_command') {
        // Code generation/formatting commands may modify files.
        return { paused: false, filesChanged: true };
      }
    } catch (err) {
      tc.status = 'error';
      tc.error = errorMessage(err, 'An error occurred while running the tool.');
    }
    return { paused: false, filesChanged: false };
  }

  /**
   * Plan adımını gerçek ilerlemeye bağlar.
   *
   * Model `update_plan` ile işaretlemeyi unutabildiği için hazır adım burada
   * "devam ediyor" yapılır; tamamlamaya yine model karar verir.
   */
  public claimNextPlanStep(): void {
    this.host.activePlanStepId = undefined;
    if (this.host.state.mode === 'plan' || !this.host.planner.hasPlan()) return;
    const workflow = this.host.workflow.getWorkflow();
    if (workflow.stage !== 'build' || !workflow.planApproved) return;

    const ready = this.host.planner.getReadySteps();
    const inProgress = this.host.planner.getPlan()?.steps.find((step) => step.status === 'in_progress');
    const step = inProgress ?? ready[0];
    if (!step) return;

    if (step.status === 'pending') this.host.planner.setStepStatus(step.id, 'in_progress');
    this.host.activePlanStepId = step.id;
    this.host.state.plan = this.host.planner.getPlan();
  }

  /** Bekleyen araç onayını kabul eder. */
  public async approveTool(toolCallId: string): Promise<void> {
    if (this.host.state.pendingToolCall && this.host.state.pendingToolCall.id === toolCallId) {
      this.host.state.pendingToolCall.status = 'approved';
      if (this.host.pendingResolver) {
        this.host.pendingResolver(true);
        this.host.pendingResolver = undefined;
      }
    }
  }

  /** Bekleyen araç onayını reddeder. */
  public async rejectTool(toolCallId: string, reason?: string): Promise<void> {
    if (this.host.state.pendingToolCall && this.host.state.pendingToolCall.id === toolCallId) {
      this.host.state.pendingToolCall.status = 'rejected';
      if (this.host.pendingResolver) {
        this.host.pendingResolver(false, reason);
        this.host.pendingResolver = undefined;
      }
    }
  }
}
