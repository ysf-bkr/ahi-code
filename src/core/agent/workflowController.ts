/**
 * Yönlendirilmiş iş akışı denetleyicisi.
 *
 * Aşama geçişleri, spec/plan onay kapıları ve tur sonu ilerleme burada.
 * Kapılar `@core/workflow/TaskWorkflow` içindeki saf fonksiyonlardan gelir;
 * bu sınıf yalnızca yan etkileri (durum, kalıcılık, arayüz) uygular.
 */
import { ToolCall } from '../../shared/types';
import {
  canTransition,
  createWorkflowState,
  gateForStage,
  stageLabel,
  stageOrderForMode,
  WorkflowStage,
  WorkflowState
} from '../workflow/TaskWorkflow';
import { errorMessage } from '../../shared/errors';
import { logWarning } from '../../shared/logging';
import { skipsApprovalGates } from './autonomy';
import { getActiveWorkspaceRoot } from '../workspace/workspaceRoot';
import type { TaskSpec } from '../spec/SpecStore';
import type { TaskPlan } from '../../shared/types';
import type { AgentHost } from './agentHost';

export class WorkflowController {
  constructor(private host: AgentHost) {}

  public getWorkflow(): WorkflowState {
    const existing = this.host.state.workflow;
    if (existing) return existing;
    const created = createWorkflowState();
    this.host.state.workflow = created;
    return created;
  }

  /**
   * Mirrors workflow, spec and knowledge into TaskState so the webview can render
   * them without extra round-trips.
   */
  public syncProgressToState(): void {
    const workflow = this.getWorkflow();
    this.host.state.workflow = workflow;

    // Only the spec linked to this workflow is shown. Falling back to any
    // approved spec displayed a previous task's spec on a fresh session.
    const spec = workflow.specId ? this.host.specStore.get(workflow.specId) : undefined;
    this.host.state.spec = spec
      ? {
          id: spec.id,
          goal: spec.goal,
          scope: spec.scope,
          outOfScope: spec.outOfScope,
          assumptions: spec.assumptions,
          acceptanceCriteria: spec.acceptanceCriteria.map((criterion) => ({
            id: criterion.id,
            text: criterion.text,
            done: criterion.done
          })),
          files: spec.files,
          risk: spec.risk,
          status: spec.status
        }
      : undefined;

    const knowledge = this.host.knowledgeStore.getStatus();
    this.host.state.knowledge = {
      ready: knowledge.ready,
      fileCount: knowledge.fileCount,
      symbolCount: knowledge.symbolCount,
      summarizedCount: knowledge.summarizedCount,
      indexedAt: knowledge.indexedAt,
      lastCommit: knowledge.lastCommit
    };
  }

  /**
   * Requests a workflow stage change. Gates enforce spec/plan approval, so the
   * model cannot jump straight to writing code.
   */
  public async setWorkflowStage(stage: WorkflowStage): Promise<{ ok: boolean; reason?: string }> {
    // A manual change mid-turn would desync the tool list from the real stage.
    if (this.host.isBusy()) {
      return { ok: false, reason: 'Ajan çalışırken aşama değiştirilemez.' };
    }
    const workflow = this.getWorkflow();
    const transition = canTransition(workflow.stage, stage, this.host.state.mode);
    if (!transition.allowed) {
      return { ok: false, reason: transition.reason };
    }

    const gate = gateForStage(
      stage,
      {
        state: workflow,
        // The gate must be scoped to this workflow's own spec. A store-wide
        // lookup would let a previous task's approved spec unlock the plan
        // and build stages for an unrelated new task.
        hasApprovedSpec: Boolean(
          workflow.specId && this.host.specStore.get(workflow.specId)?.status === 'approved'
        ),
        hasPlan: this.host.planner.hasPlan(),
        criteriaMet: this.currentSpecCriteriaMet(),
        verificationPassed: this.verificationPassed()
      },
      this.host.state.mode
    );
    if (!gate.allowed) {
      return { ok: false, reason: gate.reason };
    }

    workflow.stage = stage;
    workflow.updatedAt = Date.now();
    workflow.blockedReason = undefined;
    this.syncProgressToState();
    this.host.emitState();
    return { ok: true };
  }

