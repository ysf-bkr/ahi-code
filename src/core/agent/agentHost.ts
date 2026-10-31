/**
 * Ajan çekirdeğinin modüller arası sözleşmesi.
 *
 * `AgentCore` eskiden tüm sorumluluğu tek sınıfta taşıyordu. İş akışı, oturum,
 * doğrulama, araç hattı ve döngü ayrı denetleyicilere taşındı; bu arayüz
 * onların ihtiyaç duyduğu ortak durumu ve yardımcıları tanımlar.
 *
 * `AgentCore` bu arayüzü uygular; denetleyiciler `vscode` modülüne değil,
 * yalnızca bu sözleşmeye bağlıdır. Böylece her modül tek başına test edilebilir.
 */
import type * as vscode from 'vscode';
import type { AgentMode, TaskState, ToolCall, UserSettings } from '@ahicode/core/shared/types';
import type { ModelProvider } from '@ahicode/core/providers/base';
import type { PermissionManager } from '@ahicode/core/core/permission/PermissionManager';
import type { HistoryManager } from '../memory/HistoryManager';
import type { McpHub } from '../mcp/McpHub';
import type { SubagentManager } from '@ahicode/core/core/multiagent/SubagentManager';
import type { SkillManager } from '@ahicode/core/core/skills/SkillManager';
import type { LspClient } from '../lsp/LspClient';
import type { SnapshotManager } from '@ahicode/core/core/snapshot/SnapshotManager';
import type { HookManager } from '@ahicode/core/core/hooks/HookManager';
import type { CheckpointManager } from '@ahicode/core/core/checkpoint/CheckpointManager';
import type { ContextManager } from '@ahicode/core/core/context/ContextManager';
import type { ReadDeduper } from '@ahicode/core/core/agent/readDeduper';
import type {
  ProjectMemoryManager,
  ProjectMemoryStatus
} from '@ahicode/core/core/memory/ProjectMemoryManager';
import type { TaskPlanner } from '@ahicode/core/core/plan/TaskPlanner';
import type { ModulePlanner } from '@ahicode/core/core/plan/ModulePlanner';
import type { VerificationManager } from '@ahicode/core/core/verification/VerificationManager';
import type { ModelRouter } from '@ahicode/core/core/routing/ModelRouter';
import type { WorktreeManager } from '@ahicode/core/core/worktree/WorktreeManager';
import type { GitManager, CommandCheckpoint } from '@ahicode/core/core/git/GitManager';
import type { WorkspaceRuleManager } from '@ahicode/core/core/rules/WorkspaceRuleManager';
import type { KnowledgeStore } from '@ahicode/core/core/knowledge/KnowledgeStore';
import type { EmbeddingIndex } from '@ahicode/core/core/knowledge/EmbeddingIndex';
import type { VectorMemory } from '@ahicode/core/core/memory/VectorMemory';
import type { SpecStore } from '@ahicode/core/core/spec/SpecStore';
import type { CallGraphManager } from '@ahicode/core/core/callgraph/CallGraphManager';
import type { SessionPersistence } from '@ahicode/core/core/agent/sessionPersistence';
import type { SandboxConfig } from '@ahicode/core/core/verification/CommandRunner';
import type { WorkflowState, WorkflowStage } from '@ahicode/core/core/workflow/TaskWorkflow';

export interface AgentNotification {
  level: 'info' | 'warning' | 'error';
  message: string;
}

/** Ajan çekirdeğinin denetleyicilere açtığı yüzey. */
export interface AgentHost {
  /** VS Code eklenti bağlamı (depolama, sırlar). */
  context: vscode.ExtensionContext;

  state: TaskState;
  settings: UserSettings;
  provider: ModelProvider;

  permissionManager: PermissionManager;
  historyManager: HistoryManager;
  mcpHub: McpHub;
  subagentManager: SubagentManager;
  skillManager: SkillManager;
  lspClient: LspClient;
  hookManager: HookManager;
  contextManager: ContextManager;
  /** "Aynı dosyayı tekrar okuma" döngüsünü engelleyen bekçi. */
  readDeduper: ReadDeduper;
  /** Bilgi tabanını görev başında arka planda ısıtır (yalnızca yerel tarama). */
  warmKnowledgeBase(workspaceRoot: string): void;
  projectMemory: ProjectMemoryManager;
  planner: TaskPlanner;
  /** Kod yazmadan önce çıkarılan katmanlı modül haritası. */
  modulePlanner: ModulePlanner;
  verificationManager: VerificationManager;
  modelRouter: ModelRouter;
  worktreeManager: WorktreeManager;
  gitManager: GitManager;
  workspaceRules: WorkspaceRuleManager;
  knowledgeStore: KnowledgeStore;
  specStore: SpecStore;
  callGraphManager: CallGraphManager;
  knowledgeCurator: {
    maybeSummarizeFile(path: string, workspaceRoot?: string): void;
    enrichWithLsp(workspaceRoot: string): void;
    needsOnboardingDraft(): boolean;
    onboardingNudge(): string;
    taskEndInstruction(): string;
  };

  /** Oturum/kök başına geri alma kayıtları. */
  persistence: SessionPersistence;
  snapshotManager: SnapshotManager;
  checkpointManager: CheckpointManager;

