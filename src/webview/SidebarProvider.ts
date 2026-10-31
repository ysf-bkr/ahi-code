import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  ExtensionToWebviewMessage,
  UserSettings,
  WebviewToExtensionMessage,
  VsCodeThemeConfig,
  WorkspaceCustomizations
} from '../shared/types';
import { isChatConfigured } from '../shared/constants';
import { AgentCore, createSharedServices, SharedServices } from '../core/agent/AgentCore';
import { SessionRegistry } from '../core/agent/SessionRegistry';
import { EvrenModelProvider } from '../providers/evren';
import { getActiveWorkspaceRoot } from '../core/workspace/workspaceRoot';
import { resolveWorkspacePath } from '../tools/pathSafety';
import { errorMessage } from '../shared/errors';
import { logWarning } from '../shared/logging';
import { buildWebviewHtml } from './webviewHtml';
import {
  loadDefaultSettings,
  mergeExplicitConfiguration,
  persistSettings,
  readThemeConfig,
  restoreSettings,
  safeSettingsForWebview,
  settingsDiffer
} from './settingsStore';
import { fetchModelIds } from './modelCatalog';
import { collectGitChanges } from './gitChanges';
import { ROLE_ALIASES, getAgentDefinition } from '../shared/agents';
import { AhiCodeDiffContentProvider } from '../shared/diffContentProvider';
import { getLanguageIdForFile } from '../shared/languageMap';

