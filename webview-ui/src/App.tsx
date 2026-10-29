import React, { useState, useEffect } from 'react';
import { TaskHeader } from './components/TaskHeader';
import { MessageList } from './components/MessageList';
import { ChatInput } from './components/ChatInput';
import { ChatStatusBar } from './components/ChatStatusBar';
import { ComposerDock } from './components/ComposerDock';
import { SettingsView } from './components/SettingsView';
import { HistoryView } from './components/HistoryView';
import { McpView } from './components/McpView';
import { AgentsView } from './components/AgentsView';
import { AboutView } from './components/AboutView';
import { ChangesView } from './components/ChangesView';
import { NavigationSidebar } from './components/NavigationSidebar';
import { Toast as ToastView } from './components/Toast';
import {
  AgentMode,
  ExtensionToWebviewMessage,
  NavigationDestination,
  TaskState,
  ToastNotification,
  UserSettings
} from '@shared/types';
import { DEFAULT_TASK_STATE, DEFAULT_USER_SETTINGS } from '@shared/constants';
import { vscode } from './utils/vscode';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationDestination>('chat');
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

  const [taskState, setTaskState] = useState<TaskState>(DEFAULT_TASK_STATE);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);

  const [draftPrompt, setDraftPrompt] = useState('');
  // Her "mesajı düzenle" eyleminde artırılır; aynı mesaj üst üste iki kez
  // düzenlense bile besteci yeniden kurulup metni alsın.
  const [draftNonce, setDraftNonce] = useState(0);

  useEffect(() => {
    vscode.postMessage({ type: 'REQUEST_SETTINGS' });

    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'TASK_STATE_UPDATE':
          setTaskState(msg.payload);
          break;
        case 'SETTINGS_LOADED':
          setSettings(msg.payload);
          break;
        case 'STREAM_CHUNK': {
          const { messageId, text } = msg.payload;
          setTaskState((prev) => ({
            ...prev,
            messages: prev.messages.map((m) => (m.id === messageId ? { ...m, content: m.content + text } : m))
          }));
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
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  /**
   * Sürekli sohbet: Gönderilen tüm mesajlar mevcut oturumda kalır!
   */
  const handleSendMessage = (text: string) => {
    vscode.postMessage({
      type: 'SEND_MESSAGE',
      payload: { text, mode: taskState.mode }
    });
    setDraftPrompt('');
  };

  const handleModeChange = (mode: AgentMode) => {
    setTaskState((prev) => ({ ...prev, mode }));
    vscode.postMessage({ type: 'SET_MODE', payload: { mode } });
  };

  const handleSuggestionClick = (prompt: string) => {
    setDraftPrompt(prompt);
    setDraftNonce((value) => value + 1);
  };

  /** Gönderilmiş bir mesayı düzenlenip yeniden gönderilmek üzere besteciye koyar. */
  const handleEditMessage = (content: string) => {
    setDraftPrompt(content);
    setDraftNonce((value) => value + 1);
  };

  return (
    <div className="ahi-app">
      {/* Sabit Header — her ekranda en üstte sabit kalır */}
      <TaskHeader
        state={taskState}
        settings={settings}
        changedFileCount={taskState.stats.filesModified.length}
        onSelectMenu={openView}
      />

      {/* Ana Çalışma Alanı + Sabit Yan Menü */}
      <div className="ahi-app__body">
        <main className="ahi-main">
          {activeTab === 'chat' && (
            <div className="flex h-full min-h-0 w-full flex-col">
              <MessageList
                messages={taskState.messages}
                pendingToolCall={taskState.pendingToolCall}
                checkpoints={taskState.checkpoints}
                onEditMessage={handleEditMessage}
                onSuggestionClick={handleSuggestionClick}
              />
              <ComposerDock state={taskState} />
              <div className="relative shrink-0 w-full">
                {toast && (
                  <div className="absolute bottom-full left-2 right-2 z-50 mb-1">
                    <ToastView toast={toast} onDismiss={() => setToast(null)} />
                  </div>
                )}
                <ChatInput
                  key={draftNonce}
                  state={taskState}
                  onSend={handleSendMessage}
                  onModeChange={handleModeChange}
                  initialValue={draftPrompt}
                />
                <ChatStatusBar
                  state={taskState}
                  onRetry={() => vscode.postMessage({ type: 'RETRY_LAST_TURN' })}
                />
              </div>
            </div>
          )}

          {activeTab === 'history' && <HistoryView onBack={goBack} />}

          {activeTab === 'changes' && <ChangesView state={taskState} onBack={goBack} />}

          {activeTab === 'settings' && (
            <SettingsView settings={settings} onBack={goBack} onOpenAbout={() => openView('about')} />
          )}

          {activeTab === 'mcp' && <McpView onBack={goBack} />}

          {activeTab === 'agents' && <AgentsView state={taskState} onBack={goBack} />}

          {activeTab === 'about' && <AboutView onBack={goBack} />}

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
