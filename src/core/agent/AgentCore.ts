import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AgentMode, ChatMessage, TaskState, ToolCall, UserSettings } from '../../shared/types';
import { DEFAULT_PROVIDER_URLS, isChatConfigured } from '../../shared/constants';
import { createModelProvider } from '../../providers';
import { ModelProvider } from '../../providers/base';
import { PermissionManager } from '../permission/PermissionManager';
import { requestFingerprintApproval } from '../permission/fingerprintApproval';
import { HistoryManager } from '../memory/HistoryManager';
import { McpHub } from '../mcp/McpHub';
import { SubagentManager } from '../multiagent/SubagentManager';
import { SkillManager } from '../skills/SkillManager';
import { LspClient } from '../lsp/LspClient';
import { SnapshotManager } from '../snapshot/SnapshotManager';
import { HookManager } from '../hooks/HookManager';
import { CheckpointManager } from '../checkpoint/CheckpointManager';
import { ContextManager } from '../context/ContextManager';
import { ProjectMemoryManager, ProjectMemoryStatus } from '../memory/ProjectMemoryManager';
import { VectorMemory } from '../memory/VectorMemory';
import { resolveWorkspacePath } from '../../tools/pathSafety';
import { getLanguageIdForFile } from '../../shared/languageMap';
import { AhiCodeDiffContentProvider } from '../../shared/diffContentProvider';
import { getActiveWorkspaceRoot } from '../workspace/workspaceRoot';
import { collectMentionSnippets } from './fileMentions';
import { runInIntegratedTerminal } from './terminalExecution';
import { SessionPersistence } from './sessionPersistence';
import { CallGraphManager } from '../callgraph/CallGraphManager';
import type { WorkflowStage } from '../workflow/TaskWorkflow';
import { WorkflowController } from './workflowController';
import { SessionController } from './sessionController';
import { ToolPipelineController } from './toolPipelineController';
import { VerificationController } from './verificationController';
import { AgentLoop } from './agentLoop';
import type { AgentHost, SessionPort, ToolPipelinePort, VerificationPort } from './agentHost';
import { createLspLanguageService } from '../callgraph/languageService';
import { KnowledgeCurator } from './KnowledgeCurator';
import { SubagentTaskParams } from '../multiagent/SubagentManager';
import { TaskPlanner } from '../plan/TaskPlanner';
import { ModulePlanner } from '../plan/ModulePlanner';
import { errorMessage } from '../../shared/errors';
import { redactForAudit } from '../../shared/redaction';
import { CommandCheckpoint, GitManager } from '../git/GitManager';
import { WorkspaceRuleManager } from '../rules/WorkspaceRuleManager';
import { logWarning } from '../../shared/logging';
import { VerificationManager } from '../verification/VerificationManager';
import { SandboxConfig } from '../verification/CommandRunner';
import { ModelRouter } from '../routing/ModelRouter';
import { WorktreeManager } from '../worktree/WorktreeManager';
import { AuditLog } from '../audit/AuditLog';
import { KnowledgeStore } from '../knowledge/KnowledgeStore';
import { EmbeddingIndex } from '../knowledge/EmbeddingIndex';
import { SpecStore } from '../spec/SpecStore';
import { createWorkflowState, normalizeStageForMode } from '../workflow/TaskWorkflow';
import { autonomyLevel, decideContinuation } from './autonomy';
import { ROLE_ALIASES, getAgentDefinition } from '../../shared/agents';

/** Programatik (kullanıcı kaynaklı olmayan) turlar için ek kontrol bayrakları. */
export interface SendMessageOptions {
  /**
   * İç devam turu (örneğin spec/plan onayından sonra). Kullanıcı balonu veya
   * editör içeriği eklenmez; talimat sistem mesajı olarak kaydedilir ki
   * model karar hafızasını korusun.
   */
  internal?: boolean;
}

const DEFAULT_SANDBOX_IMAGE = 'node:20-bookworm';

/** Testlerin sahte nesnelerle değiştirdiği isteğe bağlı iş birlikçiler. */
export interface AgentCoreDependencies {
  /** Ayarlardan kurulan sağlayıcıyı geçersiz kılar (testler betikleşmiş model kullanır). */
  provider?: ModelProvider;
}

export class AgentCore implements AgentHost {
  public state: TaskState;
  public provider: ModelProvider;
  public permissionManager: PermissionManager;
  public historyManager: HistoryManager;
  public mcpHub: McpHub;
  public subagentManager: SubagentManager;
  public skillManager: SkillManager;
  public lspClient: LspClient;
  public hookManager: HookManager;
  public contextManager: ContextManager;
  public projectMemory = new ProjectMemoryManager();
  public planner = new TaskPlanner();
  public modulePlanner = new ModulePlanner();
  public verificationManager = new VerificationManager();
  public modelRouter = new ModelRouter();
  public worktreeManager = new WorktreeManager();
  public gitManager = new GitManager();
  public workspaceRules = new WorkspaceRuleManager();
  public knowledgeStore = new KnowledgeStore();
  public specStore = new SpecStore();
  public settings: UserSettings;
  public repairAttempts = 0;
  public baselineCaptured = false;
  /** Oturum/kök başına geri alma kayıtları. */
  public persistence = new SessionPersistence();
  /** Salt-okunur çağrı haritası (fonksiyon çağrı ilişkileri). */
  public callGraphManager: CallGraphManager;
  /** Yönlendirilmiş iş akışı denetleyicisi. */
  public workflow!: WorkflowController;
  public sessionController!: SessionController;
  public toolPipeline!: ToolPipelineController;
  public verificationController!: VerificationController;
  public loop!: AgentLoop;
  public session!: SessionPort;
  public tools!: ToolPipelinePort;
  public verification!: VerificationPort;
  /** Her komuttan önce alınan checkpoint; yan etkiler geri alınabilsin diye. */
  public commandCheckpoints = new Map<string, CommandCheckpoint>();
  public lastVerificationSkip = '';
  /** Son turda dosyaların değişip değişmediği (yalnızca yazma değil, her araç). */
  public changedFilesInLastTurn = false;
  /** Güncel build turunun üstlendiği plan adımı; dürüst ilerleme göstergesi için. */
  public activePlanStepId: string | undefined;
  /** Otonom modda yapılan otomatik devam sayısı (döngü koruması). */
  public autoContinuations = 0;