  public currentSpecCriteriaMet(): boolean {
    const specId = this.getWorkflow().specId;
    if (!specId) return false;
    return this.host.specStore.isComplete(specId);
  }

  public verificationPassed(): boolean {
    const verification = this.host.state.stats.verification;
    return verification?.status === 'passed' || verification?.status === 'skipped';
  }

  /**
   * Moves the workflow forward after a turn finishes.
   *
   * Previously nothing ever advanced past `build`, so the progress strip stuck
   * on "Uygulama" right after the plan was approved. Automatic steps still go
   * through the same gates as a user-requested transition; when a gate refuses
   * (for example unmarked acceptance criteria), the strip stops there and shows
   * an explicit, honest reason instead of pretending progress.
   */
  public async advanceWorkflowAfterTurn(context: { changedFiles: boolean }): Promise<void> {
    if (this.host.state.status !== 'completed') return;

    const workflow = this.getWorkflow();
    const planning = this.host.state.mode === 'plan';
    const order = stageOrderForMode(this.host.state.mode);
    if (workflow.stage === 'done') return;

    if (planning) {
      // Planlama modunda plan yoksa sohbet turu plan aşaması gibi görünmemeli.
      if (!this.host.planner.hasPlan()) return;
      if (workflow.stage !== 'review' && workflow.stage !== 'plan') return;
    } else {
      // Plan onaylanmadan önce aşamalar spec/plan araçları ve onay kapılarıyla
      // ilerler; bu yardımcı devreye girmez.
      if (!workflow.planApproved) return;
      if (order.indexOf(workflow.stage) < order.indexOf('build')) return;

      const verificationRan = (this.host.state.stats.verification?.status ?? 'not_run') !== 'not_run';
      if (workflow.stage === 'build' && !context.changedFiles && !verificationRan) {
        workflow.blockedReason =
          'Uygulama aşamasında değişiklik yapılmadı; ilerlemek için bir görev gönderin.';
        this.host.emitState();
        return;
      }
    }

    // Yalnızca BİR sonraki aşamaya geçilir. Eskiden `done`'a kadar döngü
    // çalışıyordu; bu, inceleme ve doğrulama kapılarının aynı turda sessizce
    // atlanmasına ve şeridin yanlış aşamada kalmasına yol açıyordu.
    const nextStage = order[order.indexOf(workflow.stage) + 1];
    if (!nextStage) return;

    const result = await this.setWorkflowStage(nextStage);
    if (!result.ok) {
      workflow.blockedReason =
        nextStage === 'done'
          ? 'Görev tamamlanmadı: kabul kriterleri işaretlenmeli ve doğrulama geçmeli.'
          : `${stageLabel(nextStage)} aşamasına geçilemedi; önce tamamlanması gereken adımlar var.`;
      this.syncProgressToState();
      this.host.emitState();
      return;
    }

    workflow.blockedReason = undefined;
    this.syncProgressToState();
    this.host.emitState();

    // İnceleme aşamasına girildiyse çağrı haritasıyla "güncellenmemiş çağıran"
    // kontrolü yapılır; bulgu modele sistem mesajı olarak iletilir.
    if (!planning && nextStage === 'review') {
      await this.runReviewStage();
    }

    // Doğrulama aşamasına girildiyse doğrulamayı burada çalıştır: sonuç
    // "done" kapısını açar ya da ajanı uygulama aşamasına geri gönderir.
    if (!planning && nextStage === 'verify') {
      await this.runVerifyStage(true);
    }
  }

