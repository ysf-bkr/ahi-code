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
import { ToolCall, ToolName } from '@ahicode/core/shared/types';
import { isRecord } from '@ahicode/core/shared/errors';
import { errorMessage } from '@ahicode/core/shared/errors';
import { AHI_DIR, AHI_SUBDIRS } from '@ahicode/core/shared/constants';
import { resolveWorkspacePath } from '@ahicode/core/tools/pathSafety';
import { coerceToolArguments, validateToolArguments, ToolDefinition } from '@ahicode/core/tools/base';
import {
  parseModulePlanInput,
  parsePlanUpdateInput,
  parseSubagentTaskParams
} from '@ahicode/core/tools/parsers';
import { logWarning } from '@ahicode/core/shared/logging';
import type { AgentHost } from './agentHost';
import { ReadDeduper } from '@ahicode/core/core/agent/readDeduper';
import type { SubagentTaskParams } from '@ahicode/core/core/multiagent/SubagentManager';
import {
  runTaskGraph,
  formatTaskGraphResults,
  type TaskNode
} from '@ahicode/core/core/multiagent/parallelScheduler';
import type { CommandCheckpoint } from '@ahicode/core/core/git/GitManager';
import { ROLE_ALIASES, getAgentDefinition } from '@ahicode/core/shared/agents';
import { skipsApprovalGates } from '@ahicode/core/core/agent/autonomy';
import { MAX_INTAKE_QUESTIONS } from '@ahicode/core/core/workflow/TaskWorkflow';
import { describeWorkflow } from '@ahicode/core/core/workflow/TaskWorkflow';

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
   * Tek bir araç çağrısı için yürütme öncesi kapı zinciri: aşama/mod kilidi,
   * argüman düzeltme, proje reddetme kuralları, kaydedilmemiş editör koruması,
   * diff önizleme, takip soruları, PreToolUse hook'ları, kullanıcı onayı
   * bekleme ve yazma öncesi snapshot.
   *
   * - 'abort-turn': turun tamamı durmalı (iptal, oturum değişikliği).
   * - 'skip': bu çağrı sonuçlandı (engellendi, reddedildi veya yanıtlandı);
   *   sıradaki çağrıyla devam edilir.
   * - 'execute': tüm kapılar geçildi; çağrı 'executing' olarak işaretlenir.
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

    // Aşama/mod kilidi yetkilidir: model filtrelenmiş bir aracı halüsine
    // edebilir (ya da eski bir çağrıyı yeniden oynayabilir), bu yüzden
    // aşağıdaki her dal araç listesi aramasına güvenmek yerine aynı izin
    // listesine uymak zorundadır.
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

    // 1. Proje izinlerini denetle (reddetme kuralları)
    const blockCheck = this.host.permissionManager.isToolBlocked(tc.name, tc.args);
    if (blockCheck.blocked) {
      tc.status = 'error';
      tc.error = blockCheck.reason;
      await this.host.auditTool(tc, workspaceRoot, 'blocked');
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'skip';
    }

    // 1.5 Kaydedilmemiş editör değişiklikleriyle çakışmayı önle.
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
        // Geçersiz yol: hatayı aracın kendi yol doğrulaması bildirir.
      }
    }

    // 2. Onay gerektiğinde görsel diff önizlemesi aç (otomatik onaylarda sekmeleri şişirmemek için).
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
          // Belirsiz bir hedef için yanıltıcı diff gösterme; hatayı araç bildirir.
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

      if (showDiff && !tc.requiresApproval) {
        // Kullanıcının yapılan değişikliği (diff) ekranda net bir şekilde görebilmesi için insani inceleme süresi
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }

    // 4. ask_followup_question: AJANI DURAKLAT VE KULLANICI GİRDİSİNİ BEKLE!
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
      // Soru bütçesi: her gerçek soru sayılır. Sınır aşıldığında ajan soru
      // sormaz, en makul varsayımla ilerler; böylece "en fazla 8 soru"
      // belgesi gerçekten uygulanır.
      const workflow = this.host.workflow.getWorkflow();
      const remaining = Math.max(0, MAX_INTAKE_QUESTIONS - workflow.questionsAsked);
      if (remaining <= 0) {
        tc.status = 'completed';
        tc.result =
          `[Question budget] Soru sınırına ulaşıldı (${MAX_INTAKE_QUESTIONS}). ` +
          `Yeni soru sorma; en makul varsayımla ilerle ve varsayımı spec'in assumptions alanına yaz. ` +
          `Sorulmak istenen: ${toolArgString(tc.args, 'question')}`;
        await this.host.auditTool(tc, workspaceRoot, 'auto_answered');
        await this.host.saveCurrentState();
        this.host.emitState();
        return 'skip';
      }
      workflow.questionsAsked += 1;

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

      // Oturum değiştiyse yeni oturumun durumunu değiştirme.
      if (generation !== this.host.runGeneration) {
        return 'abort-turn';
      }

      this.host.state.pendingQuestion = undefined;

      // Yanıt beklenirken görev iptal edildiyse döngüyü "running" durumunda bırakma.
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

    // 5. PreToolUse hook'u
    const preHook = await this.host.hookManager.runPreToolUse(tc.name, tc.args, workspaceRoot);
    if (!preHook.proceed) {
      tc.status = 'rejected';
      tc.error = preHook.message || 'Blocked by the PreToolUse hook.';
      await this.host.auditTool(tc, workspaceRoot, 'hook_blocked');
      await this.host.saveCurrentState();
      this.host.emitState();
      return 'skip';
    }

    // 6. Kullanıcı onayı denetimi
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

      // Oturum değiştiyse yeni oturumun durumunu değiştirme.
      if (generation !== this.host.runGeneration) {
        return 'abort-turn';
      }

      this.host.state.pendingToolCall = undefined;

      // Onay beklenirken görev iptal edildiyse görevi "running" durumunda bırakma.
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

    // 7. Dosyaları onaydan hemen önce snapshot'la (reddedilen işlemler geri alma yığınını kirletmez).
    if ((tc.name === 'write_file' || tc.name === 'edit_file') && tc.args.path) {
      try {
        const snapshotId = await this.host.snapshotManager.createSnapshot(
          targetPath,
          workspaceRoot,
          tc.id,
          tc.explanation
        );
        // Snapshot'ı bu turun checkpoint'ine bağla ki geri sarma bu dosyaları da geri yüklesin.
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
   * read_file hedefini istatistikler: tekrar-okuma bekçisinin anahtarı için
   * çözümlenmiş mutlak yol ve değişiklik zamanı gerekir. İstatistik
   * alınamıyorsa (silinmiş dosya, geçersiz yol) koruma sessizce devre dışı
   * kalır ve okuma normal şekilde çalışır — asla aracı engellemez.
   */
  private async inspectReadTarget(
    args: Record<string, unknown>,
    workspaceRoot: string | undefined
  ): Promise<{ path: string; mtimeMs: number } | undefined> {
    const raw = toolArgString(args, 'path');
    if (!raw) return undefined;
    try {
      const resolved = resolveWorkspacePath(raw, workspaceRoot);
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) return undefined;
      return { path: resolved, mtimeMs: stat.mtimeMs };
    } catch {
      return undefined;
    }
  }

  /**
   * Hazırlanmış tek bir araç çağrısını yürütür: özel araçlar (paralel alt
   * ajanlar, worktree birleştirme, plan ve spec yakalama, alt ajan delege
   * etme) ve komut checkpoint'li genel araç yolu.
   *
   * - paused: tur, spec/plan onay kartı için durmalı.
   * - filesChanged: çağrı dosyaları değiştirmiş olabilir; çağıran hızlı
   *   doğrulama döngüsünü tetikler.
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
        // Okuma aşamasında paralel alt ajanlar da salt-okunur çalışır; yazma ve
        // komut araçları onlara verilmez, böylece aşama kilidi atlanmaz.
        const readOnly =
          this.host.state.mode === 'plan' ||
          describeWorkflow(this.host.workflow.getWorkflow(), this.host.state.mode).readOnly;
        const nodes: Array<TaskNode<SubagentTaskParams>> = rawTasks
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map((item, index) => ({
            id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `task-${index + 1}`,
            role: typeof item.role === 'string' ? item.role : 'backend',
            payload: {
              role: typeof item.role === 'string' ? item.role : 'backend',
              task: typeof item.task === 'string' ? item.task : '',
              context: typeof item.context === 'string' ? item.context : undefined,
              // Paralel yazan ajanlar ana çalışma alanını bozmaması için
              // varsayılan olarak kendi yalıtılmış worktree'sinde çalışır.
              isolate: true,
              readOnly
            },
            dependsOn: Array.isArray(item.dependsOn)
              ? item.dependsOn.filter((dep): dep is string => typeof dep === 'string')
              : []
          }))
          .filter((node) => node.payload.task.trim().length > 0);
        if (nodes.length === 0) throw new Error('No valid task definitions found.');

        // Bağımlılık çizgesi: bir görev, bağımlıları bitmeden başlamaz;
        // bağımlısı başarısız olan görev çalıştırılmaz. Bağımsız görevler
        // eşzamanlı koşar (en fazla 4).
        const results = await runTaskGraph(
          nodes,
          (node) =>
            this.host.subagentManager.runSubagent(
              node.payload,
              workspaceRoot,
              0,
              this.host.activeAbortController?.signal
            ),
          { maxConcurrency: 4 }
        );
        tc.status = 'completed';
        tc.result = formatTaskGraphResults(results);
        // Her görev yalıtılmış worktree'de koştu: ana çalışma alanı değişmedi.
        // Ana ağacı "değişti" sayıp doğrulama tetiklemek, hiç test edilmemiş
        // worktree değişikliklerini "doğrulandı" gösterirdi. Doğrulamanın
        // dürüst tetikleyicisi merge_worktree'dur (uygulanan diff orada test
        // edilir); rapor metni worktree yollarını ve diff'i zaten içeriyor.
        return { paused: false, filesChanged: false };
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
        tc.result = message.message;
        // Birleşen değişiklikler testleri tetiklemeli: eskiden merge sonrası
        // doğrulama hiç çalışmıyordu.
        return { paused: false, filesChanged: message.applied };
      } catch (err) {
        tc.status = 'error';
        tc.error = errorMessage(err, 'Could not merge worktree.');
      }
      return { paused: false, filesChanged: false };
    }

    if (tc.name === 'update_module_plan') {
      try {
        const input = parseModulePlanInput(tc.args);
        const modules = this.host.modulePlanner.update(input);
        this.host.state.modules = modules;
        tc.status = 'completed';
        tc.result = this.host.modulePlanner.formatForTool();
        this.host.workflow.syncProgressToState();
        this.host.emitState();
      } catch (err) {
        tc.status = 'error';
        tc.error = errorMessage(err, 'Could not update the module plan.');
      }
      return { paused: false, filesChanged: false };
    }

    if (tc.name === 'update_plan') {
      try {
        // Plan, modül haritasından türetilir: her adım bir modüle ve en az bir
        // kabul kriterine bağlı olmalı. Harita yoksa önce onu iste.
        if (!this.host.modulePlanner.hasPlan()) {
          tc.status = 'error';
          tc.error =
            'No module map yet. Call update_module_plan first: split the work into layered modules ' +
            '(shared → domain → infrastructure → application → interface), then write the plan steps against them.';
          return { paused: false, filesChanged: false };
        }
        const moduleIds = new Set(this.host.modulePlanner.getPlan()?.modules.map((m) => m.id) ?? []);
        const criteriaIds = this.currentCriteriaIds();
        const plan = this.host.planner.update({
          ...parsePlanUpdateInput(tc.args),
          validation: {
            moduleIds,
            criteriaIds,
            requireModule: true,
            requireCriteria: criteriaIds.size > 0
          }
        });
        this.host.state.plan = plan;
        tc.status = 'completed';
        tc.result = this.host.planner.formatForTool();

        // Spec onayından sonra yazılan plan, herhangi bir kod yazılmadan
        // önce kullanıcı tarafından onaylanmalı.
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
      const def = getAgentDefinition(
        (ROLE_ALIASES[subParams.role.toLowerCase()] || subParams.role).toLowerCase()
      );
      // Okuma aşamasında (spec/plan onayı öncesi) alt ajan salt-okunur çalışır.
      // Devretmenin kendisi engellenmez: keşif ve mimari analiz için alt ajan
      // tam da bu aşamada gerekir.
      const readOnly =
        this.host.state.mode === 'plan' ||
        describeWorkflow(this.host.workflow.getWorkflow(), this.host.state.mode).readOnly;
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
          { ...subParams, readOnly },
          workspaceRoot,
          0,
          this.host.activeAbortController?.signal
        );
        tc.status = 'completed';
        tc.result = result;
        // Alt ajan dosya değiştirdiyse ana ajanın doğrulama döngüsünü tetikle.
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
    // Komut geri alma kaydı try/catch dışında tutulur: hata alan komut da
    // bitmiş sayılır ve kayıt güncellenmelidir.
    let commandCheckpoint: CommandCheckpoint | undefined;
    try {
      if (argError) throw new Error(argError);
      // Komutlar rastgele dosyaları değiştirebilir (kurulum, migration, kod
      // üreteci). Değişiklik geri alınabilir olsun diye önce Git durumunu kaydet.
      if (workspaceRoot && (tc.name === 'execute_command' || tc.name === 'run_tests')) {
        try {
          commandCheckpoint = await this.host.gitManager.createCommandCheckpoint(workspaceRoot);
          if (commandCheckpoint) this.host.commandCheckpoints.set(tc.id, commandCheckpoint);
        } catch {
          // Git deposu değil ya da ağaç kirli: komut geri alma yok.
        }
      }

      // Komutun dosya değiştirip değiştirmediğini ölçmek için öncesi anlık
      // görüntüsü (denetim bulgusu): `ls` bile filesChanged: true döndürüp
      // typecheck+lint ve tur sonu doğrulamasını boşuna tetikliyordu.
      let commandStatusBefore: string | undefined;
      if (workspaceRoot && tc.name === 'execute_command') {
        commandStatusBefore = await this.porcelainSnapshot(workspaceRoot);
      }

      // Tekrar-okuma koruması: ölçülen asıl israf "aynı dosyayı oku → düşün →
      // yine oku" döngüsü. Birebir aynı okuma son birkaç adımın çıktısı
      // arasında zaten varsa VE dosya o arada değişmemişse içerik yeniden
      // üretilmez, model yönlendirilir. offset/limit farkı her zaman çalışır.
      let readStamp: { path: string; mtimeMs: number } | undefined;
      if (tc.name === 'read_file') {
        readStamp = await this.inspectReadTarget(tc.args, workspaceRoot);
        if (
          readStamp &&
          this.host.readDeduper.isRedundant(readStamp.path, tc.args.offset, tc.args.limit, readStamp.mtimeMs)
        ) {
          tc.status = 'completed';
          tc.result = ReadDeduper.duplicateNote(readStamp.path, tc.args.offset, tc.args.limit);
          return { paused: false, filesChanged: false };
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
        permissionManager: this.host.permissionManager,
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
      // Okuma gerçekten çalıştı: pencereye yaz ki sonraki birebir tekrar stub'lanabilsin.
      if (tc.name === 'read_file' && readStamp) {
        this.host.readDeduper.record(readStamp.path, tc.args.offset, tc.args.limit, readStamp.mtimeMs);
      }
      // Komut bitti: geri alma bu andan SONRA gelen değişiklikleri kullanıcının
      // işi sayar ve onları silmez (denetim bulgusu F07).
      if (commandCheckpoint) commandCheckpoint.completedAt = Date.now();

      if (tc.name === 'write_spec') {
        // Spec artık yazıldı: planlama ya da kod yazma öncesinde dur ve
        // kullanıcıdan onay iste. Kimlik araç sonucundan okunur; list()[0]
        // eşzamanlı oturumlarda yanlış spec'i onaya sunabilirdi (denetim m.13).
        const draftedId = /^Spec drafted:\s*(\S+)/m.exec(tc.result || '')?.[1];
        const drafted =
          (draftedId ? this.host.specStore.get(draftedId) : undefined) ?? this.host.specStore.list()[0];
        if (drafted && (await this.host.workflow.pauseForSpecApproval(drafted, modelToolCalls, tc.id))) {
          return { paused: true, filesChanged: false };
        }
      }
      if (tc.name === 'update_acceptance_criteria') {
        // Yeni kriterleri hemen TaskState'e yaz; yoksa sayaç bir sonraki
        // ilgisiz güncellemeye kadar bayat kalır.
        this.host.workflow.syncProgressToState();
      }
      if (tc.name === 'read_file') {
        // Tembel bilgi kürasyonu: dosyayı bir kez özetle ki gelecek turlar
        // onu anlamak için yeniden okumak zorunda kalmasın (hash ile önbelleklenir).
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
          // Dosyanın eski okuma kayıtları artık bayat: içerik değişti,
          // bir sonraki okuma ne olursa olsun gerçekten çalışmalı.
          try {
            this.host.readDeduper.invalidate(resolveWorkspacePath(targetPath, workspaceRoot));
          } catch {
            /* geçersiz yol zaten yazma sırasında raporlandı */
          }
          void this.host.callGraphManager.onFileChanged(workspaceRoot, targetPath);
          // Değiştirilen dosyayı doğrudan VS Code editöründe aç ve göster
          void this.host.openFileInEditor(targetPath, workspaceRoot);
        }
        return { paused: false, filesChanged: true };
      }
      if (tc.name === 'execute_command') {
        // Kod üretme/biçimlendirme komutları dosyaları değiştirebilir — ama
        // hepsi değiştirmez. Ölçülebildiğinde (Git deposu) gerçek farka bakılır;
        // ölçülemediğinde muhafazakâr davranıp "değişti" kabul edilir.
        if (commandStatusBefore === undefined || !workspaceRoot) {
          return { paused: false, filesChanged: true };
        }
        const statusAfter = await this.porcelainSnapshot(workspaceRoot);
        return { paused: false, filesChanged: statusAfter !== commandStatusBefore };
      }
    } catch (err) {
      tc.status = 'error';
      tc.error = errorMessage(err, 'An error occurred while running the tool.');
      // Hata alan komut da bitmiş sayılır; yarım kalan etkileri geri alınabilir
      // ama sonradan yapılan kullanıcı değişiklikleri yine korunmalı.
      if (commandCheckpoint) commandCheckpoint.completedAt = Date.now();
    }
    return { paused: false, filesChanged: false };
  }

  /** Ölçüm amaçlı `git status` anlık görüntüsü; Git yoksa undefined. */
  private async porcelainSnapshot(workspaceRoot: string): Promise<string | undefined> {
    try {
      return await this.host.gitManager.status(workspaceRoot);
    } catch {
      return undefined;
    }
  }

  /** Geçerli spec'in kabul kriteri kimlikleri; spec yoksa boş küme. */
  private currentCriteriaIds(): Set<string> {
    const specId = this.host.workflow.getWorkflow().specId;
    if (!specId) return new Set();
    const spec = this.host.specStore.get(specId);
    return new Set(spec?.acceptanceCriteria.map((criterion) => criterion.id) ?? []);
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
    // Yönlendirilmiş iş akışı henüz build aşamasına gelmemişse ve plan onaylı değilse bekle
    if (workflow.stage && workflow.stage !== 'build' && !workflow.planApproved) return;

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
