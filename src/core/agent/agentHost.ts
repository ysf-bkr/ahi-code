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
import type { AgentMode, TaskState, ToolCall, UserSettings } from '../../shared/types';
import type { ModelProvider } from '../../providers/base';
import type { PermissionManager } from '../permission/PermissionManager';
import type { HistoryManager } from '../memory/HistoryManager';
import type { McpHub } from '../mcp/McpHub';
import type { SubagentManager } from '../multiagent/SubagentManager';
import type { SkillManager } from '../skills/SkillManager';
import type { LspClient } from '../lsp/LspClient';
import type { SnapshotManager } from '../snapshot/SnapshotManager';
import type { HookManager } from '../hooks/HookManager';
import type { CheckpointManager } from '../checkpoint/CheckpointManager';
import type { ContextManager } from '../context/ContextManager';
import type { ProjectMemoryManager, ProjectMemoryStatus } from '../memory/ProjectMemoryManager';
import type { TaskPlanner } from '../plan/TaskPlanner';
import type { VerificationManager } from '../verification/VerificationManager';
import type { ModelRouter } from '../routing/ModelRouter';
import type { WorktreeManager } from '../worktree/WorktreeManager';
import type { GitManager, CommandCheckpoint } from '../git/GitManager';
import type { WorkspaceRuleManager } from '../rules/WorkspaceRuleManager';
import type { KnowledgeStore } from '../knowledge/KnowledgeStore';
import type { EmbeddingIndex } from '../knowledge/EmbeddingIndex';
import type { VectorMemory } from '../memory/VectorMemory';
import type { SpecStore } from '../spec/SpecStore';
import type { CallGraphManager } from '../callgraph/CallGraphManager';
import type { SessionPersistence } from './sessionPersistence';
import type { SandboxConfig } from '../verification/CommandRunner';
import type { WorkflowState, WorkflowStage } from '../workflow/TaskWorkflow';

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
  projectMemory: ProjectMemoryManager;
  planner: TaskPlanner;
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
