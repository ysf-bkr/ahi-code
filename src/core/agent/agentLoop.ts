/**
 * Ajan döngüsü.
 *
 * Bir turun kalbi: model çağrısı, araç hazırlama/yürütme, hızlı doğrulama,
 * görev sonu doğrulaması ve onarım döngüsü.
 */
import * as vscode from 'vscode';
import { ChatMessage, ToolCall } from '@ahicode/core/shared/types';
import { createModelProvider } from '@ahicode/core/providers';
import { ALL_TOOLS } from '@ahicode/core/tools';
import { ToolDefinition } from '@ahicode/core/tools/base';
import { generateSystemPrompt } from '@ahicode/core/core/prompts/systemPrompt';
import { getActiveWorkspaceRoot } from '../workspace/workspaceRoot';
import { filterToolsForMode } from '@ahicode/core/core/agent/modeTools';
import { skipsApprovalGates } from '@ahicode/core/core/agent/autonomy';
import { buildProviderMessages, mapModelToolCalls } from '@ahicode/core/core/agent/turnAssembly';
import { detectLintCommand, detectTestCommand } from '@ahicode/core/tools';
import { errorMessage } from '@ahicode/core/shared/errors';
import { logWarning } from '@ahicode/core/shared/logging';
import { describeWorkflow, formatWorkflowForPrompt } from '@ahicode/core/core/workflow/TaskWorkflow';
import type { AgentHost } from './agentHost';

export class AgentLoop {
  constructor(private host: AgentHost) {}

