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
    this.host.modulePlanner.hydrate(this.host.state.modules);

    if (rootChanged) {
      this.host.notify({
        level: 'info',
        message: `Çalışma alanı kökü değişti. Bu kök için geri alma kayıtları yüklendi: ${path.basename(workspaceRoot)}`
      });
    }
  }

  /**
   * Onay için duran bir turda hiç çalışmayacak araç çağrılarını kapatır.
   * "pending" bırakmak arayüzde sonsuz spinner gösteriyordu ve bir sonraki
   * istekte çağrının açıklamasız düşmesine yol açıyordu.
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
   * Açıkça yeni ve temiz bir oturum başlatır
   */
  public async createNewSession(mode: AgentMode = this.host.state.mode) {
    // Yeni sohbet, önceki sohbeti arka planda bırakmaz: çalışan tur, bekleyen
    // onay/soru ve alt ajan isteği aynı anda iptal edilir.
    const wasBusy = this.host.isBusy();
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
    // Snapshot'lar oturuma özeldir; önceki dosya değişiklikleri yeni oturumda geri alınmamalı.
    await this.host.snapshotManager.clear();
    this.host.persistence.reset();
    this.host.commandCheckpoints.clear();
    this.host.state = this.host.getInitialState(mode);
    this.host.currentTurnId = undefined;
    this.host.planner.clear();
    this.host.modulePlanner.clear();
    this.host.repairAttempts = 0;
    this.host.autoContinuations = 0;
    this.host.baselineCaptured = false;
    this.host.lastVerificationSkip = '';
    await this.host.context.workspaceState.update('ahi_active_session_id', undefined);
    this.host.emitState();
    this.host.notify({
      level: 'info',
      message: wasBusy
        ? 'Önceki görev durduruldu ve yeni bir sohbet başlatıldı.'
        : 'Yeni bir sohbet oturumu başlatıldı.'
    });
  }

  /**
   * Güncel görevi / oturumu temizler (createNewSession için takma ad)
   */
  public async clearTask() {
    await this.createNewSession();
  }

  /**
   * Geçmişten eski bir oturumu yükler
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
      this.host.modulePlanner.hydrate(this.host.state.modules);
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
    // Önceki döngüyü geçersiz kıl: iptalden hemen sonra yeni görev başlarsa
    // yeni durumu değiştiremesin.
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
   * Sohbeti ve dosya sistemini belirli bir checkpoint'e geri sarar
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
      this.host.modulePlanner.hydrate(this.host.state.modules);
      this.host.state.checkpoints = this.host.checkpointManager.getSummaries();
      await this.host.saveCurrentState();
      this.host.emitState();
      this.host.notify({ level: 'info', message: res.message });
    } else {
      this.host.notify({ level: 'error', message: res.message });
    }
  }

  /**
   * En son dosya değişikliğini geri alır
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
   * Belirli bir toolCallId'ye ait snapshot'ı geri alır
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
   * Bir komutun (kurulum, migration, kod üreteci) dosya sistemi yan
   * etkilerini, komut öncesi alınan Git checkpoint'iyle geri alır.
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

  /** Komutun geri alınıp alınamayacağı (arayüz düğmeyi bununla gösterir). */
  public canRevertCommand(toolCallId: string): boolean {
    return this.host.commandCheckpoints.has(toolCallId);
  }

  /**
   * Ajan kullanıcı girdisi beklerken durakladığında yanıtı iletir
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
   * Bir başarısızlıktan sonra son kullanıcı istemini yeniden gönderir.
   *
   * Başarısız asistan turu atılır, *saklanan* kullanıcı mesajı da kaldırılır;
   * ardından istem normal yoldan gönderilir. Böylece gönderme mantığını
   * çoğaltmadan sohbette yinelenen ya da yarım turlar kalmaz. Saklanan mesaja
   * enjekte edilen editör içeriği sıyırdığından, yeniden deneme eski bir
   * snapshot yerine güncel editörü yansıtır.
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
    // Başarısız turu (asistan çıktısı, askıda kalan araç çağrıları) ve kullanıcı
    // mesajını at; handleSendMessage temiz birini ekler.
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

  /**
   * Gönderilmiş bir kullanıcı mesajını düzenleyip yeniden çalıştırır.
   *
   * Eski davranış istemi ikinci kez *ekliyordu*; sohbette aynı soru ve iki
   * yanıt kalıyordu. Düzenleme artık o mesajdan sonraki her şeyi (o turun
   * yanıtı, araç çağrıları, sonraki turlar) atar ve istemi yerinde yeniden
   * gönderir. Böylece geçmiş tek bir doğrusal sohbet olarak kalır.
   */
  public async editMessage(messageId: string, text: string): Promise<void> {
    if (this.host.isBusy()) {
      this.host.notify({
        level: 'warning',
        message: 'Ajan çalışırken mesaj düzenlenemez. Önce görevi durdurun.'
      });
      return;
    }

    const index = this.host.state.messages.findIndex((message) => message.id === messageId);
    if (index < 0 || this.host.state.messages[index]?.role !== 'user') {
      this.host.notify({ level: 'warning', message: 'Düzenlenecek kullanıcı mesajı bulunamadı.' });
      return;
    }

    const prompt = text.trim();
    if (!prompt) return;

    // Düzenlenen mesaj ve sonrası atılır; handleSendMessage güncel istemi
    // yeni bir tur olarak ekler.
    this.host.state.messages = this.host.state.messages.slice(0, index);
    this.host.state.pendingApproval = undefined;
    this.host.state.pendingToolCall = undefined;
    this.host.state.pendingQuestion = undefined;
    this.host.state.activeSubagent = undefined;
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
