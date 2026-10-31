/**
 * Otomatik doğrulama denetleyicisi.
 *
 * Tur içi hızlı doğrulama (tip/lint) ve görev sonu tam doğrulama burada.
 * Onarım bütçesi kararı saf `repairPolicy` modülünden gelir.
 */
import { decideRepair } from '@ahicode/core/core/verification/repairPolicy';
import type { AgentHost } from './agentHost';
import type { ProjectMemoryStatus } from '@ahicode/core/core/memory/ProjectMemoryManager';

export class VerificationController {
  constructor(private host: AgentHost) {}

  /**
   * Görev sonu doğrulaması: model yanıtını başka araç çağrısı yapmadan
   * bitirdiğinde tam doğrulama paketini bir kez çalıştırır ve sınırlı
   * kendini onarma döngüsünü yönetir.
   *
   * - 'retry': bir onarım denemesi enjekte edildi; döngü sürer.
   * - 'abort': görev kalıcı olarak başarısız ya da iptal edildi; turu durdur.
   * - 'done': doğrulama geçti ya da yalnızca önceden var olan hatalar kaldı.
   */
  public async runEndOfTaskVerification(
    workspaceRoot: string,
    generation: number
  ): Promise<'retry' | 'abort' | 'done'> {
    this.host.notify({ level: 'info', message: 'Görev sonu doğrulaması çalıştırılıyor...' });
    this.host.state.stats.verification = {
      status: 'running',
      attempts: this.host.repairAttempts,
      summary: 'Görev sonu doğrulaması çalışıyor...'
    };
    await this.host.saveCurrentState();
    this.host.emitState();

    const finalVerification = await this.host.verificationManager.verify(workspaceRoot, {
      signal: this.host.activeAbortController?.signal
    });
    if (this.host.isCancelled || generation !== this.host.runGeneration) return 'abort';

    this.host.state.stats.verification = {
      status: finalVerification.status,
      attempts: this.host.repairAttempts,
      summary: finalVerification.summary,
      lastRunAt: finalVerification.ranAt
    };
    await this.host.saveCurrentState();
    this.host.emitState();

    const maxRepair = this.host.settings.maxRepairAttempts ?? 2;
    const decision = decideRepair({
      status: finalVerification.status,
      newFailures: this.host.verificationManager.getNewFailures(finalVerification),
      hasBaseline: Boolean(this.host.verificationManager.getBaseline()),
      attempts: this.host.repairAttempts,
      maxAttempts: maxRepair
    });

    if (decision.action === 'retry') {
      this.host.repairAttempts = decision.attempts;
      this.host.state.stats.verification.attempts = this.host.repairAttempts;
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content: this.host.verificationManager.formatForPrompt(finalVerification),
        timestamp: Date.now()
      });
      this.host.notify({
        level: 'warning',
        message: `Görev sonu doğrulaması başarısız. Onarım denemesi ${this.host.repairAttempts}/${maxRepair}.`
      });
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'retry';
    }

    if (decision.action === 'abort') {
      this.host.state.status = 'failed';
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content: this.host.verificationManager.formatForPrompt(finalVerification),
        timestamp: Date.now()
      });
      this.host.notify({
        level: 'error',
        message: `Görev sonu doğrulaması başarısız; onarım sınırına (${maxRepair}) ulaşıldı.`
      });
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'abort';
    }

    if (finalVerification.status === 'passed') {
      this.host.repairAttempts = 0;
      this.host.state.stats.verification.attempts = 0;
    }
    return 'done';
  }

  /**
   * Araç toplulukları arasında hızlı doğrulama: yalnızca statik denetimler
   * (typecheck, lint); uzun testler görev sonunda çalışır.
   *
   * - 'retry': bir onarım denemesi enjekte edildi; döngü sürer.
   * - 'abort': onarım bütçesi tükendi ya da görev iptal edildi.
   * - 'proceed': sıradaki toplulukla devam et.
   */
  public async runQuickVerification(
    workspaceRoot: string,
    generation: number
  ): Promise<'retry' | 'abort' | 'proceed'> {
    const verification = await this.host.verificationManager.verify(workspaceRoot, {
      signal: this.host.activeAbortController?.signal,
      kinds: ['typecheck', 'lint']
    });

    // Doğrulama sırasında kullanıcı iptal etmiş ya da oturum değişmiş olabilir.
    if (this.host.isCancelled || generation !== this.host.runGeneration) {
      return 'abort';
    }

    this.host.state.stats.verification = {
      status: verification.status,
      attempts: this.host.repairAttempts,
      summary: verification.summary,
      lastRunAt: verification.ranAt,
      skippedReason: verification.skippedReason
    };
    await this.host.saveCurrentState();
    this.host.emitState();

    const maxRepair = this.host.settings.maxRepairAttempts ?? 2;
    const decision = decideRepair({
      status: verification.status,
      newFailures: this.host.verificationManager.getNewFailures(verification),
      hasBaseline: Boolean(this.host.verificationManager.getBaseline()),
      attempts: this.host.repairAttempts,
      maxAttempts: maxRepair
    });

    if (decision.action === 'proceed' && decision.reason === 'skipped') {
      if (verification.summary !== this.host.lastVerificationSkip) {
        this.host.lastVerificationSkip = verification.summary;
        this.host.notify({ level: 'info', message: verification.summary });
      }
    } else if (decision.action === 'proceed' && decision.reason === 'only-preexisting') {
      // Başlangıç noktasında zaten var olan hatalar için ajanı döngüye sokma.
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content:
          `${verification.summary}\n\nNote: These errors existed before the changes. ` +
          'Make sure you did not introduce a new regression; you do not need to fix existing errors.',
        timestamp: Date.now()
      });
      this.host.repairAttempts = 0;
    } else if (decision.action === 'retry') {
      this.host.repairAttempts = decision.attempts;
      this.host.state.stats.verification.attempts = this.host.repairAttempts;
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content: this.host.verificationManager.formatForPrompt(verification),
        timestamp: Date.now()
      });
      this.host.notify({
        level: 'warning',
        message: `Doğrulama başarısız. Otomatik onarım denemesi başlatılıyor: ${this.host.repairAttempts}/${maxRepair}.`
      });
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'retry';
    } else if (decision.action === 'abort') {
      this.host.state.status = 'failed';
      this.host.notify({
        level: 'error',
        message: `Otomatik onarım sınırına (${maxRepair}) ulaşıldı. Hatalar düzeltilemedi; rapor hazırlanıyor.`
      });
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content: this.host.verificationManager.formatForPrompt(verification),
        timestamp: Date.now()
      });
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'abort';
    } else if (decision.reason === 'passed') {
      this.host.repairAttempts = 0;
      this.host.state.stats.verification.status = 'passed';
      this.host.state.stats.verification.attempts = 0;
      await this.host.saveCurrentState();
      this.host.emitState();
    }
    return 'proceed';
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
    if (!workspaceRoot || !this.host.state.id) return;
    await this.host.projectMemory.append(workspaceRoot, {
      taskId: turnId,
      mode: this.host.state.mode,
      status,
      prompt,
      files: this.host.state.stats.filesModified,
      summary
    });
    void this.host.vectorMemory.sync(workspaceRoot, true);
  }
}