  public isCancelled: boolean = false;
  public runGeneration = 0;
  public messageSeq = 0;
  public activeAbortController?: AbortController;
  public currentTurnId?: string;
  public pendingResolver?: (approved: boolean, reason?: string) => void;
  public pendingQuestionResolver?: (answer: string) => void;
  private messageLock = false;
  /** Bilgi tabanı üzerinde yerel anlamsal arama (isteğe bağlı). */
  public embeddingIndex?: EmbeddingIndex;
  /** Vektör bellek (geçmiş görevler + proje bilgi tabanı). */
  public vectorMemory: VectorMemory;
  /** Tembel özetleme, LSP zenginleştirme ve bilgi tabanı prompt dürtmeleri. */
  public knowledgeCurator: KnowledgeCurator;
  /** Görev sonu bilgi kaydı talimatının görev başına yalnızca bir kez çalışmasını sağlar. */
  public memoryRecordedForTask = false;

  private hasCustomProvider = false;

  constructor(
    public context: vscode.ExtensionContext,
    settings: UserSettings,
    public onStateUpdate: (state: TaskState) => void,
    public notify: (notification: { level: 'info' | 'warning' | 'error'; message: string }) => void,
    public onStreamChunk?: (messageId: string, chunk: string) => void,
    dependencies: AgentCoreDependencies = {}
  ) {
    this.settings = settings;
    this.hasCustomProvider = Boolean(dependencies.provider);
    this.provider = dependencies.provider ?? createModelProvider(settings);
    this.permissionManager = new PermissionManager(settings);
    this.refreshEmbeddingIndex();
    this.historyManager = new HistoryManager(context);
    this.mcpHub = new McpHub(context.workspaceState);
    this.skillManager = new SkillManager();
    this.lspClient = new LspClient();
    this.hookManager = new HookManager(
      () => vscode.workspace.isTrusted,
      (fingerprint, commands) => this.confirmWorkspaceHooks(fingerprint, commands)
    );
    this.contextManager = new ContextManager();
    this.callGraphManager = new CallGraphManager({
      enabled: () => this.settings.callGraph?.enabled !== false,
      language: (workspaceRoot) => createLspLanguageService(this.lspClient, workspaceRoot)
    });
    this.knowledgeCurator = new KnowledgeCurator(this.knowledgeStore, this.provider, this.lspClient);
    this.vectorMemory = new VectorMemory(this.projectMemory, this.knowledgeStore, () => this.embeddingIndex);
    this.verificationManager.setCommandFilter((command) => this.canAutoRunVerificationCommand(command));

    this.subagentManager = this.createSubagentManager();
    this.workflow = new WorkflowController(this);
    this.sessionController = new SessionController(this);
    this.toolPipeline = new ToolPipelineController(this);
    this.verificationController = new VerificationController(this);
    this.loop = new AgentLoop(this);
    this.session = this.sessionController;
    this.tools = this.toolPipeline;
    this.verification = this.verificationController;

    // Varsa son etkin oturumu geri yükle
    const lastSessionId = context.workspaceState.get<string>('ahi_active_session_id');
    const saved = lastSessionId ? this.historyManager.getTask(lastSessionId) : undefined;
    this.state = saved ? this.normalizeRestoredState(saved) : this.getInitialState();
    this.planner.hydrate(this.state.plan);
    this.modulePlanner.hydrate(this.state.modules);
  }

  private createSubagentManager(): SubagentManager {
    return new SubagentManager(
      this.provider,
      (role, status, details) => {
        this.notify({ level: 'info', message: `[Alt Ajan: ${role.toUpperCase()}] ${status}` });
        const resolvedRole = (ROLE_ALIASES[role.toLowerCase()] || role).toLowerCase();
        const def = getAgentDefinition(resolvedRole);
        const displayName = def?.displayName || role;

        if (details?.state === 'completed' || details?.state === 'failed' || details?.state === 'cancelled') {
          this.state.activeSubagent = undefined;
        } else {
          const current = this.state.activeSubagent;
          this.state.activeSubagent = {
            role,
            displayName,
            task: current?.task || '',
            status: details?.state || 'running',
            currentTool: details?.tool,
            step: details?.step,
            maxSteps: details?.maxSteps,
            worktreePath: details?.worktreePath ?? current?.worktreePath,
            isolate: details?.isolate ?? current?.isolate,
            startedAt: current?.startedAt || Date.now(),
            updatedAt: Date.now()
          };
        }
        this.emitState();
      },
      this.skillManager,
      this.lspClient,
      this.snapshotManager,
      this.permissionManager,
      this.checkpointManager,
      (tc, decision, root) => {
        void this.auditTool(tc, root, decision);
      },
      this.worktreeManager,
      () => this.getSandboxConfig(getActiveWorkspaceRoot()),
      () =>
        this.settings.useIntegratedTerminal !== false && !this.getSandboxConfig(getActiveWorkspaceRoot())
          ? (command, root, signal) => this.runInIntegratedTerminal(command, root, signal)
          : undefined,
      this.callGraphManager,
      this.gitManager
    );
  }

  /**
   * Etkin snapshot/checkpoint yöneticileri değişince bağımlı yardımcı
   * yöneticileri yeniden kurar.
   */
  public rebuildPersistenceDependents(): void {
    this.subagentManager = this.createSubagentManager();
  }