  public async run(turnId: string, userPrompt: string) {
    const generation = this.host.runGeneration;
    const workspaceRoot = getActiveWorkspaceRoot();
    // Yeni tur, önceki "ilerleyemiyor" bildirimini geçersiz kılar.
    this.host.workflow.getWorkflow().blockedReason = undefined;
    this.host.changedFilesInLastTurn = false;

    if (workspaceRoot) {
      await this.host.ensureSessionPersistence(workspaceRoot);
    }
    this.host.verificationManager.setSandbox(this.host.getSandboxConfig(workspaceRoot));

    // Çalışma alanı özelleştirmelerini ve izinleri yükle
    try {
      await this.host.skillManager.loadWorkspaceCustomizations(workspaceRoot);
      await this.host.workspaceRules.load(workspaceRoot);
      await this.host.permissionManager.loadProjectPermissions(workspaceRoot, vscode.workspace.isTrusted);
      await this.host.hookManager.loadWorkspaceHooks(workspaceRoot);
    } catch (err) {
      // Özelleştirmeler elden geldiğince yüklenir: eksik bir AGENTS.md ya da
      // okunamayan bir skills dizini görevi engellememeli. Geçersiz izin
      // dosyaları ayrıca ele alınır (onay istemini zorlarlar).
      logWarning('Could not load workspace customizations', err);
    }

    // Proje bilgi tabanını ve spec'leri yükle, ardından yalnızca değişen dosyaları tazele.
    if (workspaceRoot) {
      try {
        await this.host.specStore.load(workspaceRoot);
        const loaded = await this.host.knowledgeStore.load(workspaceRoot);
        if (loaded) {
          await this.host.knowledgeStore.refresh(workspaceRoot, {
            signal: this.host.activeAbortController?.signal
          });
        } else {
          // İndeks yok ya da bozuk: insan dosyaları yukarıda zaten yüklendi,
          // depo haritasını ise turu bekletmeden arka planda üret.
          void this.host.knowledgeStore.ensureFresh(workspaceRoot, {
            signal: this.host.activeAbortController?.signal
          });
        }
        const workflow = this.host.workflow.getWorkflow();
        workflow.knowledgeReady = true;
        // Daha önce onaylanmış bir spec buraya OTOMATİK eklenmez. Yeni görev
        // kendi spec'ini yazdırmalı ve onaylatmalıdır; eski görevin onaylı
        // spec'ini devralmak spec kapısını sessizce atlatıyordu (A görevinin
        // kabul kriterleri B görevine sızıyordu). Geri yüklenen oturumlar
        // specId'lerini kalıcı iş akışı durumunda tutar; tek meşru bağ budur.
        // Arka plan işi: regex sembol aralıklarını hassas LSP aralıklarıyla değiştir.
        this.host.knowledgeCurator.enrichWithLsp(workspaceRoot);
        // Çağrı haritası yoksa arka planda üretilir; tur beklemez.
        void this.host.callGraphManager.ensureReady(workspaceRoot);
        this.host.workflow.syncProgressToState();
      } catch (err) {
        // Bilgi/spec yükleme görevi engellememeli; ama indeks yenilenemediğinde
        // bunun logda görünmesi gerekir.
        logWarning('Could not load the project knowledge base', err);
      }
    }

    // Proje bilgisi yüklendiğinde "Anlama" tamamlanmış olur; istek artık
    // ele alınıyor demektir. Bu olmadan şerit ilk aşamada takılı kalıyordu.
    const workflowAfterOnboarding = this.host.workflow.getWorkflow();
    if (workflowAfterOnboarding.stage === 'onboard') {
      workflowAfterOnboarding.stage = 'intake';
      workflowAfterOnboarding.updatedAt = Date.now();
      this.host.workflow.syncProgressToState();
    }

    // Göreve uygun modeli seç (yalnızca kullanıcı yönlendirmeyi etkinleştirdiyse).
    const routing = this.host.modelRouter.route(userPrompt, this.host.state.mode, this.host.settings);
    let turnProvider = this.host.provider;
    let resolvedModel = routing.model;
    if (routing.routed) {
      try {
        turnProvider = createModelProvider({ ...this.host.settings, selectedModel: routing.model });
      } catch (err) {
        // Turu bozmadan varsayılan sağlayıcıya geri dön.
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

    // Değişikliklerden önce test durumunu (başlangıç noktası) isteğe bağlı olarak kaydet.
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
            summary: baseline.summary,
            skippedReason: baseline.skippedReason
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
    // Bilgi tabanını arka planda ısıt: özet sonraki turların istemine girer.
    // Eşzamanlı çağrılar depoda tek taramada birleşir; görevi beklemez.
    if (workspaceRoot) this.host.warmKnowledgeBase(workspaceRoot);
    const projectMemoryContext = await this.host.projectMemory.formatForPrompt(workspaceRoot);
    const lastUser = [...this.host.state.messages].reverse().find((m) => m.role === 'user');
    const userPromptText = lastUser?.content || this.host.state.prompt;
    const vectorMemoryContext = workspaceRoot
      ? await this.host.vectorMemory.formatForPrompt(workspaceRoot, userPromptText, 4)
      : '';
    // İlk tur soğuk boşluğu: ısıtme yeni başladıysa özet henüz boş olabilir.
    // Modele taramadan önce bekleyip indeksleyecek aracı açıkça göster.
    const knowledgeContext = this.host.knowledgeStore.getStatus().ready
      ? this.host.knowledgeStore.formatForPrompt()
      : '\n\n=== PROJECT KNOWLEDGE BASE (indexing) ===\n' +
        'The knowledge base is being indexed in the background right now. Before any project-wide ' +
        'scan (list_directory/read_file sweeps), call get_project_knowledge once — it waits for the ' +
        'index and returns the repo map, so most reads become unnecessary.';
    const workflow = this.host.workflow.getWorkflow();
    const workflowContext =
      formatWorkflowForPrompt(workflow, this.host.state.mode) +
      this.host.specStore.formatForPrompt(workflow.specId);
    // Belgelenmemiş projedeki ilk görev: modelden, kullanıcı görevinin yanı sıra
    // project.md taslağı yazması istenir (araç kapısından onaylanır).
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
      `${vectorMemoryContext ? `\n\n${vectorMemoryContext}` : ''}${onboardingNudge}\n${workflowContext}${knowledgeContext}` +
      this.host.modulePlanner.formatForPrompt();

    let mcpTools: ToolDefinition[] = [];
    try {
      mcpTools = await this.host.mcpHub.ensureInitialized(workspaceRoot);
    } catch (err) {
      // MCP sunucuları isteğe bağlıdır; sunucu başına hatalar hub tarafından loglanır.
      logWarning('Could not initialize MCP servers', err);
    }

    // Araç koleksiyonu
    const allAvailableTools: ToolDefinition[] = [...Object.values(ALL_TOOLS), ...mcpTools];

    // GERÇEK PLANLAMA MODU: Dosya yazma, düzenleme ve komut çalıştırma araçları planlama modunda teknik olarak kilitlidir.
    // İş akışı ayrıca spec ve plan onaylanana kadar değişiklik yapan araçları kilitler.
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

    // Adım bütçesi varsayılan olarak sınırsız: görev, model yanıtı bitirene
    // veya kullanıcı durdurana kadar sürer. Ayarlar'da pozitif bir değer
    // verildiğinde tur o kadar adımda duraklatılır (bilinçli opt-in sınır).
    const stepBudget =
      this.host.settings.maxStepsPerTask && this.host.settings.maxStepsPerTask > 0
        ? this.host.settings.maxStepsPerTask
        : Number.POSITIVE_INFINITY;
    let maxSteps = stepBudget;
    let changedDuringTurn = false;

    while (!this.host.isCancelled && this.host.state.status === 'running') {
      // Token bütçesi bir sonraki model çağrısından ÖNCE kontrol edilir:
      // duraklatılan turda hiç model çağrısı yapılmaz, yarım işlenmiş araç
      // çağrısı ve boşa harcanan yanıt kalmaz. Aşım en fazla bir yanıtla
      // sınırlıdır çünkü kullanım bilgisi ancak yanıtın sonunda gelir.
      const tokenBudget = this.host.settings.maxTokensPerTask ?? 0;
      if (tokenBudget > 0 && this.host.state.stats.totalTokens >= tokenBudget) {
        this.host.state.status = 'paused';
        this.host.notify({
          level: 'warning',
          message: `Token bütçesi sınırına ulaşıldı (${this.host.state.stats.totalTokens} / ${tokenBudget} token). Görev duraklatıldı; sürdürmek için Ayarlar'daki "Token bütçesi" değerini yükseltin ya da 0 (sınırsız) yapın.`
        });
        await this.host.saveCurrentState();
        this.host.emitState();
        return;
      }

      if (maxSteps <= 0) {
        break;
      }

      maxSteps--;
      this.host.state.stats.stepsCount++;

      // Aşama tur içinde ilerlediyse (spec/plan onayı) kilidi güncelle.
      tools = toolsForCurrentStage();

      // LLM için tam mesaj geçmişini oluştur (saf yardımcı, birim testli).
      const providerMessages = buildProviderMessages(systemPrompt, this.host.state.messages);

      // Akış yapan asistan mesajı tutucusu
      const assistantMsgId = this.host.nextMessageId();
      const streamingAssistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        // Bu yanıt, aynı kullanıcı istemine ait önceki adımlarla tek blokta toplanır.
        turnId
      };
      this.host.state.messages.push(streamingAssistantMsg);
      this.host.emitState();

      // Bağlamı modelin bağlam penceresi içinde tutmak için budula ve sıkıştır.
      // Bu API taşmasına karşı teknik bir korumadır, harcama sınırı değil:
      // görevi asla duraklatmaz, yalnızca yeniden gönderileni kısaltır.
      // Harcanmış araç çıktılarını önce sıkıştır: eski adımlar için bir işaret
      // yeterlidir ve tüm geçmiş her yinelemede yeniden gönderilir.
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
        // İstek iptal edildiyse akış göstergesini temizle.
        if (
          this.host.isCancelled ||
          (err instanceof Error && err.name === 'AbortError') ||
          /cancelled|stopped/i.test(message)
        ) {
          // Eski döngü yeni oturumun durumunun üzerine yazmamalı.
          if (generation !== this.host.runGeneration) return;
          streamingAssistantMsg.isStreaming = false;
          this.host.state.status = 'cancelled';
          await this.host.saveCurrentState();
          this.host.emitState();
          return;
        }
        // Eski döngü yeni oturumun durumunun üzerine yazmamalı.
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

      // Model yanıt vermeden önce oturum değişmiş olabilir.
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

      // Kullanım bilgisi yalnızca sağlayıcı döndürüyorsa gelir; bütçe kontrolü
      // döngünün başında (bir sonraki model çağrısından önce) yapılır.
      if (response.usage) {
        this.host.state.stats.totalTokens += response.usage.totalTokens;
      }
      this.host.state.stats.lastModel = resolvedModel;
      this.host.state.stats.modelRoutingReason = routing.reason;

      const modelToolCalls: ToolCall[] = mapModelToolCalls(
        response.toolCalls || [],
        this.host.permissionManager
      );

      // `run_tests`/`run_linter` komutu atlayıp aracın algılamasına bırakabilir.
      // Şimdi çöz ki onay kartı, risk değerlendirmesi ve denetim logu
      // gerçekte çalışacak komutu tarif etsin.
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
            // Komutu boş bırak; araç eyleme dönüştürülebilir hatayı bildirir.
          }
        }
      }