  /**
   * İnceleme aşamasının işleyicisi.
   *
   * Değişen dosyalardaki dışa aktarılan fonksiyonların çağıranlarına bakar;
   * çağıran dosya da değiştirilmediyse bunu "güncellenmemiş çağıran olabilir"
   * diye dürüstçe raporlar. Harita hazır değilse kontrol atlanır ve bu açıkça
   * yazılır; sessizce "temiz" denmez.
   */
  public async runReviewStage(): Promise<void> {
    const workspaceRoot = getActiveWorkspaceRoot();
    if (!workspaceRoot) return;

    try {
      await this.collectStaleCallers(workspaceRoot);
    } catch (err) {
      // İnceleme yardımcı bir adımdır; hatası tüm turu düşürmemeli.
      logWarning('İnceleme adımı tamamlanamadı', err);
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content: `İnceleme: çağıran kontrolü çalıştırılamadı (${errorMessage(err)}). Değişiklikleri elle gözden geçirin.`,
        timestamp: Date.now()
      });
      await this.host.saveCurrentState();
      this.host.emitState();
    }
  }

  /** Değişen sembollerin güncellenmemiş çağıranlarını toplar. */
  private async collectStaleCallers(workspaceRoot: string): Promise<void> {
    const document = this.host.callGraphManager.getDocument(workspaceRoot);
    const changedFiles = new Set(this.host.state.stats.filesModified.map((file) => file.replace(/\\/g, '/')));

    if (!document) {
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content:
          'İnceleme: çağrı haritası hazır olmadığı için "güncellenmemiş çağıran" kontrolü yapılamadı. ' +
          'Değişen dışa aktarılan fonksiyonların çağıranlarını elle kontrol edin.',
        timestamp: Date.now()
      });
      await this.host.saveCurrentState();
      this.host.emitState();
      return;
    }

    const staleCallers: string[] = [];
    for (const node of document.nodes) {
      if (!changedFiles.has(node.file) || !node.exported) continue;
      const callers = document.edges.filter((edge) => edge.to === node.id);
      for (const edge of callers) {
        const caller = document.nodes.find((candidate) => candidate.id === edge.from);
        if (!caller || changedFiles.has(caller.file)) continue;
        staleCallers.push(
          `${caller.file}:${caller.startLine} ${caller.name} → ${node.file}:${node.startLine} ${node.name}`
        );
      }
    }

    const unique = [...new Set(staleCallers)].slice(0, 20);
    const body =
      unique.length === 0
        ? 'İnceleme: değişen dışa aktarılan fonksiyonların bilinen çağıranları da güncellenmiş görünüyor.'
        : 'İnceleme: aşağıdaki çağıranlar değişmedi; imza/ davranış değiştiyse gözden geçirin:\n' +
          unique.map((line) => `- ${line}`).join('\n');

    this.host.state.messages.push({
      id: this.host.nextMessageId(),
      role: 'system',
      content: `${body}\n(Bu liste çağrı haritasına dayanır; dinamik çağrılar ve başka paketlerden kullanım görünmez.)`,
      timestamp: Date.now()
    });
    await this.host.saveCurrentState();
    this.host.emitState();
  }

  /**
   * Doğrulama aşamasının işleyicisi.
   *
   * Doğrulama geçerse `done` denenir; kriterler eksikse ajan uygulama
   * aşamasına geri döner ve neyin eksik olduğu dürüstçe bildirilir. Böylece
   * aşama şeridi "Doğrulama"da asılı kalmaz ve yazma işi bittiğinde görev
   * gerçekten kapanır.
   */
  public async runVerifyStage(reachedVerify: boolean): Promise<void> {
    const workflow = this.getWorkflow();
    if (!reachedVerify || workflow.stage !== 'verify') return;

    try {
      await this.verifyAndFinish();
    } catch (err) {
      // Doğrulama çalıştırılamazsa görev "başarılı" sayılmaz; durum dürüstçe
      // bildirilir ve ajan uygulama aşamasında kalır.
      logWarning('Doğrulama adımı çalıştırılamadı', err);
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content: `Doğrulama çalıştırılamadı: ${errorMessage(err)}. Test/lint komutunu elle çalıştırın.`,
        timestamp: Date.now()
      });
      await this.host.saveCurrentState();
      this.host.emitState();
    }
  }

  /** Doğrulamayı çalıştırır, sonuca göre `done` ya da `build` aşamasına geçer. */
  private async verifyAndFinish(): Promise<void> {
    const workflow = this.getWorkflow();
    const workspaceRoot = getActiveWorkspaceRoot();
    if (workspaceRoot && this.host.settings.autoVerify !== false) {
      const verification = await this.host.verificationManager.verify(workspaceRoot, {
        signal: this.host.activeAbortController?.signal
      });
      this.host.state.stats.verification = {
        status: verification.status,
        attempts: this.host.repairAttempts,
        summary: verification.summary,
        lastRunAt: verification.ranAt
      };
      await this.host.saveCurrentState();
      this.host.emitState();
    }

    if (this.canFinishTask()) {
      const result = await this.setWorkflowStage('done');
      if (result.ok) {
        workflow.blockedReason = undefined;
        this.syncProgressToState();
        this.host.emitState();
        return;
      }
    }

    // Bitti kapısı kapalı: uygulama aşamasına geri dön ve nedenini yaz.
    const back = await this.setWorkflowStage('build');
    if (back.ok) {
      workflow.stage = 'build';
      workflow.updatedAt = Date.now();
    }
    const missing = this.missingAcceptanceCriteria();
    workflow.blockedReason =
      missing.length > 0
        ? `Bitti kapısı kapalı: işaretlenmemiş kabul kriterleri var (${missing.join(', ')}).`
        : 'Bitti kapısı kapalı: doğrulama geçmedi. Test/lint çıktısına göre düzeltme gerekiyor.';
    this.syncProgressToState();
    this.host.emitState();
  }

  /** Bitti kapısı için gereken koşullar sağlanmış mı? */
  private canFinishTask(): boolean {
    return this.currentSpecCriteriaMet() && this.verificationPassed();
  }

  /** Henüz işaretlenmemiş kabul kriterlerinin kimlikleri. */
  private missingAcceptanceCriteria(): string[] {
    const specId = this.getWorkflow().specId;
    if (!specId) return [];
    const spec = this.host.specStore.get(specId);
    if (!spec) return [];
    return spec.acceptanceCriteria.filter((criterion) => !criterion.done).map((criterion) => criterion.id);
  }

  /**
   * Resumes the agent loop after a user approval.
   *
   * Approving a spec or plan used to just set the status to `idle`, so the agent
   * never produced the plan and never started building: the task looked stuck on
   * the "Plan" stage. The loop is resumed with an internal system instruction,
   * without adding a fake user message.
   */
  public resumeAfterApproval(instruction: string): void {
    if (this.host.isCancelled) return;
    void this.host.handleSendMessage(instruction, undefined, { internal: true }).catch((err: unknown) => {
      this.host.notify({
        level: 'error',
        message: errorMessage(err, 'Onay sonrası görev sürdürülemedi.')
      });
    });
  }

  /** Marks the drafted spec as approved and moves to the planning stage. */
  public async approveSpec(): Promise<boolean> {
    const workflow = this.getWorkflow();
    const specId = workflow.specId;
    if (!specId) {
      this.host.notify({ level: 'warning', message: 'Onaylanacak bir spec bulunamadı.' });
      return false;
    }
    if (!this.host.state.pendingApproval || this.host.state.pendingApproval.kind !== 'spec') {
      this.host.notify({ level: 'warning', message: 'Şu anda onay bekleyen bir spec yok.' });
      return false;
    }

    await this.host.specStore.approve(this.workspaceRootForApproval(), specId);
    workflow.specApproved = true;
    workflow.stage = 'plan';
    workflow.updatedAt = Date.now();
    workflow.blockedReason = undefined;
    this.host.state.pendingApproval = undefined;
    this.host.state.status = 'idle';
    this.syncProgressToState();
    await this.host.saveCurrentState();
    this.host.emitState();
    this.host.notify({ level: 'info', message: 'Spec onaylandı. Plan hazırlanıyor…' });
    this.resumeAfterApproval(
      'Spec onaylandı ve plan aşamasına geçildi. Şimdi `update_plan` aracıyla hedefe ve kabul kriterlerine ' +
        'uygun, bağımlılıkları belirtilmiş adımlardan oluşan planı oluştur ve onaya sun. ' +
        'Bu aşamada kod yazma ve komut çalıştırma yok.'
    );
    return true;
  }

  /** Approves the current plan so the agent may start building. */
  public async approvePlan(): Promise<boolean> {
    const workflow = this.getWorkflow();
    if (!this.host.state.pendingApproval || this.host.state.pendingApproval.kind !== 'plan') {
      this.host.notify({ level: 'warning', message: 'Şu anda onay bekleyen bir plan yok.' });
      return false;
    }
    if (!this.host.planner.hasPlan()) {
      this.host.notify({ level: 'warning', message: 'Onaylanacak bir plan bulunamadı.' });
      return false;
    }
    // Planning mode ends with the approved plan; there is nothing to build.
    const planning = this.host.state.mode === 'plan';
    if (!planning && !workflow.specApproved) {
      this.host.notify({ level: 'warning', message: 'Plan onaylanmadan önce spec onaylanmalı.' });
      return false;
    }

    workflow.planApproved = true;
    workflow.stage = planning ? 'done' : 'build';
    workflow.updatedAt = Date.now();
    workflow.blockedReason = undefined;
    // Plan onaylandığında adımlara uzman rol atanır; yönetici buna göre delege eder.
    if (!planning) {
      this.host.planner.assignRoles();
      this.host.state.plan = this.host.planner.getPlan();
    }
    this.host.state.pendingApproval = undefined;
    this.host.state.status = 'idle';
    this.syncProgressToState();
    await this.host.saveCurrentState();
    this.host.emitState();
    this.host.notify({
      level: 'info',
      message: planning ? 'Plan onaylandı. Plan hazır.' : 'Plan onaylandı. Uygulama başlıyor…'
    });
    if (!planning) {
      this.resumeAfterApproval(
        'Plan onaylandı ve uygulama aşamasına geçildi. Planı sırayla uygula: her adımı tamamla, ' +
          'bitirdiğin adımı `update_plan` ile "completed" olarak işaretle ve ilgili kabul kriterini güncelle. ' +
          'Değişikliklerden sonra test/lint ile doğrula. Bitirmeden "tamamlandı" deme.'
      );
    }
    return true;
  }

  public async rejectApproval(reason?: string): Promise<void> {
    if (!this.host.state.pendingApproval) return;
    const kind = this.host.state.pendingApproval.kind;
    this.host.state.pendingApproval = undefined;
    this.host.state.status = 'idle';
    const workflow = this.getWorkflow();
    // A rejection invalidates the corresponding approval flags. Without this
    // reset a stale `specApproved`/`planApproved` survived the rejection and
    // the next turn skipped the approval gate it had just been denied.
    if (kind === 'spec') {
      workflow.specApproved = false;
      workflow.planApproved = false;
      workflow.stage = 'intake';
    } else {
      workflow.planApproved = false;
      workflow.stage = 'plan';
    }
    workflow.updatedAt = Date.now();
    this.syncProgressToState();
    await this.host.saveCurrentState();
    this.host.emitState();
    this.host.notify({
      level: 'info',
      message: `${kind === 'spec' ? 'Spec' : 'Plan'} reddedildi. ${reason?.trim() || 'Gereksinimleri netleştirip tekrar deneyin.'}`
    });
  }

  public workspaceRootForApproval(): string {
    return getActiveWorkspaceRoot() || this.host.persistence.currentRoot || '';
  }

  /**
   * Spec gate: a freshly drafted spec must be approved by the user before the
   * agent plans or writes any code. Resets the approval flags because a new
   * draft invalidates earlier approvals (gate-bypass chain fix).
   *
   * Returns true when the turn must pause for the approval card.
   */
  public async pauseForSpecApproval(
    drafted: TaskSpec,
    modelToolCalls: ToolCall[],
    toolCallId: string
  ): Promise<boolean> {
    const currentWorkflow = this.getWorkflow();
    currentWorkflow.specId = drafted.id;
    currentWorkflow.stage = 'spec';
    // Without this reset, a stale `specApproved` from a previous spec let the
    // model skip the approval gate entirely.
    currentWorkflow.specApproved = false;
    currentWorkflow.planApproved = false;
    currentWorkflow.updatedAt = Date.now();

    // Otonom modda spec kartı kullanıcıyı beklemez; spec kaydedilir ve ajan
    // planlamaya geçebilir. Spec içeriği ve kabul kriterleri yine görünür.
    if (skipsApprovalGates(this.host.settings)) {
      const root = getActiveWorkspaceRoot() || this.host.persistence.currentRoot || '';
      try {
        await this.host.specStore.approve(root, drafted.id);
        currentWorkflow.specApproved = true;
        currentWorkflow.stage = 'plan';
        currentWorkflow.updatedAt = Date.now();
        this.host.state.pendingApproval = undefined;
        this.host.state.messages.push({
          id: this.host.nextMessageId(),
          role: 'system',
          content:
            `Spec otomatik onaylandı (otonomi: ${this.host.settings.autonomy}). ` +
            'Şimdi `update_plan` ile bağımlılıkları ve dosyaları belirtilmiş planı oluştur; ' +
            'her adıma `ownerRole` ekle. Plan onayı da otomatik geçilecek.',
          timestamp: Date.now()
        });
        this.syncProgressToState();
        await this.host.saveCurrentState();
        this.host.emitState();
        this.host.notify({ level: 'info', message: 'Spec otomatik onaylandı; plan hazırlanıyor.' });
        return false;
      } catch (err) {
        // Otomatik onay başarısızsa güvenli tarafa düş: kullanıcıya sor.
        logWarning('Spec otomatik onaylanamadı; kullanıcı onayı isteniyor', err);
      }
    }

    this.host.state.pendingApproval = {
      kind: 'spec',
      title: `Spec onayı: ${drafted.goal}`,
      details: this.host.specStore.formatForDisplay(drafted.id)
    };
    this.host.state.status = 'waiting_user_input';
    this.host.closeRemainingToolCalls(
      modelToolCalls,
      toolCallId,
      'Spec onayı bekleniyor; bu çağrı çalıştırılmadı.'
    );
    this.syncProgressToState();
    await this.host.saveCurrentState();
    this.host.emitState();
    return true;
  }

  /**
   * Plan gate: a plan drafted after spec approval must be confirmed by the
   * user before any code is written. In planning mode the plan is the
   * deliverable, so it does not wait for a code spec.
   *
   * Returns true when the turn must pause for the approval card.
   */
  public async pauseForPlanApproval(
    plan: TaskPlan,
    modelToolCalls: ToolCall[],
    toolCallId: string
  ): Promise<boolean> {
    const currentWorkflow = this.getWorkflow();
    const planningMode = this.host.state.mode === 'plan';
    if (!(planningMode || (currentWorkflow.specApproved && !currentWorkflow.planApproved))) {
      return false;
    }
    currentWorkflow.stage = 'plan';
    currentWorkflow.updatedAt = Date.now();
    currentWorkflow.blockedReason = undefined;

    // Otonom modda plan kartı da beklemez. Roller plana yazılır; uygulama
    // turunda yönetici bu atamaya göre delege eder.
    if (skipsApprovalGates(this.host.settings) && !planningMode) {
      this.host.planner.assignRoles();
      currentWorkflow.planApproved = true;
      currentWorkflow.stage = 'build';
      currentWorkflow.updatedAt = Date.now();
      this.host.state.pendingApproval = undefined;
      this.host.state.plan = this.host.planner.getPlan();
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content:
          `Plan otomatik onaylandı (otonomi: ${this.host.settings.autonomy}). Rol atamaları:\n` +
          `${this.host.planner.formatAssignments()}\n` +
          'Şimdi planı sırayla uygula. Uzman alt ajanları çalıştırmak gerekiyorsa orkestrasyonu `invoke_subagent` ile yalnızca @manager rolüne devret (uzmanları yalnızca @manager çalıştırabilir). ' +
          'Her adımı bitirince `update_plan` ile "completed" işaretle ve kabul kriterini güncelle. ' +
          'Bitirmeden "tamamlandı" deme.',
        timestamp: Date.now()
      });
      this.syncProgressToState();
      await this.host.saveCurrentState();
      this.host.emitState();
      this.host.notify({ level: 'info', message: 'Plan otomatik onaylandı; uygulama başlıyor.' });
      return false;
    }

    this.host.state.pendingApproval = {
      kind: 'plan',
      title: `Plan onayı: ${plan.goal || 'Görev planı'}`,
      details: this.host.planner.formatForTool()
    };
    this.host.state.status = 'waiting_user_input';
    this.host.closeRemainingToolCalls(
      modelToolCalls,
      toolCallId,
      'Plan onayı bekleniyor; bu çağrı çalıştırılmadı.'
    );
    this.syncProgressToState();
    await this.host.saveCurrentState();
    this.host.emitState();
    return true;
  }
}