  embeddingIndex?: EmbeddingIndex;
  vectorMemory: VectorMemory;
  commandCheckpoints: Map<string, CommandCheckpoint>;
  lastVerificationSkip: string;
  changedFilesInLastTurn: boolean;
  /** Ardışık aynı araç+hata imzası sayacı (döngü koruması). */
  lastToolFailure: { key: string; count: number } | undefined;
  activePlanStepId: string | undefined;
  baselineCaptured: boolean;
  repairAttempts: number;
  /** Otonom modda yapılan otomatik devam sayısı. */
  autoContinuations: number;
  memoryRecordedForTask: boolean;

  isCancelled: boolean;
  runGeneration: number;
  messageSeq: number;
  activeAbortController?: AbortController;
  /** Şu an işlenen turun kimliği; asistan mesajları bu kimliği devralır. */
  currentTurnId?: string;
  pendingResolver?: (approved: boolean, reason?: string) => void;
  pendingQuestionResolver?: (answer: string) => void;

  onStateUpdate: (state: TaskState) => void;
  notify: (notification: AgentNotification) => void;
  onStreamChunk?: (messageId: string, chunk: string) => void;

  /** Denetleyiciler (karşılıklı çağrılar için). */
  workflow: WorkflowPort;
  session: SessionPort;
  tools: ToolPipelinePort;
  verification: VerificationPort;
  verificationController: VerificationPort;
  toolPipeline: ToolPipelinePort;

  // --- Yardımcılar ---
  getWorkflow(): WorkflowState;
  getInitialState(mode?: AgentMode): TaskState;
  nextMessageId(): string;
  emitState(): void;
  saveCurrentState(): Promise<void>;
  isBusy(): boolean;
  isTaskCompleted(): boolean;
  getSandboxConfig(workspaceRoot?: string): SandboxConfig | undefined;
  normalizeRestoredState(saved: TaskState): TaskState;
  rebuildPersistenceDependents(): void;
  closeRemainingToolCalls(calls: ToolCall[], exceptId: string, reason: string): void;
  markInterruptedToolCalls(reason: string): Promise<void>;
  recordProjectMemory(
    turnId: string,
    prompt: string,
    status: ProjectMemoryStatus,
    summary: string | undefined,
    workspaceRoot: string | undefined
  ): Promise<void>;
  auditTool(tc: ToolCall, workspaceRoot: string | undefined, decision: string): Promise<void>;
  openDiffPreview(filePath: string, proposedContent: string): Promise<void>;
  openFileInEditor(filePath: string, workspaceRoot?: string): Promise<void>;
  runInIntegratedTerminal(command: string, workspaceRoot: string, signal?: AbortSignal): Promise<string>;
  ensureSessionPersistence(workspaceRoot: string): Promise<void>;
  handleSendMessage(text: string, mode?: AgentMode, options?: { internal?: boolean }): Promise<void>;
  createNewSession(mode?: AgentMode): Promise<void>;
}

export interface WorkflowPort {
  getWorkflow(): WorkflowState;
  syncProgressToState(): void;
  setWorkflowStage(stage: WorkflowStage): Promise<{ ok: boolean; reason?: string }>;
  currentSpecCriteriaMet(): boolean;
  verificationPassed(): boolean;
  advanceWorkflowAfterTurn(context: { changedFiles: boolean }): Promise<void>;
  runReviewStage(): Promise<void>;
  runVerifyStage(reachedVerify: boolean): Promise<void>;
  resumeAfterApproval(instruction: string): void;
  approveSpec(): Promise<boolean>;
  approvePlan(): Promise<boolean>;
  rejectApproval(reason?: string): Promise<void>;
  pauseForSpecApproval(
    drafted: { id: string; goal: string },
    modelToolCalls: ToolCall[],
    toolCallId: string
  ): Promise<boolean>;
  pauseForPlanApproval(
    plan: { steps: unknown[] },
    modelToolCalls: ToolCall[],
    toolCallId: string
  ): Promise<boolean>;
  workspaceRootForApproval(): string;
}

export interface SessionPort {
  ensureSessionPersistence(workspaceRoot: string): Promise<void>;
  createNewSession(mode?: AgentMode): Promise<void>;
  clearTask(): Promise<void>;
  loadSession(sessionId: string): Promise<void>;
  cancelTask(): Promise<void>;
  rewindToCheckpoint(checkpointId: string): Promise<void>;
  revertLastSnapshot(): Promise<void>;
  revertToolSnapshot(toolCallId: string): Promise<void>;
  revertCommandEffects(toolCallId: string): Promise<void>;
  canRevertCommand(toolCallId: string): boolean;
  provideUserReply(answer: string): Promise<void>;
  retryLastTurn(): Promise<void>;
  /** Gönderilmiş bir kullanıcı mesajını düzenler: o mesajdan sonrası atılıp istem yeniden çalıştırılır. */
  editMessage(messageId: string, text: string): Promise<void>;
}

export interface ToolPipelinePort {
  prepareToolCall(
    tc: ToolCall,
    context: {
      allowedToolNames: Set<string>;
      tools: Array<{ name: string }>;
      workspaceRoot: string | undefined;
      generation: number;
    }
  ): Promise<'abort-turn' | 'skip' | 'execute'>;
  executeToolCall(
    tc: ToolCall,
    context: {
      modelToolCalls: ToolCall[];
      tools: Array<{ name: string }>;
      workspaceRoot: string | undefined;
    }
  ): Promise<{ paused: boolean; filesChanged: boolean }>;
  claimNextPlanStep(): void;
}

export interface VerificationPort {
  runEndOfTaskVerification(workspaceRoot: string, generation: number): Promise<'retry' | 'abort' | 'done'>;
  runQuickVerification(workspaceRoot: string, generation: number): Promise<'retry' | 'abort' | 'proceed'>;
}
