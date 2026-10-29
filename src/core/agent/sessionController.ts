/**
 * Oturum ve geri alma denetleyicisi.
 *
 * Yeni oturum, oturum yükleme, iptal ve dosya/komut geri alma burada.
 * `AgentCore` yalnızca ince delegasyonlar tutar.
 */
import * as path from 'path';
import { getActiveWorkspaceRoot } from '../workspace/workspaceRoot';
import { errorMessage } from '../../shared/errors';
import { stripInjectedContext } from '../../shared/editorContext';
import type { AgentMode, ToolCall } from '../../shared/types';
import type { AgentHost } from './agentHost';

export class SessionController {
  constructor(private host: AgentHost) {}

  public async ensureSessionPersistence(workspaceRoot: string): Promise<void> {
    if (!this.host.state.id) return;
    const resolvedRoot = path.resolve(workspaceRoot);

    const { managersChanged, rootChanged } = await this.host.persistence.ensure(
      workspaceRoot,
      this.host.state.id,
      resolvedRoot
    );

    if (managersChanged) {
      this.host.rebuildPersistenceDependents();
    }

    await this.host.verificationManager.attachWorkspace(workspaceRoot);
    if (this.host.verificationManager.getBaseline()) {
      this.host.baselineCaptured = true;
    }
    this.host.state.checkpoints = this.host.checkpointManager.getSummaries();
    this.host.planner.hydrate(this.host.state.plan);

    if (rootChanged) {
      this.host.notify({
        level: 'info',
        message: `Çalışma alanı kökü değişti. Bu kök için geri alma kayıtları yüklendi: ${path.basename(workspaceRoot)}`
      });
    }
  }

  /**
   * Marks tool calls that will never run because the turn stopped for an
   * approval. Leaving them "pending" made the UI show a spinner forever and
   * caused the next request to omit the call without any explanation.
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
   * Explicitly starts a new, clean session
   */
  public async createNewSession(mode: AgentMode = this.host.state.mode) {
    this.host.isCancelled = true;
    this.host.runGeneration++;
    if (this.host.activeAbortController) {
      this.host.activeAbortController.abort();
      this.host.activeAbortController = undefined;
    }
    if (this.host.pendingResolver) {
      this.host.pendingResolver(false, 'Yeni bir oturum başlatıldı.');
      this.host.pendingResolver = undefined;
    }
    if (this.host.pendingQuestionResolver) {
      this.host.pendingQuestionResolver('İptal edildi.');
      this.host.pendingQuestionResolver = undefined;
    }

    if (this.host.state.id && this.host.state.messages.length > 0) {
      this.host.markInterruptedToolCalls('Oturum değişti.');
      await this.host.saveCurrentState();
    }

    await this.host.checkpointManager.clear();
    // Snapshots are session-specific; previous file changes must not be reverted in a new session.
    await this.host.snapshotManager.clear();
    this.host.persistence.reset();
    this.host.commandCheckpoints.clear();
    this.host.state = this.host.getInitialState(mode);
    this.host.planner.clear();
    this.host.repairAttempts = 0;
    this.host.autoContinuations = 0;
    this.host.baselineCaptured = false;
    this.host.lastVerificationSkip = '';
    await this.host.context.workspaceState.update('ahi_active_session_id', undefined);
    this.host.emitState();
    this.host.notify({ level: 'info', message: 'Yeni bir sohbet oturumu başlatıldı.' });
  }

  /**
   * Clears the current task / session (alias to createNewSession)
   */
  public async clearTask() {
    await this.createNewSession();
  }

  /**
   * Loads a past session from history
   */
  public async loadSession(sessionId: string) {
    const saved = this.host.historyManager.getTask(sessionId);
    if (saved) {
      this.host.isCancelled = true;
      this.host.runGeneration++;
      if (this.host.activeAbortController) {
        this.host.activeAbortController.abort();
        this.host.activeAbortController = undefined;
      }
      if (this.host.pendingResolver) {
        this.host.pendingResolver(false, 'A different session was loaded.');
        this.host.pendingResolver = undefined;
      }
      if (this.host.pendingQuestionResolver) {
        this.host.pendingQuestionResolver('A different session was loaded.');
        this.host.pendingQuestionResolver = undefined;
      }

      await this.host.snapshotManager.clear();
      await this.host.checkpointManager.clear();
      // Kök sıfırlanmazsa sonraki ensureSessionPersistence() önceki oturumun
      // yöneticilerini korur ve bu oturumun kayıtlarını oraya yazar.
      this.host.persistence.reset();
      this.host.commandCheckpoints.clear();
      this.host.state = this.host.normalizeRestoredState({
        ...saved,
        status:
          saved.status === 'running' ||
          saved.status === 'waiting_approval' ||
          saved.status === 'waiting_user_input'
            ? 'idle'
            : saved.status
      });
      this.host.planner.hydrate(this.host.state.plan);
      this.host.repairAttempts = 0;
      this.host.autoContinuations = 0;
      this.host.baselineCaptured = false;
      this.host.lastVerificationSkip = '';

      const workspaceRoot = getActiveWorkspaceRoot();
      if (workspaceRoot) {
        await this.ensureSessionPersistence(workspaceRoot);
      }

      await this.host.context.workspaceState.update('ahi_active_session_id', sessionId);
      this.host.emitState();
      this.host.notify({ level: 'info', message: 'Önceki sohbet oturumu yüklendi.' });
    } else {
      this.host.notify({ level: 'error', message: 'Önceki oturum bulunamadı veya silinmiş.' });
    }
  }