type WebviewMessageHandlerMap = {
  [K in WebviewToExtensionMessage['type']]: (
    message: Extract<WebviewToExtensionMessage, { type: K }>
  ) => Promise<void> | void;
};

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ahi-code.SidebarProvider';

  private _view?: vscode.WebviewView;
  private _registry?: SessionRegistry;
  /** Oturum kayıt defteri için paylaşılan ağır servisler (tek örnek). */
  private _shared?: SharedServices;
  private _settings: UserSettings;
  private _configListenerRegistered = false;
  private _pendingNewSession = false;
  private _diffProvider = AhiCodeDiffContentProvider.getInstance();

  /** Etkin oturumun çekirdeği. Oturum yoksa `undefined`. */
  private get _agentCore(): AgentCore | undefined {
    return this._registry?.getActiveCore();
  }

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._settings = loadDefaultSettings();
  }

  /**
   * Webview açılmadan önce ayarları ve SecretStorage anahtarlarını yükler.
   * Kurucular await edilemediği için activate() tarafından çağrılır.
   */
  public async initialize(): Promise<void> {
    try {
      this._context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
          AhiCodeDiffContentProvider.scheme,
          this._diffProvider
        )
      );
    } catch (err) {
      logWarning('Failed to register diff content provider', err);
    }

    try {
      this._settings = await restoreSettings(this._context, this._settings);
    } catch (err) {
      // SecretStorage okunamazsa varsayılan ayarlarla devam et.
      logWarning('Failed to load settings', err);
    }
  }

  public dispose(): void {
    this._registry?.disposeAll();
    this._registry = undefined;
  }

  /**
   * Yeni bir sohbet açar ve ona geçer.
   *
   * Önemli: çalışan diğer oturumlar **durdurulmaz**. Önceki sohbet (ve varsa
   * alt ajanları) arka planda çalışmaya devam eder; kullanıcı geçmişten geri
   * döndüğünde aynı çekirdeği bulur.
   */
  public async newSession(): Promise<void> {
    if (!this._registry) {
      // Görünüm henüz resolve edilmediyse resolve sırasında uygulanır.
      this._pendingNewSession = true;
      return;
    }
    const core = this._registry.openNewSession();
    const key = this._registry.active;
    if (key) {
      // Sıra önemli (selectSession ile aynı sözleşme): arayüz önce etkin
      // oturumu öğrenmeli, ardından durumunu almalı. Aksi halde yeni oturumun
      // boş durumu "arka plan güncellemesi" sayılır ve pencere eski sohbette
      // kalır — yeni sohbet düğmesi ve geçmişten silme aynı kök nedenden
      // etkileniyordu.
      this.postMessage({ type: 'SESSION_ACTIVATED', payload: { sessionKey: key } });
      this.postMessage({ type: 'TASK_STATE_UPDATE', payload: core.getState(), sessionKey: key });
    }
    this.postMessage({
      type: 'NOTIFICATION',
      payload: { level: 'info', message: 'Yeni bir görev başlatabilirsiniz.' }
    });
  }

  /** Oturum kayıt defterini ve paylaşılan servisleri kurar. */
  private createRegistry(): SessionRegistry {
    this._shared = createSharedServices(this._context, () => this._settings);
    return new SessionRegistry({
      context: this._context,
      settings: () => this._settings,
      shared: this._shared,
      onStateUpdate: (sessionKey, state) => {
        // Arayüz yalnızca etkin oturumun durumunu çizer; arka plan oturumları
        // için gelen güncellemeler yok sayılır (liste ayrıca gönderilir).
        if (sessionKey !== this._registry?.active) return;
        this.postMessage({ type: 'TASK_STATE_UPDATE', payload: state, sessionKey });
      },
      onNotify: (sessionKey, notification) => {
        const active = this._registry?.active;
        const isBackground = Boolean(active) && sessionKey !== active;
        // Arka plan oturumunun bilgi bildirimleri (alt ajan durum güncellemeleri
        // gibi) kullanıcıyı meşgul etmesin; yalnızca uyarı ve hatalar sızar.
        if (isBackground && notification.level === 'info') return;
        this.postMessage({
          type: 'NOTIFICATION',
          payload: {
            level: notification.level,
            message: isBackground ? `Arka plan: ${notification.message}` : notification.message
          },
          sessionKey
        });
      },
      onStreamChunk: (sessionKey, messageId, chunk) => {
        if (sessionKey !== this._registry?.active) return;
        this.postMessage({ type: 'STREAM_CHUNK', payload: { messageId, text: chunk }, sessionKey });
      },
      onSessionsChanged: () => {
        this.postMessage({
          type: 'SESSIONS_CHANGED',
          payload: {
            sessions: (this._registry?.snapshots() ?? []).map((session) => ({
              key: session.key,
              id: session.id,
              prompt: session.prompt,
              status: session.status,
              running: session.running,
              messageCount: session.messageCount
            }))
          }
        });
      }
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri,
        vscode.Uri.joinPath(this._extensionUri, 'dist'),
        vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'dist')
      ]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Oturum kayıt defteri eklentinin ömrü boyunca yaşar. Görünüm yeniden
    // açıldığında çalışan görevler, testler veya akışlar iptal edilmez.
    if (!this._registry) {
      this._registry = this.createRegistry();
      // Son etkin oturum geri yüklenir; yoksa boş bir sohbet açılır.
      this._registry.bootstrap();
      this.warmUpBackgroundIndexes();
    }

    if (this._pendingNewSession) {
      this._pendingNewSession = false;
      void this.newSession();
    }

    webviewView.onDidDispose(() => {
      if (this._view === webviewView) {
        this._view = undefined;
      }
      // Oturumlar arka planda sürer; yalnızca görünüm referansı temizlenir.
    });

    // Webview arayüzünden gelen mesajları işle
    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      try {
        await this.handleWebviewMessage(message);
      } catch (err) {
        logWarning('Failed to process message', err);
        this.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'error', message: errorMessage(err, 'An unexpected error occurred.') }
        });
      }
    });

    // Tema ve yazı tipi yapılandırma güncellemelerini dinle (yalnızca bir kez kaydet).
    if (!this._configListenerRegistered) {
      this._configListenerRegistered = true;
      this._context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
          if (
            e.affectsConfiguration('editor') ||
            e.affectsConfiguration('terminal.integrated') ||
            e.affectsConfiguration('workbench')
          ) {
            this.postMessage({
              type: 'VSCODE_THEME_CHANGED',
              payload: this.getVsCodeThemeConfig()
            });
          }

          if (e.affectsConfiguration('ahiCode')) {
            this.syncSettingsFromConfiguration();
          }
        })
      );
    }

    // Webview hazır olur olmaz ilk ayarları ve mevcut oturum durumunu gönder
    this.postMessage({ type: 'SETTINGS_LOADED', payload: this.getSafeSettingsForWebview() });
    this.postMessage({ type: 'VSCODE_THEME_CHANGED', payload: this.getVsCodeThemeConfig() });
    const activeCore = this._agentCore;
    const activeKey = this._registry?.active;
    if (activeCore && activeKey) {
      this.postMessage({ type: 'TASK_STATE_UPDATE', payload: activeCore.getState(), sessionKey: activeKey });
      this.postMessage({ type: 'SESSION_ACTIVATED', payload: { sessionKey: activeKey } });
    }
  }

  /**
   * Ağır indeksleri arka planda başlatır.
   *
   * Çağrı haritası dil sunucusundan üretilir; tur başlangıcını beklemek yerine
   * eklenti açılır açılmaz arka planda hazırlanır ve bellekte + diskte tutulur.
   * Kullanıcı bir dosyayı kaydettiğinde yalnızca o dosya yeniden taranır.
   *
   * Not: bu iş LLM çağrısı yapmaz. Harita LSP'den çıkarılır; model tabanlı bir
   * "alt ajan" hem pahalı hem de yanlış olurdu (uydurma kenarlar üretirdi).
   */
  private warmUpBackgroundIndexes(): void {
    const core = this._agentCore;
    if (!core) return;

    const workspaceRoot = getActiveWorkspaceRoot();
    if (workspaceRoot) {
      void core.getCallGraphManager().ensureReady(workspaceRoot);
    }

    // Kullanıcı düzenlediği dosyalar da haritaya yansısın (yalnızca ajan
    // yazdığında güncellenmesi haritayı bayat bırakıyordu).
    this._context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        const root = getActiveWorkspaceRoot();
        if (!root || document.uri.scheme !== 'file') return;
        const relative = path.relative(root, document.uri.fsPath).replace(/\\/g, '/');
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
        void core.getCallGraphManager().onFileChanged(root, relative);
      })
    );

    // Silinen dosyaların düğümleri bir sonraki kayıtta temizlenir; hemen
    // temizlemek için tam bir güncelleme tetiklenir.
    this._context.subscriptions.push(
      vscode.workspace.onDidDeleteFiles((event) => {
        const root = getActiveWorkspaceRoot();
        if (!root || event.files.length === 0) return;
        const manager = core.getCallGraphManager();
        const first = event.files[0];
        if (!first) return;
        const relative = path.relative(root, first.fsPath).replace(/\\/g, '/');
        void manager.onFileChanged(root, relative);
      })
    );
  }

  public postMessage(message: ExtensionToWebviewMessage) {
    if (this._view) {
      // postMessage görünüm kapandıktan sonra reddedilebilir; yakalanmamış promise olmasın.
      Promise.resolve(this._view.webview.postMessage(message)).catch(() => {});
    }
  }

  private _messageHandlers?: WebviewMessageHandlerMap;

  /**
   * Mesaj dağıtım tablosu. Her webview mesaj tipi tam olarak bir işleyiciye
   * bağlanır; böylece bağlantı okunabilir kalır ve yeni bir mesaj tipi,
   * işleyicisinin kaydedilmesini zorunlu kılar (harita, union üzerinde
   * kapsamlıdır).
   */
  private get messageHandlers(): WebviewMessageHandlerMap {
    this._messageHandlers ??= this.createMessageHandlers();
    return this._messageHandlers;
  }

  private async handleWebviewMessage(message: WebviewToExtensionMessage) {
    const handler = this.messageHandlers[message.type] as (
      m: WebviewToExtensionMessage
    ) => Promise<void> | void;
    await handler(message);
  }

  private createMessageHandlers(): WebviewMessageHandlerMap {
    return {
      SEND_MESSAGE: async (message) => {
        if (!isChatConfigured(this._settings)) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: {
              level: 'warning',
              message:
                'Sohbeti başlatmak için lütfen önce Ayarlar bölümünden bir model sağlayıcısı yapılandırın.'
            }
          });
          return;
        }
        if (this._agentCore) {
          await this._agentCore.handleSendMessage(message.payload.text, message.payload.mode);
        }
      },

      EDIT_MESSAGE: async (message) => {
        if (this._agentCore) {
          // Düzenleme sırasında mod değiştiyse önce uygulanır; aksi halde
          // webview'ın gönderdiği mod sessizce düşerdi.
          if (message.payload.mode) {
            this._agentCore.setMode(message.payload.mode);
          }
          await this._agentCore.editMessage(message.payload.messageId, message.payload.text);
        }
      },

      USER_REPLY: async (message) => {
        if (this._agentCore) {
          await this._agentCore.provideUserReply(message.payload.reply);
        }
      },

      NEW_SESSION: async () => {
        // Yeni sohbet, çalışan diğer oturumları durdurmaz.
        await this.newSession();
      },

      CANCEL_TASK: async () => {
        if (this._agentCore) {
          await this._agentCore.cancelTask();
        }
      },

      RESUME_TASK: async () => {
        if (this._agentCore) {
          await this._agentCore.resumeTask();
        }
      },

      RETRY_LAST_TURN: async () => {
        if (this._agentCore) {
          await this._agentCore.retryLastTurn();
        }
      },

      APPROVE_TOOL: async (message) => {
        if (this._agentCore) {
          await this._agentCore.approveTool(message.payload.toolCallId);
        }
      },

      APPROVE_SPEC: async () => {
        if (this._agentCore) {
          await this._agentCore.approveSpec();
        }
      },

      APPROVE_PLAN: async () => {
        if (this._agentCore) {
          await this._agentCore.approvePlan();
        }
      },

      REJECT_APPROVAL: async (message) => {
        if (this._agentCore) {
          await this._agentCore.rejectApproval(message.payload?.reason);
        }
      },

      REJECT_TOOL: async (message) => {
        if (this._agentCore) {
          await this._agentCore.rejectTool(message.payload.toolCallId, message.payload.reason);
        }
      },

      SAVE_SETTINGS: async (message) => {
        await this.updateSettings(message.payload);
      },

      REQUEST_SETTINGS: async () => {
        this.postMessage({ type: 'SETTINGS_LOADED', payload: this.getSafeSettingsForWebview() });
        this.postMessage({ type: 'VSCODE_THEME_CHANGED', payload: this.getVsCodeThemeConfig() });
        const active = this._agentCore;
        const sessionKey = this._registry?.active;
        if (active && sessionKey) {
          // İlk TASK_STATE_UPDATE, webview geç yüklenirse kaybolabilir.
          this.postMessage({
            type: 'TASK_STATE_UPDATE',
            payload: active.getState(),
            sessionKey
          });
          this.postMessage({ type: 'SESSION_ACTIVATED', payload: { sessionKey } });
        }
      },

      FETCH_MODELS: async (message) => {
        const provider = message.payload.provider;
        try {
          const models = await fetchModelIds({
            provider,
            apiKey: message.payload.apiKey,
            baseUrl: message.payload.baseUrl,
            storedKeys: this._settings.apiKeys,
            storedOllamaBaseUrl: this._settings.ollamaBaseUrl,
            storedOpenAiCompatibleBaseUrl: this._settings.openAiCompatibleBaseUrl,
            storedCustomBaseUrl: this._settings.customBaseUrl
          });
          this.postMessage({ type: 'MODELS_LOADED', payload: { provider, models } });
        } catch (err) {
          // Hatada model id'leri uydurma: uydurma bir id sonra kafa karıştırıcı
          // bir 404 olur. Boş liste, arayüzdeki serbest metin model alanını korur.
          this.postMessage({
            type: 'MODELS_LOADED',
            payload: { provider, models: [], error: errorMessage(err) }
          });
        }
      },

      FETCH_QUOTA: async () => {
        const provider = this._settings.selectedProvider;
        if (provider !== 'evren') {
          this.postMessage({ type: 'QUOTA_LOADED', payload: { provider } });
          return;
        }
        try {
          const quota = await EvrenModelProvider.fetchQuota(
            this._settings.apiKeys.evren || '',
            this._settings.customBaseUrl || undefined
          );
          this.postMessage({ type: 'QUOTA_LOADED', payload: { provider, quota } });
        } catch (err) {
          // Kota bilgisi yardımcıdır; okunamaması sohbeti engellemez.
          this.postMessage({
            type: 'QUOTA_LOADED',
            payload: { provider, error: errorMessage(err) }
          });
        }
      },

      GET_MCP_STATUS: async () => {
        // Çekirdek henüz yoksa boş listeyle yanıtla: görünüm sonsuza dek
        // "yükleniyor" ekranında kalmasın.
        const servers = this._agentCore ? this._agentCore.getMcpHub().getServerStatuses() : [];
        this.postMessage({ type: 'MCP_STATUS_LOADED', payload: { servers } });
      },

      OPEN_MCP_CONFIG: async () => {
        if (this._agentCore) {
          const workspaceRoot = getActiveWorkspaceRoot();
          await this._agentCore.getMcpHub().openConfigFile(workspaceRoot);
        }
      },

      RESTART_MCP: async () => {
        if (this._agentCore) {
          const workspaceRoot = getActiveWorkspaceRoot();
          // Açıkça kullanıcı tarafından başlatıldı: MCP görünümünden yeniden
          // başlatma tek başına onay sayılır, ilk kullanım proje sunucusu
          // doğrulaması atlanır.
          await this._agentCore.getMcpHub().initialize(workspaceRoot, { userInitiated: true });
          const servers = this._agentCore.getMcpHub().getServerStatuses();
          this.postMessage({ type: 'MCP_STATUS_LOADED', payload: { servers } });
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'info', message: 'MCP sunucuları yeniden tarandı.' }
          });
        }
      },

      SET_MODE: async (message) => {
        if (this._agentCore) {
          this._agentCore.setMode(message.payload.mode);
        }
      },

      GET_TASK_HISTORY: async () => {
        // Çekirdek yoksa boş geçmişle yanıtla; HistoryView yüklemede takılmasın.
        const history = this._agentCore?.getHistoryManager().getSummaries() ?? [];
        this.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history } });
      },

      LOAD_TASK: async (message) => {
        await this.selectSession(message.payload.taskId);
      },

      SELECT_SESSION: async (message) => {
        await this.selectSession(message.payload.sessionId);
      },

      DELETE_TASK: async (message) => {
        const registry = this._registry;
        const history = this._agentCore?.getHistoryManager();
        if (!registry || !history) return;

        const active = this._agentCore;
        const deletingActive = active?.getState().id === message.payload.taskId;

        // Bellekte açık bir çekirdek varsa önce kapat: silinen oturumun
        // arka planda yazmaya devam etmesi kaydı geri getirirdi.
        for (const snapshot of registry.snapshots()) {
          if (snapshot.id !== message.payload.taskId) continue;
          await registry.close(snapshot.key);
        }

        await history.deleteTask(message.payload.taskId);
        if (deletingActive) {
          // Silinen oturum görünüyordu: yeni boş sohbete geç. newSession()
          // SESSION_ACTIVATED + TASK_STATE_UPDATE sırasını korur; çıplak
          // openNewSession() pencereyi eski sohbette bırakırdı.
          await this.newSession();
        }
        this.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history: history.getSummaries() } });
      },

      EXPORT_SESSION: async (message) => {
        await this.exportSession(message.payload.taskId, message.payload.format);
      },

      IMPORT_SESSION: async () => {
        await this.importSession();
      },

      GET_CUSTOMIZATIONS: async () => {
        if (this._agentCore) {
          const workspaceRoot = getActiveWorkspaceRoot();
          await this._agentCore.getSkillManager().loadWorkspaceCustomizations(workspaceRoot);
          this.postMessage({
            type: 'CUSTOMIZATIONS_LOADED',
            payload: await this.buildCustomizationsPayload(workspaceRoot)
          });
        }
      },

      GET_KNOWLEDGE_STATUS: async () => {
        await this.postKnowledgeStatus();
      },

      REINDEX_KNOWLEDGE: async (message) => {
        const workspaceRoot = getActiveWorkspaceRoot();
        const store = this._agentCore?.getKnowledgeStore();
        if (workspaceRoot && store) {
          try {
            await store.indexWorkspace(workspaceRoot, { force: message.payload?.force === true });
            await this.postKnowledgeStatus();
            this.postMessage({
              type: 'NOTIFICATION',
              payload: { level: 'info', message: 'Proje bilgi tabanı oluşturuldu.' }
            });
          } catch (err) {
            await this.postKnowledgeStatus();
            this.postMessage({
              type: 'NOTIFICATION',
              payload: { level: 'error', message: errorMessage(err, 'Bilgi tabanı oluşturulamadı.') }
            });
          }
        } else {
          // Her zaman yanıt ver: bunu yapmayınca düğme sürekli devre dışı kalıyordu.
          await this.postKnowledgeStatus();
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'warning', message: 'Bir çalışma alanı klasörü açın.' }
          });
        }
      },

      CLEAR_KNOWLEDGE: async () => {
        const workspaceRoot = getActiveWorkspaceRoot();
        if (workspaceRoot) {
          await this._agentCore?.getKnowledgeStore().clear(workspaceRoot);
          await this.postKnowledgeStatus();
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'info', message: 'Bilgi tabanı temizlendi.' }
          });
        } else {
          await this.postKnowledgeStatus();
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'warning', message: 'Bir çalışma alanı klasörü açın.' }
          });
        }
      },

      ADD_KNOWLEDGE_NOTE: async (message) => {
        const workspaceRoot = getActiveWorkspaceRoot();
        const note = message.payload.note.trim();
        if (!note) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'warning', message: 'Not boş olamaz.' }
          });
          return;
        }
        if (!workspaceRoot) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'warning', message: 'Bir çalışma alanı klasörü açın.' }
          });
          return;
        }
        await this._agentCore?.getKnowledgeStore().appendNote(workspaceRoot, note);
        await this.postKnowledgeStatus();
        this.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'info', message: 'Not proje hafızasına eklendi.' }
        });
      },

      INIT_AGENTS_TEMPLATE: async () => {
        if (!this._agentCore) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'warning', message: 'Ajan henüz hazır değil; sohbeti açıp tekrar deneyin.' }
          });
          return;
        }
        const workspaceRoot = getActiveWorkspaceRoot();
        if (workspaceRoot) {
          const sm = this._agentCore.getSkillManager();
          await sm.createTemplateStructure(workspaceRoot);
          await sm.loadWorkspaceCustomizations(workspaceRoot);
          this.postMessage({
            type: 'CUSTOMIZATIONS_LOADED',
            payload: await this.buildCustomizationsPayload(workspaceRoot)
          });
          this.postMessage({
            type: 'NOTIFICATION',
            payload: {
              level: 'info',
              message: 'Çalışma alanında AGENTS.md ve .agents/ şablonları oluşturuldu.'
            }
          });
        } else {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'error', message: 'Şablon oluşturmadan önce bir çalışma alanı klasörü açın.' }
          });
          this.postMessage({
            type: 'CUSTOMIZATIONS_LOADED',
            payload: { hasAgentsMd: false, skills: [], agents: [] }
          });
        }
      },

      CLEAR_PROJECT_MEMORY: async () => {
        if (this._agentCore) {
          const workspaceRoot = getActiveWorkspaceRoot();
          const cleared = await this._agentCore.getProjectMemory().clear(workspaceRoot);
          this.postMessage({
            type: 'NOTIFICATION',
            payload: {
              level: cleared ? 'info' : 'warning',
              message: cleared
                ? 'Proje hafızası temizlendi.'
                : 'Proje hafızası temizlenemedi veya zaten boştu.'
            }
          });
          this.postMessage({
            type: 'CUSTOMIZATIONS_LOADED',
            payload: await this.buildCustomizationsPayload(workspaceRoot, false)
          });
        }
      },

      START_SUBAGENT: async (message) => {
        if (!this._agentCore) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'warning', message: 'Ajan henüz hazır değil; sohbeti açıp tekrar deneyin.' }
          });
          return;
        }
        try {
          await this._agentCore.runSubagentFromUi({
            role: message.payload.role,
            task: message.payload.task,
            context: message.payload.context,
            isolate: message.payload.isolate === true
          });
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'info', message: 'Alt ajan tamamlandı; rapor sohbete eklendi.' }
          });
        } catch (err) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'error', message: errorMessage(err, 'Alt ajan çalıştırılamadı.') }
          });
        }
      },

      CUSTOMIZE_BUILTIN_AGENT: async (message) => {
        const workspaceRoot = getActiveWorkspaceRoot();
        if (!workspaceRoot || !this._agentCore) return;
        const role = message.payload?.role;
        const resolvedRole = (ROLE_ALIASES[role.toLowerCase()] || role).toLowerCase();
        const def = getAgentDefinition(resolvedRole);
        if (!def) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'error', message: `'${role}' adında bir yerleşik ajan bulunamadı.` }
          });
          return;
        }

        const sm = this._agentCore.getSkillManager();
        const filePath = await sm.customizeBuiltinAgent(workspaceRoot, def);
        await sm.loadWorkspaceCustomizations(workspaceRoot);

        this.postMessage({
          type: 'CUSTOMIZATIONS_LOADED',
          payload: await this.buildCustomizationsPayload(workspaceRoot)
        });

        await this.openFileInEditor(filePath);
        this.postMessage({
          type: 'NOTIFICATION',
          payload: {
            level: 'info',
            message: `"${def.displayName}" ajanı .agents/agents/${def.name}.md konumuna aktarıldı. Kurallarını ve araçlarını özgürce düzenleyebilirsiniz.`
          }
        });
      },

      RESET_BUILTIN_AGENT: async (message) => {
        const workspaceRoot = getActiveWorkspaceRoot();
        if (!workspaceRoot || !this._agentCore) return;
        const role = message.payload?.role;
        const resolvedRole = (ROLE_ALIASES[role.toLowerCase()] || role).toLowerCase();
        const sm = this._agentCore.getSkillManager();
        await sm.resetBuiltinAgent(workspaceRoot, resolvedRole);
        await sm.loadWorkspaceCustomizations(workspaceRoot);

        this.postMessage({
          type: 'CUSTOMIZATIONS_LOADED',
          payload: await this.buildCustomizationsPayload(workspaceRoot)
        });

        this.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'info', message: 'Ajan varsayılan yerleşik ayarlarına sıfırlandı.' }
        });
      },

      OPEN_AGENTS_FILE: async (message) => {
        if (message.payload?.path) {
          await this.openFileInEditor(message.payload.path);
        }
      },

      OPEN_FILE: async (message) => {
        await this.openFileInEditor(message.payload.filePath);
      },

      GET_GIT_CHANGES: async () => {
        await this.postGitChanges();
      },

      SHOW_COMMIT: async (message) => {
        const workspaceRoot = getActiveWorkspaceRoot();
        const git = this._agentCore?.getGitManager();
        if (!workspaceRoot || !git) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'warning', message: 'Açık bir çalışma alanı yok.' }
          });
          return;
        }
        try {
          const detail = await git.commitDetail(workspaceRoot, message.payload.commitHash);
          const doc = await vscode.workspace.openTextDocument({ content: detail, language: 'diff' });
          await vscode.window.showTextDocument(doc, { preview: true });
        } catch (err) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'error', message: `Commit açılamadı: ${errorMessage(err)}` }
          });
        }
      },

      REWIND_TO_CHECKPOINT: async (message) => {
        if (this._agentCore) {
          await this._agentCore.rewindToCheckpoint(message.payload.checkpointId);
        }
      },

      REVERT_LAST_SNAPSHOT: async () => {
        if (this._agentCore) {
          await this._agentCore.revertLastSnapshot();
        }
      },

      REVERT_TOOL_SNAPSHOT: async (message) => {
        if (this._agentCore) {
          await this._agentCore.revertToolSnapshot(message.payload.toolCallId);
        }
      },

      REVERT_COMMAND: async (message) => {
        if (this._agentCore) {
          await this._agentCore.revertCommandEffects(message.payload.toolCallId);
        }
      },

      SHOW_TOOL_DIFF: async (message) => {
        if (!this._agentCore) return;
        const snapshot = this._agentCore
          .getSnapshotManager()
          .getSnapshotByToolCall(message.payload.toolCallId);
        if (!snapshot) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'warning', message: 'Bu adım için fark anlık görüntüsü bulunamadı.' }
          });
          return;
        }
        try {
          await this.showSnapshotDiff(snapshot.filePath, snapshot.originalContent ?? '');
        } catch (err) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'error', message: `Fark görünümü açılamadı: ${errorMessage(err)}` }
          });
        }
      },

      PREVIEW_TOOL_DIFF: async (message) => {
        if (!this._agentCore) return;
        const pending = this._agentCore.getState().pendingToolCall;
        const targetTool =
          pending && pending.id === message.payload.toolCallId
            ? pending
            : this._agentCore
                .getState()
                .messages.flatMap((m) => m.toolCalls || [])
                .find((tc) => tc.id === message.payload.toolCallId);

        if (!targetTool) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'warning', message: 'Önizlenecek araç adımı bulunamadı.' }
          });
          return;
        }

        const targetPath =
          typeof targetTool.args?.path === 'string'
            ? targetTool.args.path
            : typeof targetTool.args?.filePath === 'string'
              ? targetTool.args.filePath
              : '';

        if (!targetPath) return;

        try {
          const root = getActiveWorkspaceRoot();
          if (targetTool.name === 'write_file') {
            const content = typeof targetTool.args?.content === 'string' ? targetTool.args.content : '';
            await this._agentCore.openDiffPreview(targetPath, content);
          } else if (targetTool.name === 'edit_file') {
            const safePath = root ? resolveWorkspacePath(targetPath, root) : targetPath;
            const current = await fs.promises.readFile(safePath, 'utf-8');
            const targetText =
              typeof targetTool.args?.targetText === 'string' ? targetTool.args.targetText : '';
            const replacementText =
              typeof targetTool.args?.replacementText === 'string' ? targetTool.args.replacementText : '';
            const allowMultiple = Boolean(targetTool.args?.allowMultiple);
            const modified = allowMultiple
              ? current.split(targetText).join(replacementText)
              : current.replace(targetText, () => replacementText);
            await this._agentCore.openDiffPreview(targetPath, modified);
          }
        } catch (err) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'error', message: `Diff önizlemesi açılamadı: ${errorMessage(err)}` }
          });
        }
      },

      SHOW_FILE_DIFF: async (message) => {
        if (!this._agentCore) return;
        // Git benzeri inceleme: dosyanın en eski anlık görüntüsü "önce"
        // tarafı, diskteki güncel dosya "sonra" tarafıdır. Bu, tool call
        // kimliği artık bilinmeyen dosyalarda da çalışır (yüklenen oturumlar,
        // alt ajanlar).
        const snapshot = this._agentCore
          .getSnapshotManager()
          .getSnapshots()
          .filter((item) => item.filePath === message.payload.filePath)
          .sort((a, b) => a.timestamp - b.timestamp)[0];
        if (!snapshot) {
          // Ajan anlık görüntüsü yok (örn. değişiklik bir komuttan veya
          // commit'ten geldi): düğme yine bir şey göstersin diye Git'e düş.
          await this.showGitFileDiff(message.payload.filePath);
          return;
        }
        try {
          await this.showSnapshotDiff(snapshot.filePath, snapshot.originalContent ?? '');
        } catch (err) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'error', message: `Fark görünümü açılamadı: ${errorMessage(err)}` }
          });
        }
      },

      GET_ABOUT_INFO: async () => {
        this.postMessage({
          type: 'ABOUT_INFO_LOADED',
          payload: {
            extensionVersion: String(this._context.extension.packageJSON?.version || '0.0.1'),
            vscodeVersion: vscode.version,
            platform: `${process.platform} (${process.arch})`,
            isTrusted: vscode.workspace.isTrusted,
            workspaceFolders: (vscode.workspace.workspaceFolders || []).map((f) => f.name)
          }
        });
      },

      OPEN_EXTERNAL: async (message) => {
        try {
          const url = new URL(message.payload.url);
          if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'mailto:') {
            throw new Error('Yalnızca http/https/mailto bağlantıları açılabilir.');
          }
          await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
        } catch (err) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'error', message: `Bağlantı açılamadı: ${errorMessage(err)}` }
          });
        }
      }
    };
  }

  /**
   * Webview'den seçilen bir dosyayı metin düzenleyicide açar. Yol, çalışma
   * alanı hapsinden geçer; mutlak yollar da kök dışına çıkamaz.
   */
  private async openFileInEditor(filePath: string): Promise<void> {
    try {
      const workspaceRoot = getActiveWorkspaceRoot();
      const targetPath = resolveWorkspacePath(filePath, workspaceRoot ?? undefined);

      let fileExists = true;
      try {
        await fs.promises.access(targetPath);
      } catch {
        fileExists = false;
      }

      if (!fileExists) {
        const baseName = path.basename(targetPath).toLowerCase();
        if (baseName === 'agents.md' || baseName === '.agents.md' || baseName === 'agent.md') {
          if (workspaceRoot) {
            await this._agentCore?.getSkillManager().createTemplateStructure(workspaceRoot);
          } else {
            const template = `# AhiCode Project Guidelines (AGENTS.md)\n\nThis file defines the core principles that the AhiCode agent must follow.\n`;
            await fs.promises.writeFile(targetPath, template, 'utf-8');
          }
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'info', message: 'Çalışma alanında AGENTS.md oluşturuldu ve açıldı.' }
          });
          if (workspaceRoot) {
            this.postMessage({
              type: 'CUSTOMIZATIONS_LOADED',
              payload: await this.buildCustomizationsPayload(workspaceRoot)
            });
          }
        } else if (baseName === '.ahirules' || baseName === 'ahirules') {
          const rulesTemplate = `# Çalışma Alanı Kuralları (.ahirules)\n# Bu dosyaya projenize özel kodlama ve mimari kurallarını ekleyebilirsiniz.\n`;
          await fs.promises.writeFile(targetPath, rulesTemplate, 'utf-8');
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'info', message: 'Çalışma alanında .ahirules oluşturuldu ve açıldı.' }
          });
        } else {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'warning', message: `Dosya bulunamadı: ${path.basename(targetPath)}` }
          });
          return;
        }
      }

      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      if (doc.isDirty) {
        await doc.save();
      }
      await vscode.window.showTextDocument(doc);
    } catch (err) {
      this.postMessage({
        type: 'NOTIFICATION',
        payload: { level: 'error', message: `Dosya açılamadı: ${errorMessage(err)}` }
      });
    }
  }

  /**
   * Değişiklikler ekranı için canlı Git durumunu toplar ve webview'a yollar.
   * Sorgu mantığı `gitChanges` modülünde; burada yalnızca mesaj gönderilir.
   */
  private async postGitChanges(): Promise<void> {
    const payload = await collectGitChanges(getActiveWorkspaceRoot(), this._agentCore?.getGitManager());
    this.postMessage({ type: 'GIT_CHANGES_LOADED', payload });
  }

  /** Tek dosyanın commit edilmemiş farkını düzenlenebilir diff görünümünde gösterir. */
  private async showGitFileDiff(filePath: string): Promise<void> {
    try {
      const root = getActiveWorkspaceRoot();
      if (!root) throw new Error('Çalışma alanı kökü bulunamadı.');
      const fullPath = resolveWorkspacePath(filePath, root);
      const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

      let headContent = '';
      try {
        const gm = this._agentCore?.getGitManager();
        if (gm) {
          headContent = await gm.getFileHeadContent(root, relPath);
        }
      } catch {
        headContent = '';
      }

      const originalUri = vscode.Uri.from({
        scheme: AhiCodeDiffContentProvider.scheme,
        path: '/' + relPath,
        query: `git-head=${Date.now()}`
      });
      this._diffProvider.setDocumentContent(originalUri, headContent);

      // Sanal belgenin söz dizimi renklendirmesini (Syntax Highlighting) garantiye al
      try {
        const langId = getLanguageIdForFile(relPath);
        const virtualDoc = await vscode.workspace.openTextDocument(originalUri);
        if (virtualDoc.languageId !== langId) {
          await vscode.languages.setTextDocumentLanguage(virtualDoc, langId);
        }
      } catch {
        // Renklendirme başarısız olsa da diff açılır
      }

      const fileUri = vscode.Uri.file(fullPath);
      await vscode.commands.executeCommand(
        'vscode.diff',
        originalUri,
        fileUri,
        `${path.basename(filePath)} (HEAD ↔ Çalışma Kopyası [Düzenlenebilir])`
      );
    } catch (err) {
      this.postMessage({
        type: 'NOTIFICATION',
        payload: { level: 'warning', message: `Fark görünümü açılamadı: ${errorMessage(err)}` }
      });
    }
  }

  /**
   * Kayıtlı bir oturumu kullanıcının seçtiği dosyaya dışa aktarır.
   */
  private async exportSession(taskId: string, format: 'json' | 'markdown'): Promise<void> {
    if (!this._agentCore) return;

    const content = this._agentCore.getHistoryManager().exportSession(taskId, format);
    if (content === undefined) {
      this.postMessage({
        type: 'NOTIFICATION',
        payload: { level: 'error', message: 'Dışa aktarılacak oturum bulunamadı.' }
      });
      return;
    }

    const task = this._agentCore.getHistoryManager().getTask(taskId);
    const slug =
      (task?.prompt || taskId)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'oturum';
    const extension = format === 'markdown' ? 'md' : 'json';

    const workspaceRoot = getActiveWorkspaceRoot();
    const target = await vscode.window.showSaveDialog({
      saveLabel: 'Dışa aktar',
      ...(workspaceRoot
        ? { defaultUri: vscode.Uri.file(path.join(workspaceRoot, `${slug}.${extension}`)) }
        : {}),
      filters: format === 'markdown' ? { Markdown: ['md'] } : { 'AhiCode oturum': ['json'] }
    });

    if (!target) return; // Kullanıcı vazgeçti.

    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf-8'));
    this.postMessage({
      type: 'NOTIFICATION',
      payload: {
        level: 'info',
        message: `Oturum ${format === 'markdown' ? 'Markdown' : 'JSON'} olarak dışa aktarıldı: ${path.basename(target.fsPath)}`
      }
    });
  }

  /**
   * Bir oturum arşivini içe aktarır ve ona geçer.
   */
  private async importSession(): Promise<void> {
    if (!this._agentCore) return;

    const selection = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'İçe aktar',
      filters: {
        'AhiCode oturum': ['json'],
        'Tüm dosyalar': ['*']
      }
    });
    const file = selection?.[0];
    if (!file) return;

    try {
      const raw = Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf-8');
      const { task } = await this._agentCore.getHistoryManager().importSession(raw);

      const history = this._agentCore.getHistoryManager().getSummaries();
      this.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history } });
      await this._agentCore.loadSession(task.id);
      this.postMessage({
        type: 'NOTIFICATION',
        payload: { level: 'info', message: 'Oturum içe aktarıldı ve yüklendi.' }
      });
    } catch (err) {
      this.postMessage({
        type: 'NOTIFICATION',
        payload: { level: 'error', message: errorMessage(err, 'Oturum içe aktarılamadı.') }
      });
    }
  }

  /**
   * Bilgi tabanı durumunu ve insan tarafından okunabilir bilgi dosyalarını
   * arayüze gönderir.
   */
  private async postKnowledgeStatus(): Promise<void> {
    const store = this._agentCore?.getKnowledgeStore();
    const workspaceRoot = getActiveWorkspaceRoot();
    if (!store || !workspaceRoot) {
      this.postMessage({
        type: 'KNOWLEDGE_STATUS_LOADED',
        payload: {
          ready: false,
          fileCount: 0,
          symbolCount: 0,
          summarizedCount: 0,
          notes: '',
          project: '',
          conventions: '',
          decisions: '',
          modules: []
        }
      });
      return;
    }

    await store.ensureFresh(workspaceRoot);
    const status = store.getStatus();
    this.postMessage({
      type: 'KNOWLEDGE_STATUS_LOADED',
      payload: {
        ...status,
        notes: await store.getHumanFile('notes'),
        project: await store.getHumanFile('project'),
        conventions: await store.getHumanFile('conventions'),
        decisions: await store.getHumanFile('decisions'),
        modules: store.getSummarizedFiles().map((file) => ({
          path: file.path,
          summary: file.summary || ''
        }))
      }
    });
  }

  /**
   * Ajanlar/Yetenekler görünümü için tek bir tutarlı veri yükü kurar.
   */
  private async buildCustomizationsPayload(
    workspaceRoot: string | undefined,
    reload = true
  ): Promise<WorkspaceCustomizations> {
    if (!this._agentCore) {
      return { hasAgentsMd: false, skills: [], agents: [], memoryEntryCount: 0 };
    }

    const sm = this._agentCore.getSkillManager();
    if (reload) {
      await sm.loadWorkspaceCustomizations(workspaceRoot);
    }
    const memory = await this._agentCore.getProjectMemory().load(workspaceRoot);

    return {
      hasAgentsMd: Boolean(sm.getAgentsMd()),
      agentsMdPath: sm.getAgentsMdPath(),
      agentsMdContent: sm.getAgentsMd(),
      skills: sm.getSkills().map((s) => ({ name: s.name, description: s.description, path: s.path })),
      agents: sm.getCustomAgents().map((a) => ({
        name: a.name,
        role: a.role,
        description: a.description,
        path: a.path,
        tools: a.allowedTools
      })),
      memoryPath: memory.path,
      memoryContent: memory.content,
      memoryEntryCount: memory.entryCount
    };
  }

  private async showSnapshotDiff(filePath: string, originalContent: string) {
    const root = getActiveWorkspaceRoot();
    const fullPath = root ? resolveWorkspacePath(filePath, root) : filePath;
    const fileUri = vscode.Uri.file(fullPath);

    const originalUri = vscode.Uri.from({
      scheme: AhiCodeDiffContentProvider.scheme,
      path: '/' + filePath,
      query: `snapshot=${Date.now()}`
    });
    this._diffProvider.setDocumentContent(originalUri, originalContent);

    // Sanal belgenin söz dizimi renklendirmesini (Syntax Highlighting) garantiye al
    try {
      const langId = getLanguageIdForFile(filePath);
      const virtualDoc = await vscode.workspace.openTextDocument(originalUri);
      if (virtualDoc.languageId !== langId) {
        await vscode.languages.setTextDocumentLanguage(virtualDoc, langId);
      }
    } catch {
      // Renklendirme başarısız olsa da diff açılır
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      fileUri,
      `${path.basename(filePath)} (Önceki ↔ Güncel [Düzenlenebilir])`
    );
  }

  /**
   * VS Code ayarları (ahiCode.*) değiştiğinde ajanı ve arayüzü günceller.
   * Yalnızca açıkça yapılandırılmış değerler uygulanır; dokunulmayan ayarlar
   * oturumun zaten sahip olduğu değeri korur.
   */
  private syncSettingsFromConfiguration() {
    const config = vscode.workspace.getConfiguration('ahiCode');
    const next = mergeExplicitConfiguration(this._settings, config);
    if (!settingsDiffer(next, this._settings)) return;

    this._settings = next;
    this._agentCore?.updateSettings(this._settings);
    this.postMessage({ type: 'SETTINGS_LOADED', payload: this.getSafeSettingsForWebview() });
  }

  private async updateSettings(newSettings: Partial<UserSettings>) {
    this._settings = await persistSettings(this._context, this._settings, newSettings);
    // Ayar tüm açık oturumlara uygulanır; arka planda çalışan bir tur yeni
    // ayarı bir sonraki isteğinde görür.
    this._registry?.updateSettings(this._settings);
    this.postMessage({ type: 'SETTINGS_LOADED', payload: this.getSafeSettingsForWebview() });
  }

  /**
   * Başka bir sohbeti etkin yapar.
   *
   * Oturum bellekte çalışıyorsa aynı çekirdek kullanılır; arka plandaki tur ve
   * alt ajanlar kesintisiz sürer. Aksi halde geçmişten yüklenir.
   */
  private async selectSession(sessionId: string): Promise<void> {
    const registry = this._registry;
    if (!registry) return;

    const core = registry.activate(sessionId);
    if (!core) {
      this.postMessage({
        type: 'NOTIFICATION',
        payload: { level: 'error', message: 'Önceki oturum bulunamadı veya silinmiş.' }
      });
      return;
    }

    const key = registry.active;
    if (!key) return;
    // Sıra önemli: arayüz önce hangi oturumun etkin olduğunu öğrenmeli,
    // ardından o oturumun durumunu almalı.
    this.postMessage({ type: 'SESSION_ACTIVATED', payload: { sessionKey: key } });
    this.postMessage({ type: 'TASK_STATE_UPDATE', payload: core.getState(), sessionKey: key });
  }

  private getSafeSettingsForWebview(): UserSettings {
    return safeSettingsForWebview(this._settings);
  }

  private getVsCodeThemeConfig(): VsCodeThemeConfig {
    return readThemeConfig();
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    return buildWebviewHtml({
      distDir: path.join(this._extensionUri.fsPath, 'webview-ui', 'dist'),
      cspSource: webview.cspSource,
      toWebviewUri: (relativeAssetPath) =>
        webview
          .asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'dist', relativeAssetPath))
          .toString(),
      theme: this.getVsCodeThemeConfig()
    });
  }
}
