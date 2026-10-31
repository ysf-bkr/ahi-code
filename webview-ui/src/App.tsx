import React, { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { TaskHeader } from './components/TaskHeader';
import { MessageList } from './components/MessageList';
import { ChatInput } from './components/ChatInput';
import { ChatMetaBar } from './components/ChatMetaBar';
import { ChatStatusBar } from './components/ChatStatusBar';
import { ComposerDock } from './components/ComposerDock';
import { PendingActionNotice } from './components/PendingActionNotice';
import { SettingsView } from './components/SettingsView';
import { HistoryView } from './components/HistoryView';
import { McpView } from './components/McpView';
import { CallGraphView } from './components/CallGraphView';
import { AgentsView } from './components/AgentsView';
import { AboutView } from './components/AboutView';
import { ChangesView } from './components/ChangesView';
import { NavigationSidebar } from './components/NavigationSidebar';
import { Toast as ToastView } from './components/Toast';
import { Button } from './components/ui';
import {
  AgentMode,
  AutonomyLevel,
  ExtensionToWebviewMessage,
  EvrenQuota,
  NavigationDestination,
  SessionInfoLoaded,
  TaskState,
  ToastNotification,
  UserSettings
} from '@shared/types';
import { DEFAULT_TASK_STATE, DEFAULT_USER_SETTINGS, isChatConfigured } from '@shared/constants';
import { vscode } from './utils/vscode';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationDestination>('chat');
  /**
   * Etkin oturum anahtarının anlık kopyası. Mesaj işleyicisi render dışında
   * çalıştığı için state yerine ref okunur; yoksa eski değer görülür.
   */
  const activeSessionRef = useRef<string | undefined>(undefined);
  // Akış tamponu: her token tüm mesaj listesini yeniden çizdirip uzun yanıtlarda
  // arayüzü kilitliyordu; parçalar birikir ve ~50 ms'de bir tek seferde çizilir.
  // Tam durum güncellemesi metni zaten eksiksiz taşıdığı için tampon düşürülür.
  const streamBuffer = useRef(new Map<string, string>());
  const streamFlushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushStreamBuffer = () => {
    if (streamFlushTimer.current) {
      clearTimeout(streamFlushTimer.current);
      streamFlushTimer.current = undefined;
    }
    streamBuffer.current.clear();
  };
  // Basit gezinme yığını: "Geri" her zaman sohbete değil, kullanıcının geldiği
  // ekrana dönsün (örn. Ayarlar -> Hakkında -> Geri -> Ayarlar).
  const [viewStack, setViewStack] = useState<NavigationDestination[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toast, setToast] = useState<ToastNotification | null>(null);

  const openView = (tab: NavigationDestination) => {
    if (tab === activeTab) return;
    setViewStack([...viewStack, activeTab]);
    setActiveTab(tab);
  };

  const goBack = () => {
    const previous =
      viewStack.length > 0 ? (viewStack[viewStack.length - 1] as NavigationDestination) : 'chat';
    setViewStack(viewStack.slice(0, -1));
    setActiveTab(previous);
  };

  const goToChat = () => {
    setViewStack([]);
    setActiveTab('chat');
  };

  const [taskState, setTaskState] = useState<TaskState>(DEFAULT_TASK_STATE);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);

  const [draftPrompt, setDraftPrompt] = useState('');
  // Her "mesajı düzenle" eyleminde artırılır; aynı mesaj üst üste iki kez
  // düzenlense bile besteci yeniden kurulup metni alsın.
  const [draftNonce, setDraftNonce] = useState(0);
  /**
   * Düzenlenen kullanıcı mesajının kimliği. Yalnızca o mesaj hâlâ geçmişte
   * duruyorsa etkindir; yeni sohbet başlayınca kendiliğinden düşer.
   */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  /** Sohbet altındaki model seçici için sağlayıcı model listesi. */
  const [models, setModels] = useState<string[]>([]);
  /** EVREN günlük kota bilgisi; diğer sağlayıcılarda boş kalır. */
  const [quota, setQuota] = useState<EvrenQuota | undefined>(undefined);
  const [quotaError, setQuotaError] = useState<string | undefined>(undefined);
  const [loadingQuota, setLoadingQuota] = useState(false);
  /** Arayüzün çizdiği oturumun anahtarı; arka plan oturumları yok sayılır. */
  const [activeSessionKey, setActiveSessionKey] = useState<string | undefined>(undefined);
  /** Bellekteki oturumlar (arka planda çalışanlar dahil). */
  const [sessions, setSessions] = useState<SessionInfoLoaded[]>([]);

  useEffect(() => {
    vscode.postMessage({ type: 'REQUEST_SETTINGS' });

    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'TASK_STATE_UPDATE':
          // Arka plan oturumunun durumu gelirse yok say: görünen sohbet
          // kullanıcının seçtiği oturumdur.
          if (msg.sessionKey && activeSessionRef.current && msg.sessionKey !== activeSessionRef.current) {
            break;
          }
          if (msg.sessionKey && !activeSessionRef.current) {
            activeSessionRef.current = msg.sessionKey;
            setActiveSessionKey(msg.sessionKey);
          }
          // Tam durum metnin güncel hâlini taşır; bekleyen parçalar çizilirse
          // aynı metin iki kez eklenir.
          flushStreamBuffer();
          setTaskState(msg.payload);
          break;
        case 'SESSION_ACTIVATED':
          activeSessionRef.current = msg.payload.sessionKey;
          setActiveSessionKey(msg.payload.sessionKey);
          flushStreamBuffer();
          // Oturum değişti: yarım kalan düzenleme ve besteci taslağı o sohbete
          // ait değil. `draftNonce` artırılarak besteci yeniden kurulur.
          setEditingMessageId(null);
          setDraftPrompt('');
          setDraftNonce((value) => value + 1);
          break;
        case 'SESSIONS_CHANGED':
          setSessions(msg.payload.sessions);
          break;
        case 'SETTINGS_LOADED':
          setSettings(msg.payload);
          break;
        case 'MODELS_LOADED':
          setModels(msg.payload.models ?? []);
          break;
        case 'QUOTA_LOADED':
          setLoadingQuota(false);
          setQuota(msg.payload.quota);
          setQuotaError(msg.payload.error);
          break;
        case 'STREAM_CHUNK': {
          if (msg.sessionKey && msg.sessionKey !== activeSessionRef.current) break;
          const { messageId, text } = msg.payload;
          streamBuffer.current.set(messageId, (streamBuffer.current.get(messageId) ?? '') + text);
          if (!streamFlushTimer.current) {
            streamFlushTimer.current = setTimeout(() => {
              streamFlushTimer.current = undefined;
              const buffer = streamBuffer.current;
              streamBuffer.current = new Map();
              if (buffer.size === 0) return;
              setTaskState((prev) => ({
                ...prev,
                messages: prev.messages.map((m) => {
                  const pending = buffer.get(m.id);
                  return pending ? { ...m, content: m.content + pending } : m;
                })
              }));
            }, 50);
          }
          break;
        }
        case 'VSCODE_THEME_CHANGED': {
          const cfg = msg.payload;
          const root = document.documentElement;
          if (cfg.editorFontFamily) {
            root.style.setProperty(
              '--vscode-user-editor-font-family',
              `${cfg.editorFontFamily}, var(--vscode-editor-font-family, monospace)`
            );
          }
          if (cfg.editorFontSize) {
            root.style.setProperty('--vscode-user-editor-font-size', `${cfg.editorFontSize}px`);
          }
          if (cfg.editorFontWeight) {
            root.style.setProperty('--vscode-user-editor-font-weight', cfg.editorFontWeight);
          }
          if (cfg.terminalFontFamily) {
            root.style.setProperty(
              '--vscode-user-terminal-font-family',
              `${cfg.terminalFontFamily}, var(--vscode-user-editor-font-family, monospace)`
            );
          }
          if (cfg.terminalFontSize) {
            root.style.setProperty('--vscode-user-terminal-font-size', `${cfg.terminalFontSize}px`);
          }
          break;
        }
        case 'NOTIFICATION': {
          const newToast: ToastNotification = {
            id: String(Date.now() + Math.random()),
            level: msg.payload.level,
            message: msg.payload.message
          };
          setToast(newToast);
          setTimeout(() => {
            setToast((curr) => (curr?.id === newToast.id ? null : curr));
          }, 4500);
          break;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (streamFlushTimer.current) clearTimeout(streamFlushTimer.current);
    };
  }, []);

  /**
   * Model listesi ve EVREN kotası sağlayıcı değişince yenilenir.
   * Kota okunamazsa sohbet çalışmaya devam eder; yalnızca çubukta not görünür.
   */
  const refreshQuota = () => {
    if (settings.selectedProvider !== 'evren') {
      setQuota(undefined);
      setQuotaError(undefined);
      return;
    }
    setLoadingQuota(true);
    vscode.postMessage({ type: 'FETCH_QUOTA' });
  };

  useEffect(() => {
    vscode.postMessage({
      type: 'FETCH_MODELS',
      payload: { provider: settings.selectedProvider }
    });
    setLoadingQuota(true);
    vscode.postMessage({ type: 'FETCH_QUOTA' });
  }, [settings.selectedProvider]);

  // Uzun oturumlarda kota bayatlamasın: dakikada bir sessizce yenile.
  useEffect(() => {
    if (settings.selectedProvider !== 'evren') return;
    const timer = setInterval(() => vscode.postMessage({ type: 'FETCH_QUOTA' }), 60_000);
    return () => clearInterval(timer);
  }, [settings.selectedProvider]);

  // Her tur bittiğinde harcanan tokenlar kotaya yansısın.
  useEffect(() => {
    if (settings.selectedProvider !== 'evren') return;
    if (
      taskState.status === 'completed' ||
      taskState.status === 'failed' ||
      taskState.status === 'cancelled'
    ) {
      vscode.postMessage({ type: 'FETCH_QUOTA' });
    }
  }, [taskState.status, settings.selectedProvider]);

  const handleModelChange = (model: string) => {
    setSettings((prev) => ({ ...prev, selectedModel: model }));
    vscode.postMessage({ type: 'SAVE_SETTINGS', payload: { selectedModel: model } });
  };

  /**
   * Sürekli sohbet: Gönderilen tüm mesajlar mevcut oturumda kalır!
   *
   * Düzenleme modundaysa yeni bir kullanıcı balonu eklenmez; seçilen mesajdan
   * sonraki tur atılıp istem yerinde yeniden çalıştırılır.
   */
  const handleSendMessage = (text: string) => {
    const editingId =
      editingMessageId && taskState.messages.some((message) => message.id === editingMessageId)
        ? editingMessageId
        : null;

    vscode.postMessage(
      editingId
        ? { type: 'EDIT_MESSAGE', payload: { text, messageId: editingId, mode: taskState.mode } }
        : { type: 'SEND_MESSAGE', payload: { text, mode: taskState.mode } }
    );
    setEditingMessageId(null);
    setDraftPrompt('');
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setDraftPrompt('');
  };

  /** Etkin olmayan, çalışmaya devam eden sohbetler. */
  const backgroundSessions = sessions.filter(
    (session) => session.running && session.key !== activeSessionKey
  );

  /** Başka bir sohbeti öne alır; arka plandaki çalışma durmaz. */
  const switchToSession = (sessionId: string) => {
    vscode.postMessage({ type: 'SELECT_SESSION', payload: { sessionId } });
    goToChat();
  };

  const handleModeChange = (mode: AgentMode) => {
    setTaskState((prev) => ({ ...prev, mode }));
    vscode.postMessage({ type: 'SET_MODE', payload: { mode } });
  };

  /** Sohbetteki otonomi seçici: anında yansıtılır, ayar olarak kalıcılaşır. */
  const handleAutonomyChange = (level: AutonomyLevel) => {
    setSettings((prev) => ({ ...prev, autonomy: level }));
    vscode.postMessage({ type: 'SAVE_SETTINGS', payload: { autonomy: level } });
  };

  const handleSuggestionClick = (prompt: string) => {
    setEditingMessageId(null);
    setDraftPrompt(prompt);
    setDraftNonce((value) => value + 1);
  };

  /**
   * Gönderilmiş bir mesajı düzenlemek için besteciye koyar ve hangi mesajın
   * düzenlendiğini hatırlar; gönderim yeni mesaj eklemek yerine o turu yeniler.
   */
  const handleEditMessage = (content: string, messageId: string) => {
    setEditingMessageId(messageId);
    setDraftPrompt(content);
    setDraftNonce((value) => value + 1);
  };

  /**
   * Hatalı turu aynı sohbette yeniden çalıştırır: besteciye uğramadan aynı
   * istem EDIT_MESSAGE ile gönderilir; sunucu o turu yerden silip yeniden
   * yürütür. Kullanıcı yeni sohbet açmak zorunda kalmaz.
   */
  const handleRetryMessage = (content: string, messageId: string) => {
    setEditingMessageId(null);
    vscode.postMessage({ type: 'EDIT_MESSAGE', payload: { messageId, text: content, mode: taskState.mode } });
  };

  return (
    <div className="ahi-app">
      {/* Sabit Header — Sohbet ekranındayken TaskHeader; diğer ekranlar kendi ScreenHeader'ını tepe başlığı olarak kullanır */}
      {activeTab === 'chat' && (
        <TaskHeader
          state={taskState}
          changedFileCount={taskState.stats.filesModified.length}
          onSelectMenu={openView}
        />
      )}

      {/* Ana Çalışma Alanı + Sabit Yan Menü */}
      <div className="ahi-app__body">
        <main className="ahi-main">
          {/* Sohbet ekranı her zaman DOM'da canlı tutulur; böylece sekmeler arası geçişte
              arka plan işlemleri, veri akışı ve yazılan taslak metinler asla kaybolmaz. */}
          <div className={`flex h-full min-h-0 w-full flex-col ${activeTab === 'chat' ? '' : 'hidden'}`}>
            <MessageList
              messages={taskState.messages}
              pendingToolCall={taskState.pendingToolCall}
              checkpoints={taskState.checkpoints}
              onEditMessage={handleEditMessage}
              onRetryMessage={handleRetryMessage}
              onSuggestionClick={handleSuggestionClick}
              isConfigured={isChatConfigured(settings)}
              onOpenSettings={() => openView('settings')}
            />
            <div className="shrink-0 w-full border-t ahi-border-base ahi-bg-base">
              {/* Bildirim akış içinde durur: bestecinin üstünde uçan mutlak
                  konum eskiden canlı plan/görev çubuğunu (ComposerDock)
                  kapatıyordu. Şimdi plan barının hemen üstünde yer kaplar,
                  hiçbir şeyi örtmez. */}
              {toast && (
                <div className="px-3 pt-2">
                  <ToastView toast={toast} onDismiss={() => setToast(null)} />
                </div>
              )}
              {/* Araç onayı ve sorular mesaj yazma alanının hemen üstünde sabit
                  durur; kullanıcı kaydırıp adım kartı aramadan burada onaylar. */}
              <PendingActionNotice state={taskState} />
              <ComposerDock state={taskState} />
              {isChatConfigured(settings) && (
                <ChatMetaBar
                  settings={settings}
                  models={models}
                  quota={quota}
                  quotaError={quotaError}
                  loadingQuota={loadingQuota}
                  onRefreshQuota={refreshQuota}
                  onModelChange={handleModelChange}
                />
              )}
              <div className="relative w-full">
                <ChatInput
                  key={draftNonce}
                  state={taskState}
                  onSend={handleSendMessage}
                  onModeChange={handleModeChange}
                  initialValue={draftPrompt}
                  isConfigured={isChatConfigured(settings)}
                  onOpenSettings={() => openView('settings')}
                  editing={Boolean(
                    editingMessageId && taskState.messages.some((message) => message.id === editingMessageId)
                  )}
                  onCancelEdit={handleCancelEdit}
                  autonomy={settings.autonomy ?? 'manual'}
                  onAutonomyChange={handleAutonomyChange}
                />
                <ChatStatusBar
                  state={taskState}
                  onRetry={() => vscode.postMessage({ type: 'RETRY_LAST_TURN' })}
                />
              </div>
            </div>
          </div>

          {/* Başka sohbetler arka planda çalışıyorsa: tek tıkla o sohbete geç. */}
          {backgroundSessions.length > 0 && (
            <div
              data-testid="background-sessions-bar"
              className="sticky top-0 z-30 flex items-center gap-2 overflow-x-auto border-b ahi-border-brand ahi-bg-surface px-3 py-1.5"
            >
              <Loader2 className="ahi-icon-sm shrink-0 animate-spin ahi-text-brand" />
              <span className="shrink-0 text-2xs font-semibold ahi-text-fg">
                Arka planda çalışan {backgroundSessions.length} sohbet
              </span>
              {backgroundSessions.map((session) => (
                <Button
                  key={session.key}
                  size="xs"
                  variant="secondary"
                  onClick={() => switchToSession(session.id || session.key)}
                  title={session.prompt || 'Sohbete git'}
                  className="max-w-[220px] shrink-0"
                >
                  <span className="truncate">{session.prompt || 'Yeni sohbet'}</span>
                </Button>
              ))}
            </div>
          )}

          {/* Diğer ekranlardayken arka planda görev sürüyorsa görünen dinamik durum şeridi */}
          {activeTab !== 'chat' && (taskState.status === 'running' || taskState.activeSubagent) && (
            <div
              data-testid="background-task-indicator"
              className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b ahi-border-brand ahi-bg-surface px-3 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <Loader2 className="ahi-icon-sm shrink-0 animate-spin ahi-text-brand" />
                <span className="truncate text-xs font-medium ahi-text-fg">
                  {taskState.activeSubagent
                    ? `Alt Ajan [${taskState.activeSubagent.displayName || taskState.activeSubagent.role}]: ${
                        taskState.activeSubagent.currentTool
                          ? `araç: ${taskState.activeSubagent.currentTool}`
                          : 'çalışıyor…'
                      }`
                    : 'Arka planda görev devam ediyor…'}
                </span>
              </div>
              <button
                type="button"
                onClick={goToChat}
                className="shrink-0 text-2xs font-semibold ahi-text-brand hover:underline"
              >
                Sohbete Git →
              </button>
            </div>
          )}

          {activeTab === 'history' && (
            <HistoryView
              onBack={goBack}
              onSelectTask={goToChat}
              onSelectMenu={openView}
              changedFileCount={taskState.stats.filesModified.length}
            />
          )}

          {activeTab === 'changes' && (
            <ChangesView
              state={taskState}
              onBack={goBack}
              onSelectMenu={openView}
              changedFileCount={taskState.stats.filesModified.length}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              settings={settings}
              onBack={goBack}
              onOpenAbout={() => openView('about')}
              onSelectMenu={openView}
              changedFileCount={taskState.stats.filesModified.length}
            />
          )}

          {activeTab === 'mcp' && (
            <McpView
              onBack={goBack}
              onSelectMenu={openView}
              changedFileCount={taskState.stats.filesModified.length}
            />
          )}

          {activeTab === 'callgraph' && (
            <CallGraphView
              onBack={goBack}
              onSelectMenu={openView}
              changedFileCount={taskState.stats.filesModified.length}
            />
          )}

          {activeTab === 'agents' && (
            <AgentsView
              state={taskState}
              onBack={goBack}
              onSelectMenu={openView}
              changedFileCount={taskState.stats.filesModified.length}
            />
          )}

          {activeTab === 'about' && (
            <AboutView
              onBack={goBack}
              onSelectMenu={openView}
              changedFileCount={taskState.stats.filesModified.length}
            />
          )}

          {/* Chat dışındaki sekmelerde bildirim alt kısımda gösterilir */}
          {toast && activeTab !== 'chat' && (
            <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-50">
              <div className="pointer-events-auto">
                <ToastView toast={toast} onDismiss={() => setToast(null)} />
              </div>
            </div>
          )}
        </main>

        {/* Sabit / Açılıp Kapanabilen Yan Menü (Sidebar) */}
        <NavigationSidebar
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen((prev) => !prev)}
          activeDestination={activeTab}
          onSelect={(tab) => openView(tab)}
          changedFileCount={taskState.stats.filesModified.length}
        />
      </div>
    </div>
  );
};