  public async cancelTask() {
    const wasBusy = this.host.isBusy();
    const lastUser = [...this.host.state.messages].reverse().find((m) => m.role === 'user');
    const lastAssistant = [...this.host.state.messages]
      .reverse()
      .find((m) => m.role === 'assistant' && Boolean(m.content));
    this.host.isCancelled = true;
    // Invalidate the previous loop so it cannot modify the new state if a new
    // task starts immediately after cancellation.
    this.host.runGeneration++;
    if (this.host.activeAbortController) {
      this.host.activeAbortController.abort();
      this.host.activeAbortController = undefined;
    }
    this.host.state.status = 'cancelled';
    this.host.state.pendingToolCall = undefined;
    this.host.state.pendingQuestion = undefined;
    this.host.state.pendingApproval = undefined;
    this.host.state.activeSubagent = undefined;

    if (this.host.pendingResolver) {
      this.host.pendingResolver(false, 'Kullanıcı görevi iptal etti.');
      this.host.pendingResolver = undefined;
    }
    if (this.host.pendingQuestionResolver) {
      this.host.pendingQuestionResolver('Kullanıcı işlemi iptal etti.');
      this.host.pendingQuestionResolver = undefined;
    }

    this.host.markInterruptedToolCalls('Kullanıcı görevi iptal etti.');

    const workspaceRoot = getActiveWorkspaceRoot();
    await this.host.hookManager.runStop(workspaceRoot);

    if (wasBusy && this.host.state.id && lastUser) {
      await this.host.recordProjectMemory(
        `${this.host.state.id}:${lastUser.id}`,
        lastUser.content,
        'cancelled',
        lastAssistant?.content,
        workspaceRoot
      );
    }

    await this.host.saveCurrentState();
    this.host.emitState();
    this.host.notify({ level: 'info', message: 'İşlem durduruldu.' });
  }

  /**
   * Rewind conversation and file system to a specific checkpoint
   */
  public async rewindToCheckpoint(checkpointId: string) {
    if (this.host.isBusy()) {
      this.host.notify({
        level: 'warning',
        message: 'Ajan çalışırken geri sarılamaz. Önce görevi durdurun.'
      });
      return;
    }
    const workspaceRoot = getActiveWorkspaceRoot();
    const res = await this.host.checkpointManager.rewindToCheckpoint(
      checkpointId,
      this.host.state,
      this.host.snapshotManager,
      workspaceRoot
    );

    if (res.success && res.restoredState) {
      this.host.state = res.restoredState;
      this.host.planner.hydrate(this.host.state.plan);
      this.host.state.checkpoints = this.host.checkpointManager.getSummaries();
      await this.host.saveCurrentState();
      this.host.emitState();
      this.host.notify({ level: 'info', message: res.message });
    } else {
      this.host.notify({ level: 'error', message: res.message });
    }
  }

  /**
   * Revert the most recent file change
   */
  public async revertLastSnapshot() {
    if (this.host.isBusy()) {
      this.host.notify({
        level: 'warning',
        message: 'Ajan çalışırken dosyalar geri alınamaz. Önce görevi durdurun.'
      });
      return;
    }
    const workspaceRoot = getActiveWorkspaceRoot();
    const before = this.host.snapshotManager.getSnapshots().slice(-1)[0];
    const res = await this.host.snapshotManager.revertLast(workspaceRoot);
    if (res.success) {
      if (before?.filePath) {
        this.host.state.stats.filesModified = this.host.state.stats.filesModified.filter(
          (f) => f !== before.filePath
        );
      }
      this.host.notify({ level: 'info', message: res.message });
      await this.host.saveCurrentState();
      this.host.emitState();
    } else {
      this.host.notify({ level: 'warning', message: res.message });
    }
  }