  /**
   * Eklenti yeniden yüklendiğinde yarıda kalan "running/waiting" durumlarını
   * güvenli "paused" durumuna döndürür ve görevin kaldığı yerden sürdürülebilmesini sağlar.
   */
  public normalizeRestoredState(saved: TaskState): TaskState {
    const transientStatuses = ['running', 'waiting_approval', 'waiting_user_input', 'paused'];
    return {
      ...this.getInitialState(saved.mode || 'code'),
      ...saved,
      status: transientStatuses.includes(saved.status) ? 'paused' : saved.status,
      pendingToolCall: undefined,
      pendingQuestion: undefined,
      checkpoints: undefined,
      stats: {
        totalTokens: saved.stats?.totalTokens ?? 0,
        stepsCount: saved.stats?.stepsCount ?? 0,
        filesModified: Array.isArray(saved.stats?.filesModified) ? saved.stats.filesModified : [],
        lastModel: saved.stats?.lastModel,
        modelRoutingReason: saved.stats?.modelRoutingReason,
        verification: saved.stats?.verification
      },
      messages: Array.isArray(saved.messages)
        ? saved.messages
            .filter((m) => m.role !== 'assistant' || Boolean(m.content) || Boolean(m.toolCalls?.length))
            .map((m) => ({
              ...m,
              isStreaming: false,
              toolCalls: m.toolCalls?.map((tc) =>
                tc.status === 'pending' || tc.status === 'approved' || tc.status === 'executing'
                  ? {
                      ...tc,
                      status: 'error' as const,
                      error: tc.error || 'The operation was interrupted while the extension was reloading.'
                    }
                  : tc
              )
            }))
        : []
    };
  }

  public updateSettings(newSettings: UserSettings) {
    this.settings = newSettings;
    this.provider = createModelProvider(newSettings);
    this.permissionManager.updateSettings(newSettings);
    this.refreshEmbeddingIndex();
    // Küratör sağlayıcı referansını tutar; yenisiyle yeniden kurulur.
    this.knowledgeCurator = new KnowledgeCurator(this.knowledgeStore, this.provider, this.lspClient);
    this.rebuildPersistenceDependents();
  }

  /**
   * Ayarlara göre yerel anlamsal arama indeksini kurar ya da düşürür.
   * Embedding'ler kullanıcının Ollama sunucusunda çalışır; devre dışıyken
   * hiç ağ erişimi olmaz.
   */
  private refreshEmbeddingIndex(): void {
    const config = this.settings.knowledgeEmbeddings;
    if (config?.enabled) {
      this.embeddingIndex = new EmbeddingIndex({
        baseUrl: this.settings.ollamaBaseUrl || DEFAULT_PROVIDER_URLS.ollama,
        model: config.model || 'nomic-embed-text'
      });
    } else {
      this.embeddingIndex = undefined;
    }
  }

