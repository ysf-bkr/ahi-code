import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  ExtensionToWebviewMessage,
  TaskState,
  UserSettings,
  WebviewToExtensionMessage,
  VsCodeThemeConfig,
  WorkspaceCustomizations
} from '../shared/types';
import { AgentCore } from '../core/agent/AgentCore';
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
import { collectGitChanges, readGitFileDiff } from './gitChanges';
import { ROLE_ALIASES, getAgentDefinition } from '../shared/agents';

type WebviewMessageHandlerMap = {
  [K in WebviewToExtensionMessage['type']]: (
    message: Extract<WebviewToExtensionMessage, { type: K }>
  ) => Promise<void> | void;
};

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ahi-code.SidebarProvider';

  private _view?: vscode.WebviewView;
  private _agentCore?: AgentCore;
  private _settings: UserSettings;
  private _configListenerRegistered = false;
  private _pendingNewSession = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._settings = loadDefaultSettings();
  }

  /**
   * Load settings and SecretStorage keys before the webview opens.
   * Called by activate() because constructors cannot be awaited.
   */
  public async initialize(): Promise<void> {
    try {
      this._settings = await restoreSettings(this._context, this._settings);
    } catch (err) {
      // Continue with default settings if SecretStorage cannot be read.
      logWarning('Failed to load settings', err);
    }
  }

  public dispose(): void {
    this._agentCore?.dispose();
    this._agentCore = undefined;
  }

  public async newSession(): Promise<void> {
    if (this._agentCore) {
      await this._agentCore.createNewSession();
    } else {
      // Applied during resolve if the view has not been resolved yet.
      this._pendingNewSession = true;
    }
    this.postMessage({
      type: 'NOTIFICATION',
      payload: { level: 'info', message: 'Yeni bir görev başlatabilirsiniz.' }
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

    // AgentCore lives for the extension lifetime. Do not cancel running
    // tasks, tests, or streams when the view is reopened.
    if (!this._agentCore) {
      this._agentCore = new AgentCore(
        this._context,
        this._settings,
        (state: TaskState) => this.postMessage({ type: 'TASK_STATE_UPDATE', payload: state }),
        (notification) => this.postMessage({ type: 'NOTIFICATION', payload: notification }),
        (messageId, chunk) => this.postMessage({ type: 'STREAM_CHUNK', payload: { messageId, text: chunk } })
      );

      // Çağrı haritasını arka planda hazırla ve dosya değişimlerinde güncel tut.
      this.warmUpBackgroundIndexes();
    }

    if (this._pendingNewSession) {
      this._pendingNewSession = false;
      void this._agentCore.createNewSession();
    }

    webviewView.onDidDispose(() => {
      if (this._view === webviewView) {
        this._view = undefined;
      }
      // The agent task continues in the background; only clear the view reference.
    });

    // Handle messages from the Webview UI
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

    // Listen for theme and font configuration updates (register only once).
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

    // Send initial settings and current session state once webview is ready
    this.postMessage({ type: 'SETTINGS_LOADED', payload: this.getSafeSettingsForWebview() });
    this.postMessage({ type: 'VSCODE_THEME_CHANGED', payload: this.getVsCodeThemeConfig() });
    if (this._agentCore) {
      this.postMessage({ type: 'TASK_STATE_UPDATE', payload: this._agentCore.getState() });
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
      // postMessage may reject after the view closes; avoid an unhandled promise.
      Promise.resolve(this._view.webview.postMessage(message)).catch(() => {});
    }
  }

  private _messageHandlers?: WebviewMessageHandlerMap;

  /**
   * Message dispatch table. Each webview message type maps to exactly one
   * handler, so the wiring stays readable and a new message type forces its
   * handler to be registered (the map is exhaustive over the union).
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
        if (this._agentCore) {
          await this._agentCore.handleSendMessage(message.payload.text, message.payload.mode);
        }
      },

      USER_REPLY: async (message) => {
        if (this._agentCore) {
          await this._agentCore.provideUserReply(message.payload.reply);
        }
      },

      NEW_SESSION: async () => {
        if (this._agentCore) {
          await this._agentCore.createNewSession();
        }
      },

      CANCEL_TASK: async () => {
        if (this._agentCore) {
          await this._agentCore.cancelTask();
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

      SET_WORKFLOW_STAGE: async (message) => {
        if (this._agentCore) {
          const result = await this._agentCore.setWorkflowStage(message.payload.stage);
          if (!result.ok) {
            this.postMessage({
              type: 'NOTIFICATION',
              payload: { level: 'warning', message: result.reason || 'Aşama değiştirilemedi.' }
            });
          }
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
        if (this._agentCore) {
          // The first TASK_STATE_UPDATE may be lost if the webview loads late.
          this.postMessage({ type: 'TASK_STATE_UPDATE', payload: this._agentCore.getState() });
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
          // Do not invent model ids on failure: a made-up id becomes a confusing
          // 404 later. An empty list keeps the free-text model field in the UI.
          this.postMessage({
            type: 'MODELS_LOADED',
            payload: { provider, models: [], error: errorMessage(err) }
          });
        }
      },

      GET_MCP_STATUS: async () => {
        if (this._agentCore) {
          const servers = this._agentCore.getMcpHub().getServerStatuses();
          this.postMessage({ type: 'MCP_STATUS_LOADED', payload: { servers } });
        }
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
          // Explicitly user-initiated: restarting from the MCP view is consent
          // itself, so the first-use project-server confirmation is skipped.
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
        if (this._agentCore) {
          const history = this._agentCore.getHistoryManager().getSummaries();
          this.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history } });
        }
      },

      LOAD_TASK: async (message) => {
        if (this._agentCore) {
          await this._agentCore.loadSession(message.payload.taskId);
        }
      },

      DELETE_TASK: async (message) => {
        if (this._agentCore) {
          const deletingActive = this._agentCore.getState().id === message.payload.taskId;
          await this._agentCore.getHistoryManager().deleteTask(message.payload.taskId);
          if (deletingActive) {
            await this._agentCore.createNewSession();
          }
          const history = this._agentCore.getHistoryManager().getSummaries();
          this.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history } });
        }
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
          // Always answer: the button stayed disabled forever without this.
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
          const root = getActiveWorkspaceRoot();
          const fullPath = root ? resolveWorkspacePath(snapshot.filePath, root) : snapshot.filePath;
          const current = await fs.promises.readFile(fullPath, 'utf-8');
          await this.showSnapshotDiff(snapshot.filePath, snapshot.originalContent ?? '', current);
        } catch (err) {
          this.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'error', message: `Fark görünümü açılamadı: ${errorMessage(err)}` }
          });
        }
      },

      SHOW_FILE_DIFF: async (message) => {
        if (!this._agentCore) return;
        // Git-like review: the oldest snapshot of the file is the "before" side,
        // the current file on disk is the "after" side. This also works for files
        // whose tool call id is no longer known (loaded sessions, subagents).
        const snapshot = this._agentCore
          .getSnapshotManager()
          .getSnapshots()
          .filter((item) => item.filePath === message.payload.filePath)
          .sort((a, b) => a.timestamp - b.timestamp)[0];
        if (!snapshot) {
          // No agent snapshot exists (e.g. the change came from a command or a
          // commit): fall back to Git so the button still shows something.
          await this.showGitFileDiff(message.payload.filePath);
          return;
        }
        try {
          const root = getActiveWorkspaceRoot();
          const fullPath = root ? resolveWorkspacePath(snapshot.filePath, root) : snapshot.filePath;
          const current = await fs.promises.readFile(fullPath, 'utf-8');
          await this.showSnapshotDiff(snapshot.filePath, snapshot.originalContent ?? '', current);
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
   * Opens a file from the webview in the text editor. Relative paths are
   * resolved against the active workspace root.
   */
  private async openFileInEditor(filePath: string): Promise<void> {
    try {
      let targetPath = filePath;
      if (!path.isAbsolute(targetPath)) {
        const workspaceRoot = getActiveWorkspaceRoot();
        if (!workspaceRoot) {
          throw new Error('Açık bir çalışma alanı yok.');
        }
        targetPath = path.join(workspaceRoot, targetPath);
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
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

  /** Tek dosyanın commit edilmemiş farkını diff belgesinde gösterir. */
  private async showGitFileDiff(filePath: string): Promise<void> {
    try {
      const diff = await readGitFileDiff(
        getActiveWorkspaceRoot(),
        this._agentCore?.getGitManager(),
        filePath
      );
      const doc = await vscode.workspace.openTextDocument({ content: diff, language: 'diff' });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err) {
      this.postMessage({
        type: 'NOTIFICATION',
        payload: { level: 'warning', message: errorMessage(err) }
      });
    }
  }

  /**
   * Exports a stored session to a file the user picks.
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

    if (!target) return; // User cancelled.

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
   * Imports a session archive and switches to it.
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
   * Posts knowledge base status and human-readable knowledge files to the UI.
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
   * Build one consistent data payload for the Agents/Skills view.
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

  private async showSnapshotDiff(filePath: string, originalContent: string, newContent: string) {
    const language = path.extname(filePath).replace('.', '') || 'plaintext';
    const original = await vscode.workspace.openTextDocument({
      content: originalContent,
      language
    });
    const modified = await vscode.workspace.openTextDocument({
      content: newContent,
      language
    });
    await vscode.commands.executeCommand(
      'vscode.diff',
      original.uri,
      modified.uri,
      `${path.basename(filePath)} (Before / After)`
    );
  }

  /**
   * Update the agent and UI when VS Code settings (ahiCode.*) change.
   * Only explicitly configured values are applied; untouched settings keep the
   * value the session already has.
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
    if (this._agentCore) {
      this._agentCore.updateSettings(this._settings);
    }
    this.postMessage({ type: 'SETTINGS_LOADED', payload: this.getSafeSettingsForWebview() });
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