  /**
   * Revert snapshot belonging to a specific toolCallId
   */
  public async revertToolSnapshot(toolCallId: string) {
    if (this.host.isBusy()) {
      this.host.notify({
        level: 'warning',
        message: 'Ajan çalışırken dosyalar geri alınamaz. Önce görevi durdurun.'
      });
      return;
    }
    const snap = this.host.snapshotManager.getSnapshotByToolCall(toolCallId);
    if (!snap) {
      this.host.notify({
        level: 'warning',
        message: 'Bu adım için geri yüklenebilir bir dosya anlık görüntüsü bulunamadı.'
      });
      return;
    }
    const workspaceRoot = getActiveWorkspaceRoot();
    const res = await this.host.snapshotManager.revertSnapshot(snap.id, workspaceRoot);
    if (res.success) {
      this.host.state.stats.filesModified = this.host.state.stats.filesModified.filter(
        (f) => f !== snap.filePath
      );
      this.host.notify({ level: 'info', message: res.message });
      await this.host.saveCurrentState();
      this.host.emitState();
    } else {
      this.host.notify({ level: 'error', message: res.message });
    }
  }

  /**
   * Reverts the file-system side effects of a command (install, migration,
   * code generator) using the Git checkpoint taken before it ran.
   */
  public async revertCommandEffects(toolCallId: string): Promise<void> {
    if (this.host.isBusy()) {
      this.host.notify({
        level: 'warning',
        message: 'Ajan çalışırken komut değişiklikleri geri alınamaz. Önce görevi durdurun.'
      });
      return;
    }

    const checkpoint = this.host.commandCheckpoints.get(toolCallId);
    const activeRoot = getActiveWorkspaceRoot();
    if (checkpoint && activeRoot && path.resolve(activeRoot) !== path.resolve(checkpoint.root)) {
      this.host.notify({
        level: 'warning',
        message: 'Bu komut başka bir çalışma alanında çalıştı; geri alma güvenlik için devre dışı.'
      });
      return;
    }
    if (!checkpoint) {
      this.host.notify({
        level: 'warning',
        message:
          'Bu komut için geri alma noktası yok. Yalnızca temiz bir Git çalışma ağacında komut çalıştırıldığında kaydedilir.'
      });
      return;
    }

    try {
      const message = await this.host.gitManager.restoreCommandCheckpoint(checkpoint);
      this.host.commandCheckpoints.delete(toolCallId);
      this.host.notify({ level: 'info', message });
      await this.host.saveCurrentState();
      this.host.emitState();
    } catch (err) {
      this.host.notify({
        level: 'error',
        message: errorMessage(err, 'Komut değişiklikleri geri alınamadı.')
      });
    }
  }

  /** Whether a command can be reverted (used by the UI to show the button). */
  public canRevertCommand(toolCallId: string): boolean {
    return this.host.commandCheckpoints.has(toolCallId);
  }

  /**
   * Provides answer when agent is paused waiting for user input
   */
  public async provideUserReply(answer: string) {
    if (this.host.state.status === 'waiting_user_input' && this.host.pendingQuestionResolver) {
      this.host.pendingQuestionResolver(answer);
      this.host.pendingQuestionResolver = undefined;
    } else {
      await this.host.handleSendMessage(answer);
    }
  }

  /**
   * Resends the last user prompt after a failure.
   *
   * The failed assistant turn is discarded and the *stored* user message is
   * removed too, then the prompt is sent through the normal path. That keeps the
   * conversation free of duplicate or half-written turns without duplicating the
   * send logic. Editor context injected into the stored message is stripped, so
   * the retry reflects the current editor instead of a stale snapshot.
   */
  public async retryLastTurn(): Promise<void> {
    if (this.host.isBusy()) {
      this.host.notify({
        level: 'warning',
        message: 'Ajan çalışırken yeniden gönderilemez. Önce görevi durdurun.'
      });
      return;
    }

    const lastUserIndex = this.findLastUserMessageIndex();
    const lastUser = lastUserIndex >= 0 ? this.host.state.messages[lastUserIndex] : undefined;
    if (!lastUser) {
      this.host.notify({ level: 'warning', message: 'Yeniden gönderilecek bir istem bulunamadı.' });
      return;
    }

    const prompt = stripInjectedContext(lastUser.content);
    // Drop the failed turn (assistant output, dangling tool calls) and the user
    // message; handleSendMessage appends a clean one.
    this.host.state.messages = this.host.state.messages.slice(0, lastUserIndex);
    this.host.state.pendingApproval = undefined;
    this.host.state.pendingToolCall = undefined;
    this.host.state.pendingQuestion = undefined;
    this.host.state.status = 'idle';
    this.host.isCancelled = false;
    this.host.emitState();
    await this.host.saveCurrentState();

    await this.host.handleSendMessage(prompt, this.host.state.mode);
  }

  public findLastUserMessageIndex(): number {
    for (let index = this.host.state.messages.length - 1; index >= 0; index--) {
      if (this.host.state.messages[index]?.role === 'user') return index;
    }
    return -1;
  }
}