  /**
   * Eklenti kapanırken alt süreçleri ve bekleyen işlemleri temizler.
   */
  public dispose(): void {
    this.isCancelled = true;
    this.runGeneration++;
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = undefined;
    }
    this.pendingResolver?.(false, 'Eklenti kapatıldı.');
    this.pendingResolver = undefined;
    this.pendingQuestionResolver?.('Extension closed.');
    this.pendingQuestionResolver = undefined;
    this.mcpHub.stopAll();
  }

  public setMode(mode: AgentMode) {
    if (this.isBusy()) {
      this.notify({
        level: 'warning',
        message: 'Ajan çalışırken mod değiştirilemez. Önce görevi tamamlayın veya durdurun.'
      });
      this.emitState();
      return;
    }
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    // Salt-kod aşamaları (build/verify) planlama modunda yoktur; aşamayı
    // geçerli tut ki ilerleme şeridi erişilemez bir adım göstermesin.
    const workflow = this.workflow.getWorkflow();
    const normalized = normalizeStageForMode(workflow.stage, mode);
    if (normalized !== workflow.stage) {
      workflow.stage = normalized;
      workflow.updatedAt = Date.now();
      this.workflow.syncProgressToState();
    }
    this.emitState();
    this.notify({
      level: 'info',
      message:
        mode === 'plan'
          ? 'Planlama modu etkin: yalnızca analiz ve plan; dosya değişikliği ve komut çalıştırma devre dışı.'
          : 'Kodlama modu etkin: ajan dosya ve komut araçlarını kullanabilir.'
    });
  }

  /** Yürürlükteki anlık görüntü yöneticisi (oturum/kök değişince yenilenir). */
  public get snapshotManager(): SnapshotManager {
    return this.persistence.snapshotManager;
  }

  /** Yürürlükteki checkpoint yöneticisi (oturum/kök değişince yenilenir). */
  public get checkpointManager(): CheckpointManager {
    return this.persistence.checkpointManager;
  }

  /** Salt-okunur çağrı haritası yöneticisi (arayüz ve testler için). */
  public getCallGraphManager(): CallGraphManager {
    return this.callGraphManager;
  }

  public getHistoryManager(): HistoryManager {
    return this.historyManager;
  }

  public getProjectMemory(): ProjectMemoryManager {
    return this.projectMemory;
  }

  public getMcpHub(): McpHub {
    return this.mcpHub;
  }

  public getSkillManager(): SkillManager {
    return this.skillManager;
  }

  public getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  public getLspClient(): LspClient {
    return this.lspClient;
  }

  public getSnapshotManager(): SnapshotManager {
    return this.snapshotManager;
  }

  public getCheckpointManager(): CheckpointManager {
    return this.checkpointManager;
  }

  public getTaskPlanner(): TaskPlanner {
    return this.planner;
  }

  public getVerificationManager(): VerificationManager {
    return this.verificationManager;
  }

  public getKnowledgeStore(): KnowledgeStore {
    return this.knowledgeStore;
  }

  public getSpecStore(): SpecStore {
    return this.specStore;
  }

  public getGitManager(): GitManager {
    return this.gitManager;
  }

  /**
   * Alt ajanı doğrudan arayüzden (Ajanlar & Yetenekler ekranı) çalıştırır.
   *
   * Görevi açıkça isteyen ve tanımlayan kullanıcıdır; bu isteğin kendisi
   * onaydır — modelin başlattığı aynı işlem normal araç onay akışından geçer.
   * Sonuç sohbete kaydedilir ki oturum geçmişinde görünür kalsın.
   */
  public async runSubagentFromUi(params: SubagentTaskParams): Promise<string> {
    if (this.isBusy()) {
      throw new Error('Ajan şu anda meşgul; alt ajan başlatılmadan önce görevi bekleyin veya durdurun.');
    }
    const workspaceRoot = getActiveWorkspaceRoot();
    const task = params.task?.trim();
    if (!task) {
      throw new Error('Alt ajan görevi boş olamaz.');
    }

    const resolvedRole = (ROLE_ALIASES[params.role.toLowerCase()] || params.role).toLowerCase();
    const def = getAgentDefinition(resolvedRole);

    this.state.messages.push({
      id: this.nextMessageId(),
      role: 'system',
      content: `Alt ajan başlatıldı (${def?.displayName || params.role}). Görev: ${task}`,
      timestamp: Date.now()
    });
    this.state.status = 'running';
    this.state.activeSubagent = {
      role: params.role,
      displayName: def?.displayName || params.role,
      task,
      status: 'starting',
      isolate: params.isolate,
      startedAt: Date.now()
    };
    this.emitState();

    this.isCancelled = false;
    this.activeAbortController = new AbortController();
    try {
      const result = await this.subagentManager.runSubagent(
        { ...params, task },
        workspaceRoot,
        0,
        this.activeAbortController.signal
      );
      this.state.messages.push({
        id: this.nextMessageId(),
        role: 'assistant',
        content: result,
        timestamp: Date.now()
      });
      return result;
    } finally {
      this.state.activeSubagent = undefined;
      this.state.status = 'idle';
      this.workflow.syncProgressToState();
      await this.saveCurrentState();
      this.emitState();
    }
  }

  // --- Eski genel API: denetleyicilere delege ---
  public createNewSession(mode?: AgentMode): Promise<void> {
    return this.sessionController.createNewSession(mode);
  }

  public clearTask(): Promise<void> {
    return this.sessionController.clearTask();
  }

  public loadSession(sessionId: string): Promise<void> {
    return this.sessionController.loadSession(sessionId);
  }

  public cancelTask(): Promise<void> {
    return this.sessionController.cancelTask();
  }

  public rewindToCheckpoint(checkpointId: string): Promise<void> {
    return this.sessionController.rewindToCheckpoint(checkpointId);
  }

  public revertLastSnapshot(): Promise<void> {
    return this.sessionController.revertLastSnapshot();
  }

  public revertToolSnapshot(toolCallId: string): Promise<void> {
    return this.sessionController.revertToolSnapshot(toolCallId);
  }

  public revertCommandEffects(toolCallId: string): Promise<void> {
    return this.sessionController.revertCommandEffects(toolCallId);
  }

  public canRevertCommand(toolCallId: string): boolean {
    return this.sessionController.canRevertCommand(toolCallId);
  }

  public provideUserReply(answer: string): Promise<void> {
    return this.sessionController.provideUserReply(answer);
  }

  public retryLastTurn(): Promise<void> {
    return this.sessionController.retryLastTurn();
  }

  /** Gönderilmiş bir kullanıcı mesajını düzenler ve istemi yeniden çalıştırır. */
  public editMessage(messageId: string, text: string): Promise<void> {
    return this.sessionController.editMessage(messageId, text);
  }

  /**
   * Duraklatılmış veya VS Code yeniden açıldığında geri yüklenmiş görevi kaldığı yerden sürdürür.
   */
  public async resumeTask(): Promise<void> {
    if (this.isBusy()) {
      this.notify({ level: 'warning', message: 'Ajan şu anda meşgul.' });
      return;
    }
    if (this.state.pendingApproval) {
      this.notify({ level: 'info', message: 'Lütfen bekleyen spec veya plan onayını yanıtlayın.' });
      return;
    }

    const currentStep = this.state.plan?.steps?.find(
      (s) => s.status === 'in_progress' || s.status === 'pending'
    );
    const instruction = currentStep
      ? `Görevin "${currentStep.title}" adımı üzerinde çalışmaya devam et. Gerekli araçları çalıştırarak hedefe ilerle.`
      : this.state.plan?.goal
        ? `"${this.state.plan.goal}" hedefine ulaşmak için görev planına göre çalışmaya devam et.`
        : 'Görevin tamamlanması için kaldığın yerden devam et.';

    this.state.status = 'running';
    this.isCancelled = false;
    this.emitState();
    await this.saveCurrentState();

    await this.handleSendMessage(instruction, this.state.mode, { internal: true });
  }

  public approveSpec(): Promise<boolean> {
    return this.workflow.approveSpec();
  }

  public approvePlan(): Promise<boolean> {
    return this.workflow.approvePlan();
  }

  public rejectApproval(reason?: string): Promise<void> {
    return this.workflow.rejectApproval(reason);
  }

  public approveTool(toolCallId: string): Promise<void> {
    return this.toolPipeline.approveTool(toolCallId);
  }

  public rejectTool(toolCallId: string, reason?: string): Promise<void> {
    return this.toolPipeline.rejectTool(toolCallId, reason);
  }

  public setWorkflowStage(stage: WorkflowStage): Promise<{ ok: boolean; reason?: string }> {
    return this.workflow.setWorkflowStage(stage);
  }

  /** İş akışı denetleyicisine delege (host sözleşmesi). */
  public getWorkflow() {
    return this.workflow.getWorkflow();
  }

  public getState(): TaskState {
    return this.state;
  }

  /**
   * Tamamlanan/başarısız görevleri proje belleğine yazar.
   */
  public async recordProjectMemory(
    turnId: string,
    prompt: string,
    status: ProjectMemoryStatus,
    summary: string | undefined,
    workspaceRoot: string | undefined
  ) {
    if (!workspaceRoot || !this.state.id) return;
    await this.projectMemory.append(workspaceRoot, {
      taskId: turnId,
      mode: this.state.mode,
      status,
      prompt,
      files: this.state.stats.filesModified,
      summary
    });
    void this.vectorMemory.sync(workspaceRoot, true);
  }

  /**
   * Oturumun anlık görüntü ve checkpoint kayıtlarını diskten yükler.
   * Oturum/kök çifti başına yalnızca bir kez çalışır.
   */
  public async ensureSessionPersistence(workspaceRoot: string): Promise<void> {
    if (!this.state.id) return;
    const resolvedRoot = path.resolve(workspaceRoot);

    const { managersChanged, rootChanged } = await this.persistence.ensure(
      workspaceRoot,
      this.state.id,
      resolvedRoot
    );

    if (managersChanged) {
      this.rebuildPersistenceDependents();
    }

    await this.verificationManager.attachWorkspace(workspaceRoot);
    if (this.verificationManager.getBaseline()) {
      this.baselineCaptured = true;
    }
    this.state.checkpoints = this.checkpointManager.getSummaries();
    this.planner.hydrate(this.state.plan);
    this.modulePlanner.hydrate(this.state.modules);

    if (rootChanged) {
      this.notify({
        level: 'info',
        message: `Çalışma alanı kökü değişti. Bu kök için geri alma kayıtları yüklendi: ${path.basename(workspaceRoot)}`
      });
    }
  }

  /**
   * Onay için duran turda çalışmayacak araç çağrılarını kapatır.
   *
   * "pending" bırakmak arayüzde sonsuz spinner'a ve sonraki istekte çağrının
   * sessizce düşmesine yol açıyordu.
   */
  public closeRemainingToolCalls(calls: ToolCall[], exceptId: string, reason: string): void {
    for (const call of calls) {
      if (call.id === exceptId) continue;
      if (call.status !== 'pending' && call.status !== 'approved') continue;
      call.status = 'rejected';
      call.error = reason;
    }
  }

  /**
   * Prompt'u @file referansları ve etkin editör/seçim içeriğiyle zenginleştirir
   */
  public async buildEditorContext(userText: string, workspaceRoot?: string): Promise<string> {
    const contextSnippets: string[] = [];

    // 1. @path ile referans verilen dosyalar. Reddetme kuralları ve hassas dosya
    // koruması burada da tıpkı read_file aracında olduğu gibi uygulanır.
    if (workspaceRoot) {
      contextSnippets.push(
        ...(await collectMentionSnippets(userText, {
          workspaceRoot,
          isBlocked: (relPath) => this.permissionManager.isToolBlocked('read_file', { path: relPath }).blocked
        }))
      );
    }

    // 2. Etkin editör dosyası ve seçimi
    const editor = vscode.window.activeTextEditor;
    // Çalışma alanı dışında açılmış bir dosya asla prompt'a sızdırılmamalı:
    // yol tamamen sandbox sınırı dışında olabilir (çalışma alanı kökünün
    // olmaması, danışılacak izin kuralının da olmaması demektir).
    const editorInsideWorkspace = Boolean(
      editor?.document &&
        workspaceRoot &&
        (() => {
          const relative = path.relative(workspaceRoot, editor.document.uri.fsPath);
          return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
        })()
    );

    if (editor && editor.document && editorInsideWorkspace && workspaceRoot) {
      const docPath = editor.document.uri.fsPath;
      const relPath = path.relative(workspaceRoot, docPath);
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      const cursorLine = selection.active.line + 1;

      const selectionBlocked = this.permissionManager.isToolBlocked('read_file', { path: relPath }).blocked;

      if (selectedText.trim() && !selectionBlocked) {
        const maxSelectionChars = 12000;
        const snippetText =
          selectedText.length > maxSelectionChars
            ? `${selectedText.slice(0, maxSelectionChars)}\n... [${selectedText.length - maxSelectionChars} selection characters truncated]`
            : selectedText;
        contextSnippets.push(
          `[Selected Code in Active Editor (${relPath}, Lines ${selection.start.line + 1}-${selection.end.line + 1})]:\n\`\`\`\n${snippetText}\n\`\`\``
        );
      } else {
        contextSnippets.push(`[Active File]: ${relPath} (Cursor line: ${cursorLine})`);
      }
    }

    if (contextSnippets.length === 0) return '';
    return '\n\n' + contextSnippets.join('\n\n');
  }

  /** Önerilen içeriği mevcut dosyayla karşılaştıran sanal diff görünümü açar. */
  public async openDiffPreview(filePath: string, proposedContent: string) {
    const workspaceRoot = getActiveWorkspaceRoot();

    try {
      const fullPath = workspaceRoot ? resolveWorkspacePath(filePath, workspaceRoot) : filePath;
      const language = getLanguageIdForFile(fullPath);
      const diffProvider = AhiCodeDiffContentProvider.getInstance();

      // Yeni bir dosyanın okunacak orijinali yoktur; diskten okumak yerine sanal boş belge kullan.
      // DİKKAT: 'untitled:' kullanılmaz; VS Code untitled belgeleri kirli (dirty) sayarak kaydetme uyarısı verir.
      let originalUri: vscode.Uri;
      let label: string;
      try {
        await fs.access(fullPath);
        originalUri = vscode.Uri.file(fullPath);
        label = `${path.basename(fullPath)} ↔ AhiCode (Önerilen Fark)`;
      } catch {
        const emptyUri = vscode.Uri.from({
          scheme: AhiCodeDiffContentProvider.scheme,
          path: '/' + filePath,
          query: `empty=${Date.now()}`
        });
        diffProvider.setDocumentContent(emptyUri, '');
        originalUri = emptyUri;
        label = `${path.basename(fullPath)} (Yeni Dosya) ↔ AhiCode`;
      }

      // Sağ taraf: sanal önerilen içerik belgesi ('ahicode-diff' şeması).
      // Salt-okunurdur, dirty state almaz ve sekme kapanırken kaydetme uyarısı sormaz.
      const proposedUri = vscode.Uri.from({
        scheme: AhiCodeDiffContentProvider.scheme,
        path: '/' + filePath,
        query: `proposed=${Date.now()}`
      });
      diffProvider.setDocumentContent(proposedUri, proposedContent);

      // Sanal belgenin söz dizimi renklendirmesini (Syntax Highlighting) garantiye al
      try {
        const virtualDoc = await vscode.workspace.openTextDocument(proposedUri);
        if (virtualDoc.languageId !== language) {
          await vscode.languages.setTextDocumentLanguage(virtualDoc, language);
        }
      } catch {
        // Dil atanmasa da diff açılır
      }

      await vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, label);
    } catch (err) {
      logWarning('Could not open the diff view automatically', err);
    }
  }

  /** Değiştirilen veya yazılan dosyayı doğrudan VS Code editöründe açar, kaydeder ve odaklar. */
  public async openFileInEditor(filePath: string, workspaceRoot?: string): Promise<void> {
    try {
      const root = workspaceRoot ?? getActiveWorkspaceRoot();
      const fullPath = root ? resolveWorkspacePath(filePath, root) : filePath;
      const fileUri = vscode.Uri.file(fullPath);
      const doc = await vscode.workspace.openTextDocument(fileUri);
      // Dosyada bellekte bekleyen herhangi bir kaydedilmemiş değişiklik varsa diske anında kaydet
      if (doc.isDirty) {
        await doc.save();
      }
      await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
    } catch (err) {
      logWarning('Could not open file in editor automatically', err);
    }
  }

  /**
   * Çekirdek mesajlaşma yöntemi: mevcut sürekli sohbet oturumuna ekler
   */
  public async handleSendMessage(text: string, mode?: AgentMode, options: SendMessageOptions = {}) {
    // Ajan soru soruyorsa kullanıcı yanıtı döngüyü sürdürür; kilit kontrolünden önce çözülmelidir.
    if (this.state.status === 'waiting_user_input' && this.pendingQuestionResolver) {
      const resolver = this.pendingQuestionResolver;
      this.pendingQuestionResolver = undefined;
      resolver(text);
      return;
    }
    // İki mesajın aynı anda işlenmesini engelle (await'ler arası TOCTOU yarışı).
    if (this.messageLock) {
      this.notify({ level: 'warning', message: 'Önceki mesaj hâlâ işleniyor. Tamamlanmasını bekleyin.' });
      return;
    }
    this.messageLock = true;
    try {
      await this.handleSendMessageInner(text, mode, options);
    } finally {
      this.messageLock = false;
    }
  }

  private async handleSendMessageInner(text: string, mode?: AgentMode, options: SendMessageOptions = {}) {
    // Model ayarı henüz yapılmadıysa veya sağlayıcı gereksinimleri eksikse mesajı reddet.
    if (!options.internal && !this.hasCustomProvider && !isChatConfigured(this.settings)) {
      this.notify({
        level: 'warning',
        message: 'Sohbeti başlatmak için lütfen önce Ayarlar bölümünden bir model sağlayıcısı yapılandırın.'
      });
      return;
    }

    // Ajan soru sorduysa ana girişten gelen metni yanıt olarak ele al.
    if (this.state.status === 'waiting_user_input' && this.pendingQuestionResolver) {
      const resolver = this.pendingQuestionResolver;
      this.pendingQuestionResolver = undefined;
      resolver(text);
      return;
    }

    // Bir spec veya plan onay bekliyor. Burada yeni bir döngü başlatmak kapıyı
    // atlatırdı; kart yanıtlanana kadar mesaj reddedilir.
    if (this.state.pendingApproval && !options.internal) {
      this.notify({
        level: 'warning',
        message: 'Onay bekleyen bir spec veya plan var. Lütfen onay kartını kullanın.'
      });
      this.emitState();
      return;
    }

    // Aynı anda ikinci bir ajan döngüsünün başlatılmasını engelle (yinelenen istek/yazma olmaz).
    if (!options.internal && (this.state.status === 'running' || this.state.status === 'waiting_approval')) {
      this.notify({
        level: 'warning',
        message: 'Ajan şu anda çalışıyor. Yeni görev göndermeden önce işlemin tamamlanmasını bekleyin.'
      });
      return;
    }

    // İptal bayrağını yalnızca kullanıcının yeni gönderimi temizler. İç turlar
    // (otonom devam, onay sonrası sürdürme) bayrağı temizlememeli: zamanlayıcı
    // ile iptal arasında yarış varsa geç bir iç tur, kullanıcının "dur"unu
    // sessizce silebilirdi.
    if (!options.internal) this.isCancelled = false;
    // Kullanıcı yeni bir görev verdiyse otonom devam bütçesi sıfırlanır;
    // iç turlar bütçeyi paylaşır.
    if (!options.internal) this.autoContinuations = 0;
    const generation = this.runGeneration;

    if (mode) {
      this.state.mode = mode;
    }

    const workspaceRoot = getActiveWorkspaceRoot();

    // Etkin oturum yoksa oluştur
    if (!this.state.id || this.state.messages.length === 0) {
      this.state.id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.state.prompt = text;
      this.state.messages = [];
      await this.context.workspaceState.update('ahi_active_session_id', this.state.id);
    }

    if (workspaceRoot) {
      await this.ensureSessionPersistence(workspaceRoot);
    }
    this.repairAttempts = 0;

    // @file bahsini okumadan önce izin kurallarını yükle.
    try {
      await this.permissionManager.loadProjectPermissions(workspaceRoot, vscode.workspace.isTrusted);
    } catch (err) {
      // Varsayılanlarla devam et ama nedenini output kanalında tut:
      // sessizce yok sayılan bir izin dosyası güvenlik açısından kötü bir sürprizdir.
      logWarning('Could not load project permissions; using global defaults', err);
    }

    const editorContext = options.internal ? '' : await this.buildEditorContext(text, workspaceRoot);
    if (generation !== this.runGeneration || this.isCancelled) {
      return;
    }
    const fullUserPrompt = editorContext ? `${text}${editorContext}` : text;

    // İç devam turları (onay sonrası sürdürme) kullanıcı yazısı değildir;
    // sahte bir kullanıcı balonu yerine sistem mesajı olarak kaydedilir.
    const userMsg: ChatMessage = {
      id: this.nextMessageId(),
      role: options.internal ? 'system' : 'user',
      content: fullUserPrompt,
      timestamp: Date.now()
    };
    // Tur kimliği: kullanıcı istemi ve ona ait tüm asistan adımları aynı
    // kimliği taşır, arayüz bunları tek yanıt bloğunda toplar.
    userMsg.turnId = userMsg.id;
    this.currentTurnId = userMsg.id;
    this.state.messages.push(userMsg);
    this.state.status = 'running';
    this.emitState();
    await this.saveCurrentState();
    if (generation !== this.runGeneration || this.isCancelled) {
      return;
    }

    // Tur başında checkpoint al
    this.repairAttempts = 0;
    this.knowledgeCurator.resetTurnBudget();
    this.memoryRecordedForTask = false;
    // Token bütçesi görev kapsamlıdır: yeni kullanıcı istemi sayacı sıfırlar,
    // iç devam turları aynı görevin harcamasını sürdürür.
    if (!options.internal) {
      this.state.stats.totalTokens = 0;
    }
    this.checkpointManager.createCheckpoint(this.state, this.state.stats.stepsCount);
    this.state.checkpoints = this.checkpointManager.getSummaries();

    const filesModifiedBefore = this.state.stats.filesModified.length;
    this.toolPipeline.claimNextPlanStep();

    try {
      await this.loop.run(userMsg.id, text);
      if (generation !== this.runGeneration) {
        return;
      }
      const changedFiles =
        this.state.stats.filesModified.length > filesModifiedBefore || this.changedFilesInLastTurn;

      // Model üzerinde çalıştığı adımı kapatmayı unuttuysa burada kapat ki
      // gerçek iş yapılırken plan "0/N" üzerinde kalmasın. İnceleme/araştırma
      // görevlerinde dosya değişmese bile araçlar çalıştırılıp tur bittiğinde
      // adım tamamlanır.
      const lastMsg = this.state.messages[this.state.messages.length - 1];
      const hasToolActivity = (lastMsg?.toolCalls?.length ?? 0) > 0;
      if (this.activePlanStepId && (changedFiles || this.isTaskCompleted() || hasToolActivity)) {
        const step = this.planner.getPlan()?.steps.find((item) => item.id === this.activePlanStepId);
        if (step && step.status === 'in_progress') {
          this.state.plan = this.planner.setStepStatus(step.id, 'completed');
        }
      }
      this.activePlanStepId = undefined;

      // Yönlendirilmiş iş akışını ilerlet ki ilerleme şeridi plan onaylandıktan
      // sonra "Uygulama" aşamasında takılı kalmasın.
      await this.workflow.advanceWorkflowAfterTurn({ changedFiles });

      // Otonom mod: görev bitene kadar turlar kendiliğinden sürer. Sayaç ve
      // karar saf `autonomy` modülünden gelir; sonsuz döngü olmaz.
      //
      // "Bitti" ölçütü iş akışı aşamasıdır, turun `status` alanı değil: her tur
      // sonunda durum 'completed' olur, bu da otonom devamı her zaman
      // durduruyordu (gerçek hata). Görev ancak `done` kapısı geçilince biter.
      const workflowNow = this.workflow.getWorkflow();
      const decision = decideContinuation({
        level: autonomyLevel(this.settings),
        continuations: this.autoContinuations,
        maxContinuations: this.settings.maxContinuations,
        cancelled: this.isCancelled,
        finished: workflowNow.stage === 'done',
        pendingApproval: Boolean(this.state.pendingApproval)
      });
      if (decision.action === 'continue') {
        this.autoContinuations++;
        await this.saveCurrentState();
        this.emitState();
        // Kilit bırakıldıktan sonra yeni bir tur başlatılır; aksi hâlde
        // messageLock iç içe çağrıyı reddeder. Zamanlayıcı, kullanıcı iptal
        // ettiyse veya oturum değiştiyse görevi diriltmemeli.
        setTimeout(() => {
          if (this.isCancelled || generation !== this.runGeneration) return;
          void this.handleSendMessage(
            'Görev henüz bitmedi. Kaldığın yerden devam et: plan adımlarını tamamla, ' +
              'kabul kriterlerini işaretle ve doğrulamayı geçir. Bitirmeden "tamamlandı" deme.',
            undefined,
            { internal: true }
          ).catch((err: unknown) => {
            this.notify({
              level: 'error',
              message: errorMessage(err, 'Otonom devam turu başlatılamadı.')
            });
          });
        }, 0);
      } else if (decision.reason === 'budget') {
        this.notify({
          level: 'warning',
          message: `Otonom devam sınırına ulaşıldı (${this.autoContinuations}). Görev elle sürdürülmeli.`
        });
      }
    } catch (err) {
      // Eski döngünün hataları yeni oturumu etkilememeli.
      if (generation !== this.runGeneration) {
        return;
      }
      // Beklenmeyen bir hata ajanı "running" durumunda sıkıştırmamalı.
      if (this.state.status === 'running') {
        this.state.status = 'failed';
      }
      this.notify({
        level: 'error',
        message: errorMessage(err, 'An unexpected error occurred in the agent loop.')
      });
      await this.saveCurrentState();
      this.emitState();
    }
  }

  /**
   * İptal/oturum değişikliği nedeniyle yarıda kalan araç çağrılarını işaretler.
   */
  public async markInterruptedToolCalls(reason: string): Promise<void> {
    for (const message of this.state.messages) {
      if (!message.toolCalls) continue;
      for (const tc of message.toolCalls) {
        if (tc.status === 'pending' || tc.status === 'approved' || tc.status === 'executing') {
          tc.status = 'rejected';
          tc.error = tc.error || reason;
        }
      }
    }
    if (this.state.pendingToolCall) {
      this.state.pendingToolCall.status = 'rejected';
      this.state.pendingToolCall.error = this.state.pendingToolCall.error || reason;
    }
  }

  /**
   * Araç kararlarını `.ahi/audit.log` dosyasına yazar (P1-07).
   * Kayıtlar hash zincirine bağlıdır; müdahale algılanabilir (`npm run audit:verify`).
   * Log yazımı başarısız olsa bile ajan döngüsü sürer.
   */
  public async auditTool(tc: ToolCall, workspaceRoot: string | undefined, decision: string) {
    if (!workspaceRoot) return;
    try {
      // Kimlik bilgilerini maskele ama komutun kendisini koru: denetim izi
      // yalnızca ne çalıştığını hâlâ gösteriyorsa işe yarar.
      const args = JSON.stringify(tc.args || {}, redactForAudit).slice(0, 1000);
      await AuditLog.append(workspaceRoot, { decision, tool: tc.name, args });
    } catch {
      // Denetim logu yazılamadı; ana akışı engelleme.
    }
  }

  /**
   * Otomatik doğrulama yalnızca güvenilen çalışma alanlarında çalışır; reddetme
   * kurallarına takılmayan ve kullanıcı tarafından zaten otomatik onaylanmış komutlar kullanılır.
   */
  public getSandboxConfig(workspaceRoot?: string): SandboxConfig | undefined {
    const sandbox = this.settings.sandbox;
    if (!sandbox || sandbox.mode !== 'docker' || !workspaceRoot) {
      return undefined;
    }
    // Asla sessizce host'a geri düşme: Docker seçildiyse onda kal ve
    // yalıtımsız çalışmak yerine belgelenmiş varsayılan imgeyi kullan.
    return {
      image: sandbox.image || DEFAULT_SANDBOX_IMAGE,
      workspaceRoot,
      network: sandbox.network
    };
  }

  /**
   * Depoda tanımlı hook'lar için ilk kullanım onayı; MCP hub'ının onay
   * akışını yansıtır. Parmak izi dosyayla birlikte değişir, bu yüzden
   * düzenlenmiş bir hooks.json yeniden onay ister; güvenilmeyen çalışma
   * alanı bu noktaya hiç ulaşamaz.
   */
  private async confirmWorkspaceHooks(fingerprint: string, commands: string[]): Promise<boolean> {
    const root = getActiveWorkspaceRoot();
    if (!root) return false;

    const preview = commands
      .slice(0, 5)
      .map((command) => `• ${command}`)
      .join('\n');

    return requestFingerprintApproval({
      scope: 'hooks',
      workspaceRoot: root,
      fingerprint,
      store: this.context.workspaceState,
      ask: async () => {
        const choice = await vscode.window.showWarningMessage(
          'Bu proje, .ahi/hooks.json içindeki hook komutlarını çalıştırmak istiyor.',
          {
            modal: true,
            detail:
              `Hook komutları bilgisayarınızda çalışır ve her araç çağrısında tetiklenebilir. ` +
              `Yalnızca güvendiğiniz projelerde onaylayın.\n\n${preview}` +
              (commands.length > 5 ? `\n… ve ${commands.length - 5} komut daha` : '')
          },
          'Çalıştır',
          'Atla'
        );
        return choice === 'Çalıştır';
      }
    });
  }

  private canAutoRunVerificationCommand(command: string): boolean {
    if (!vscode.workspace.isTrusted) return false;
    const blocked = this.permissionManager.isToolBlocked('execute_command', { command });
    if (blocked.blocked) return false;
    return !this.permissionManager.requiresApproval('execute_command', { command });
  }

  /** Durumu bir metot üzerinden okur ki TypeScript eski bir daraltmayı (narrowing) tutmasın. */
  public isTaskCompleted(): boolean {
    return this.state.status === 'completed';
  }

  /**
   * Komutu VS Code tümleşik terminalinde çalıştırır.
   *
   * Uygulama `terminalExecution` içindedir ki ajan döngüsü orkestrasyona
   * odaklanabilsin; bu sarmalayıcı, ayarlara bağlı terminal adını tek yerde tutar.
   */
  public runInIntegratedTerminal(
    command: string,
    workspaceRoot: string,
    signal?: AbortSignal
  ): Promise<string> {
    return runInIntegratedTerminal(command, workspaceRoot, { signal, terminalName: 'AhiCode' });
  }

  public isBusy(): boolean {
    return (
      this.state.status === 'running' ||
      this.state.status === 'waiting_approval' ||
      this.state.status === 'waiting_user_input'
    );
  }

  public async saveCurrentState() {
    try {
      await this.historyManager.saveTask(this.state);
    } catch (err) {
      // Geçmiş yazımı başarısız olsa bile ajan döngüsünü sürdür.
      logWarning('Could not save session record', err);
    }
  }

  public emitState() {
    this.onStateUpdate({ ...this.state });
  }

  public nextMessageId(): string {
    this.messageSeq = (this.messageSeq + 1) % Number.MAX_SAFE_INTEGER;
    return `msg_${Date.now()}_${this.messageSeq}`;
  }

  public getInitialState(mode: AgentMode = 'code'): TaskState {
    return {
      id: '',
      prompt: '',
      mode,
      status: 'idle',
      messages: [],
      workflow: createWorkflowState(),
      stats: {
        totalTokens: 0,
        stepsCount: 0,
        filesModified: [],
        verification: {
          status: 'not_run',
          attempts: 0
        }
      }
    };
  }
}
