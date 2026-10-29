/**
 * Ajan döngüsü.
 *
 * Bir turun kalbi: model çağrısı, araç hazırlama/yürütme, hızlı doğrulama,
 * görev sonu doğrulaması ve onarım döngüsü.
 */
import * as vscode from 'vscode';
import { ChatMessage, ToolCall } from '../../shared/types';
import { createModelProvider } from '../../providers';
import { ALL_TOOLS } from '../../tools';
import { ToolDefinition } from '../../tools/base';
import { generateSystemPrompt } from '../prompts/systemPrompt';
import { getActiveWorkspaceRoot } from '../workspace/workspaceRoot';
import { filterToolsForMode } from './modeTools';
import { skipsApprovalGates } from './autonomy';
import { buildProviderMessages, mapModelToolCalls } from './turnAssembly';
import { detectLintCommand, detectTestCommand } from '../../tools';
import { errorMessage } from '../../shared/errors';
import { logWarning } from '../../shared/logging';
import { describeWorkflow, formatWorkflowForPrompt } from '../workflow/TaskWorkflow';
import type { AgentHost } from './agentHost';

export class AgentLoop {
  constructor(private host: AgentHost) {}

  public async run(turnId: string, userPrompt: string) {
    const generation = this.host.runGeneration;
    const workspaceRoot = getActiveWorkspaceRoot();
    // A new turn invalidates the previous "cannot advance" notice.
    this.host.workflow.getWorkflow().blockedReason = undefined;
    this.host.changedFilesInLastTurn = false;

    if (workspaceRoot) {
      await this.host.ensureSessionPersistence(workspaceRoot);
    }
    this.host.verificationManager.setSandbox(this.host.getSandboxConfig(workspaceRoot));

    // Load workspace customizations and permissions
    try {
      await this.host.skillManager.loadWorkspaceCustomizations(workspaceRoot);
      await this.host.workspaceRules.load(workspaceRoot);
      await this.host.permissionManager.loadProjectPermissions(workspaceRoot, vscode.workspace.isTrusted);
      await this.host.hookManager.loadWorkspaceHooks(workspaceRoot);
    } catch (err) {
      // Customizations are best-effort: a missing AGENTS.md or an unreadable
      // skills directory must not block the task. Invalid permission files
      // are handled separately (they force approval prompts).
      logWarning('Could not load workspace customizations', err);
    }

    // Load the project knowledge base and specs, then refresh only changed files.
    if (workspaceRoot) {
      try {
        await this.host.specStore.load(workspaceRoot);
        const loaded = await this.host.knowledgeStore.load(workspaceRoot);
        if (loaded) {
          await this.host.knowledgeStore.refresh(workspaceRoot, {
            signal: this.host.activeAbortController?.signal
          });
        }
        const workflow = this.host.workflow.getWorkflow();
        workflow.knowledgeReady = true;
        // Do NOT auto-attach a previously approved spec here. A new task must
        // draft and get approval for its own spec; inheriting an old task's
        // approved spec silently skipped the spec gate (task A's acceptance
        // criteria leaked into task B). Restored sessions keep their specId in
        // the persisted workflow state, which is the only legitimate link.
        // Background job: replace regex symbol ranges with precise LSP ones.
        this.host.knowledgeCurator.enrichWithLsp(workspaceRoot);
        // Çağrı haritası yoksa arka planda üretilir; tur beklemez.
        void this.host.callGraphManager.ensureReady(workspaceRoot);
        this.host.workflow.syncProgressToState();
      } catch (err) {
        // Knowledge/spec loading must not block the task, but it should be
        // visible in the log when the index could not be refreshed.
        logWarning('Could not load the project knowledge base', err);
      }
    }

    // "Anlama" is done once project knowledge is loaded; the request is now
    // being handled. Without this, the strip stayed stuck on the first stage.
    const workflowAfterOnboarding = this.host.workflow.getWorkflow();
    if (workflowAfterOnboarding.stage === 'onboard') {
      workflowAfterOnboarding.stage = 'intake';
      workflowAfterOnboarding.updatedAt = Date.now();
      this.host.workflow.syncProgressToState();
    }

    // Select a model suitable for the task (only if the user enabled routing).
    const routing = this.host.modelRouter.route(userPrompt, this.host.state.mode, this.host.settings);
    let turnProvider = this.host.provider;
    let resolvedModel = routing.model;
    if (routing.routed) {
      try {
        turnProvider = createModelProvider({ ...this.host.settings, selectedModel: routing.model });
      } catch (err) {
        // Fall back to the default provider instead of failing the turn.
        logWarning(`Could not create the routed model provider (${routing.model})`, err);
        turnProvider = this.host.provider;
        resolvedModel = this.host.settings.selectedModel;
      }
    }
    this.host.state.stats.lastModel = resolvedModel;
    this.host.state.stats.modelRoutingReason = routing.reason;
    if (routing.routed) {
      this.host.notify({
        level: 'info',
        message: `Görev için seçilen model: ${resolvedModel} — ${routing.reason}`
      });
    }

    // Optionally record the test state (baseline) before changes.
    if (
      this.host.settings.autoVerify &&
      this.host.settings.captureBaseline &&
      !this.host.baselineCaptured &&
      workspaceRoot
    ) {
      this.host.notify({ level: 'info', message: 'Mevcut test durumu kaydediliyor (başlangıç noktası)...' });
      this.host.state.stats.verification = {
        status: 'running',
        attempts: 0,
        summary: 'Başlangıç test durumu kaydediliyor...'
      };
      await this.host.saveCurrentState();
      this.host.emitState();

      const baselineController = new AbortController();
      this.host.activeAbortController = baselineController;
      try {
        const baseline = await this.host.verificationManager.verify(workspaceRoot, {
          timeoutMs: 180_000,
          signal: baselineController.signal
        });
        if (this.host.isCancelled || generation !== this.host.runGeneration) return;
        if (baseline.status !== 'skipped') {
          this.host.baselineCaptured = true;
          this.host.verificationManager.setBaseline(baseline);
          this.host.notify({
            level: 'info',
            message: `Başlangıç test durumu kaydedildi: ${baseline.status === 'passed' ? 'başarılı' : 'önceden var olan hatalar bulundu'}.`
          });
        } else {
          this.host.state.stats.verification = {
            status: 'skipped',
            attempts: 0,
            summary: baseline.summary
          };
          await this.host.saveCurrentState();
          this.host.emitState();
        }
      } finally {
        if (this.host.activeAbortController === baselineController) {
          this.host.activeAbortController = undefined;
        }
      }
    }

    const customizationContext = `${this.host.skillManager.getPromptContext()}${this.host.workspaceRules.formatForPrompt()}`;
    const projectMemoryContext = await this.host.projectMemory.formatForPrompt(workspaceRoot);
    const lastUser = [...this.host.state.messages].reverse().find((m) => m.role === 'user');
    const userPromptText = lastUser?.content || this.host.state.prompt;
    const vectorMemoryContext = workspaceRoot
      ? await this.host.vectorMemory.formatForPrompt(workspaceRoot, userPromptText, 4)
      : '';
    const knowledgeContext = this.host.knowledgeStore.formatForPrompt();
    const workflow = this.host.workflow.getWorkflow();
    const workflowContext =
      formatWorkflowForPrompt(workflow, this.host.state.mode) +
      this.host.specStore.formatForPrompt(workflow.specId);
    // First task on an un-documented project: ask the model to draft
    // project.md alongside the user's task (approved via the tool gate).
    const onboardingNudge = this.host.knowledgeCurator.needsOnboardingDraft()
      ? this.host.knowledgeCurator.onboardingNudge()
      : '';
    const systemPrompt =
      (await generateSystemPrompt(
        workspaceRoot,
        this.host.state.mode,
        customizationContext,
        projectMemoryContext,
        this.host.planner.formatForPrompt(),
        this.host.settings.autonomy
      )) +
      `${vectorMemoryContext ? `\n\n${vectorMemoryContext}` : ''}${onboardingNudge}\n${workflowContext}${knowledgeContext}`;

    let mcpTools: ToolDefinition[] = [];
    try {
      mcpTools = await this.host.mcpHub.ensureInitialized(workspaceRoot);
    } catch (err) {
      // MCP servers are optional; per-server failures are logged by the hub.
      logWarning('Could not initialize MCP servers', err);
    }

    // Tool collection
    const allAvailableTools: ToolDefinition[] = [...Object.values(ALL_TOOLS), ...mcpTools];

    // TRUE PLANNING MODE: File writing, editing, and command execution tools are technically locked in plan mode.
    // The workflow also locks mutating tools until the spec and the plan are approved.
    //
    // Araç listesi her adımda YENİDEN hesaplanır. Turun başında bir kez
    // hesaplandığında, tur içinde onaylanan spec/plan (otonom mod) aşamayı
    // `build`'e taşısa bile liste salt-okunur kalıyor ve modelin ilk yazma
    // denemesi yanıltıcı bir "not allowed at this stage" hatası alıyordu.
    const toolsForCurrentStage = (): ToolDefinition[] => {
      const snapshot = describeWorkflow(this.host.workflow.getWorkflow(), this.host.state.mode);
      return filterToolsForMode(allAvailableTools, this.host.state.mode, {
        workflowReadOnly: snapshot.readOnly,
        allowCommands: snapshot.allowsCommands
      });
    };
    let tools: ToolDefinition[];

    const stepsPerSegment =
      this.host.settings.maxStepsPerTask && this.host.settings.maxStepsPerTask > 0
        ? this.host.settings.maxStepsPerTask
        : 25;
    // A large task legitimately needs more steps than one segment. Instead of
    // stopping and waiting for the user, continue automatically up to a bounded
    // number of segments so the task still terminates.
    const maxSegments = 8;
    let segments = 0;
    let maxSteps = stepsPerSegment;
    let changedDuringTurn = false;

    while (!this.host.isCancelled && this.host.state.status === 'running') {
      if (maxSteps <= 0) {
        if (segments + 1 >= maxSegments) break;
        segments++;
        maxSteps = stepsPerSegment;
        this.host.notify({
          level: 'info',
          message: `Adım sınırına ulaşıldı; görev otomatik devam ediyor (${segments + 1}/${maxSegments}).`
        });
        await this.host.saveCurrentState();
        this.host.emitState();
      }

      maxSteps--;
      this.host.state.stats.stepsCount++;

      // Aşama tur içinde ilerlediyse (spec/plan onayı) kilidi güncelle.
      tools = toolsForCurrentStage();

      // Assemble full message history for LLM (pure helper, unit-tested).
      const providerMessages = buildProviderMessages(systemPrompt, this.host.state.messages);

      // Streaming assistant message holder
      const assistantMsgId = this.host.nextMessageId();
      const streamingAssistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true
      };
      this.host.state.messages.push(streamingAssistantMsg);
      this.host.emitState();

      // Prune & compact the context to stay within the model's context window.
      // This is a technical guard against API overflow, not a spending limit:
      // it never pauses a task, it only shortens what is resent.
      // Compact spent tool outputs first: older steps only need a marker, and
      // the whole history is resent on every iteration.
      const compacted = this.host.contextManager.compactHistory(providerMessages);
      const prunedMessages = this.host.contextManager.pruneMessages(compacted);
      this.host.activeAbortController = new AbortController();

      let response;
      try {
        response = await turnProvider.sendMessage(
          prunedMessages,
          tools,
          (chunk) => {
            streamingAssistantMsg.content += chunk;
            if (this.host.onStreamChunk) {
              this.host.onStreamChunk(assistantMsgId, chunk);
            } else {
              this.host.emitState();
            }
          },
          this.host.activeAbortController.signal
        );
      } catch (err) {
        const message = errorMessage(err, 'Model request failed.');
        // Clear the streaming indicator if the request was cancelled.
        if (
          this.host.isCancelled ||
          (err instanceof Error && err.name === 'AbortError') ||
          /cancelled|stopped/i.test(message)
        ) {
          // The old loop must not overwrite a new session's state.
          if (generation !== this.host.runGeneration) return;
          streamingAssistantMsg.isStreaming = false;
          this.host.state.status = 'cancelled';
          await this.host.saveCurrentState();
          this.host.emitState();
          return;
        }
        // The old loop must not overwrite a new session's state.
        if (generation !== this.host.runGeneration) {
          return;
        }
        this.host.state.status = 'failed';
        streamingAssistantMsg.isStreaming = false;
        streamingAssistantMsg.error = message;
        await this.host.recordProjectMemory(
          `${this.host.state.id}:${turnId}`,
          userPrompt,
          'failed',
          message,
          workspaceRoot
        );
        this.host.notify({ level: 'error', message });
        await this.host.saveCurrentState();
        this.host.emitState();
        return;
      }

      // The session may have changed before the model responded.
      if (generation !== this.host.runGeneration) {
        return;
      }

      if (this.host.isCancelled) {
        streamingAssistantMsg.isStreaming = false;
        this.host.state.status = 'cancelled';
        await this.host.saveCurrentState();
        this.host.emitState();
        return;
      }

      streamingAssistantMsg.isStreaming = false;
      streamingAssistantMsg.content = response.text;

      if (response.usage) {
        // Only usage is reported; there is no token or cost cap.
        this.host.state.stats.totalTokens += response.usage.totalTokens;
      }
      this.host.state.stats.lastModel = resolvedModel;
      this.host.state.stats.modelRoutingReason = routing.reason;

      const modelToolCalls: ToolCall[] = mapModelToolCalls(
        response.toolCalls || [],
        this.host.permissionManager
      );

      // `run_tests`/`run_linter` may omit the command and let the tool detect it.
      // Resolve it now so the approval card, the risk assessment and the audit
      // log all describe the command that will actually run.
      if (workspaceRoot) {
        for (const tc of modelToolCalls) {
          if ((tc.name !== 'run_tests' && tc.name !== 'run_linter') || tc.args.command) continue;
          try {
            tc.args.command =
              tc.name === 'run_tests'
                ? await detectTestCommand(workspaceRoot)
                : await detectLintCommand(workspaceRoot);
            tc.explanation = this.host.permissionManager.getToolExplanation(tc.name, tc.args);
            tc.requiresApproval = this.host.permissionManager.requiresApproval(tc.name, tc.args);
            tc.approvalReason = this.host.permissionManager.explainApproval(tc.name, tc.args);
          } catch {
            // Leave the command unset; the tool reports the actionable error.
          }
        }
      }

      streamingAssistantMsg.toolCalls = modelToolCalls.length > 0 ? modelToolCalls : undefined;
      await this.host.saveCurrentState();
      this.host.emitState();

      // If no tool calls, model finished its answer in this turn
      if (modelToolCalls.length === 0) {
        if (changedDuringTurn && this.host.settings.autoVerify !== false && workspaceRoot) {
          const outcome = await this.host.verificationController.runEndOfTaskVerification(
            workspaceRoot,
            generation
          );
          if (outcome === 'retry') continue;
          if (outcome === 'abort') return;
        }

        this.host.state.status = 'completed';
        await this.host.recordProjectMemory(
          `${this.host.state.id}:${turnId}`,
          userPrompt,
          'completed',
          response.text,
          workspaceRoot
        );
        // One extra round for code-changing tasks: feed the durable decisions
        // back into the knowledge base (user-approved via the tool gate).
        // Otonom modda bu tur, bilgi yazımı "always" onay istediği için ajanı
        // kilitlerdi; bu yüzden atlanır ve nedeni bildirilir.
        if (
          changedDuringTurn &&
          !this.host.memoryRecordedForTask &&
          !skipsApprovalGates(this.host.settings)
        ) {
          this.host.memoryRecordedForTask = true;
          this.host.state.status = 'running';
          this.host.state.messages.push({
            id: this.host.nextMessageId(),
            role: 'system',
            content: this.host.knowledgeCurator.taskEndInstruction(),
            timestamp: Date.now()
          });
          await this.host.saveCurrentState();
          this.host.emitState();
          continue;
        }
        await this.host.hookManager.runStop(workspaceRoot);
        await this.host.saveCurrentState();
        this.host.emitState();
        return;
      }

      // Execute tool calls sequentially
      let filesChangedInBatch = false;
      const allowedToolNames = new Set(tools.map((tool) => tool.name));
      for (const tc of modelToolCalls) {
        if (this.host.isCancelled || generation !== this.host.runGeneration) return;

        // Steps 1-7: stage lock, permissions, dirty-editor guard, diff
        // preview, follow-up questions, hooks, user approval, and the
        // pre-write snapshot (see prepareToolCall).
        const preparation = await this.host.toolPipeline.prepareToolCall(tc, {
          allowedToolNames,
          tools,
          workspaceRoot,
          generation
        });
        if (preparation === 'abort-turn') return;
        if (preparation === 'skip') continue;

        // 8. Execute tool (special tools and the generic path).
        const execution = await this.host.toolPipeline.executeToolCall(tc, {
          modelToolCalls,
          tools,
          workspaceRoot
        });
        if (execution.paused) return;
        if (execution.filesChanged) {
          filesChangedInBatch = true;
          changedDuringTurn = true;
          this.host.changedFilesInLastTurn = true;
        }

        // Do not write the old turn's results to the new session if the session changed.
        if (generation !== this.host.runGeneration) {
          return;
        }

        await this.host.auditTool(tc, workspaceRoot, tc.status);

        // 9. PostToolUse Hook
        await this.host.hookManager.runPostToolUse(tc.name, tc.args, tc.result, tc.error, workspaceRoot);

        await this.host.saveCurrentState();
        this.host.emitState();
      }

      // --- Automatic verification and bounded self-repair loop ---
      if (
        filesChangedInBatch &&
        this.host.settings.autoVerify !== false &&
        workspaceRoot &&
        generation === this.host.runGeneration &&
        !this.host.isCancelled
      ) {
        const outcome = await this.host.verificationController.runQuickVerification(
          workspaceRoot,
          generation
        );
        if (outcome === 'retry') continue;
        if (outcome === 'abort') return;
      }
    }

    if (maxSteps <= 0 && this.host.state.status === 'running') {
      this.host.state.status = 'paused';
      const lastAssistant = [...this.host.state.messages]
        .reverse()
        .find((m) => m.role === 'assistant' && Boolean(m.content));
      await this.host.recordProjectMemory(
        `${this.host.state.id}:${turnId}`,
        userPrompt,
        'paused',
        lastAssistant?.content,
        workspaceRoot
      );
      this.host.notify({
        level: 'warning',
        message: `Görev ${segments + 1} bölümde tamamlanamadı (adım sınırı). Devam etmek için "devam" yazın veya adım bütçesini artırın.`
      });
      await this.host.saveCurrentState();
      this.host.emitState();
    }
  }
}