      streamingAssistantMsg.toolCalls = modelToolCalls.length > 0 ? modelToolCalls : undefined;
      await this.host.saveCurrentState();
      this.host.emitState();

      // Araç çağrısı yoksa model yanıtını bu turda tamamladı
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
        // Kod değiştiren görevler için bir tur daha: kalıcı kararları bilgi
        // tabanına geri besle (araç kapısı üzerinden kullanıcı onaylı).
        // Otonom modda bu tur, bilgi yazımı "always" onay istediği için ajanı
        // kilitlerdi; bu yüzden atlanır ve nedeni bildirilir.
        if (
          changedDuringTurn &&
          !this.host.memoryRecordedForTask &&
          !skipsApprovalGates(this.host.settings)
        ) {
          this.host.memoryRecordedForTask = true;
          // Bilgi kaydı turu kod değiştirmez; tur sonu doğrulaması bir kez
          // çalışsın diye bayrağı sıfırla. Aksi hâlde testler iki kez koşar.
          changedDuringTurn = false;
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

      // Araç çağrılarını sırayla yürüt
      let filesChangedInBatch = false;
      const allowedToolNames = new Set(tools.map((tool) => tool.name));
      for (const tc of modelToolCalls) {
        if (this.host.isCancelled || generation !== this.host.runGeneration) return;

        // 1-7. adımlar: aşama kilidi, izinler, kirli editör koruması, diff
        // önizleme, takip soruları, hook'lar, kullanıcı onayı ve yazma öncesi
        // snapshot (bkz. prepareToolCall).
        const preparation = await this.host.toolPipeline.prepareToolCall(tc, {
          allowedToolNames,
          tools,
          workspaceRoot,
          generation
        });
        if (preparation === 'abort-turn') return;
        if (preparation === 'skip') continue;

        // 8. Aracı yürüt (özel araçlar ve genel yol).
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

        // Oturum değiştiyse eski turun sonuçlarını yeni oturuma yazma.
        if (generation !== this.host.runGeneration) {
          return;
        }

        await this.host.auditTool(tc, workspaceRoot, tc.status);

        // 9. PostToolUse hook'u
        await this.host.hookManager.runPostToolUse(tc.name, tc.args, tc.result, tc.error, workspaceRoot);

        await this.host.saveCurrentState();
        this.host.emitState();
      }

      // --- Otomatik doğrulama ve sınırlı kendini onarma döngüsü ---
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
        message: `Görev adım sınırına ulaşıldı (${stepBudget} adım). Devam etmek için "devam" yazın veya Ayarlar'daki adım bütçesini yükseltin (0 = sınırsız).`
      });
      await this.host.saveCurrentState();
      this.host.emitState();
    }
  }
}
