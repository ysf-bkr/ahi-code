import React, { useEffect, useRef, useState } from 'react';
import { Send, Square, CornerDownLeft, Compass, Code2, Hand, Gauge, Zap } from 'lucide-react';
import { AgentMode, AutonomyLevel, TaskState } from '@shared/types';
import { vscode } from '../utils/vscode';
import { Button, Segmented, Textarea } from './ui';

interface ChatInputProps {
  state: TaskState;
  onSend: (text: string) => void;
  onModeChange: (mode: AgentMode) => void;
  initialValue?: string;
  isConfigured?: boolean;
  onOpenSettings?: () => void;
  /** Gönderilmiş bir mesaj düzenleniyor: gönderim yeni mesaj eklemek yerine turu yeniler. */
  editing?: boolean;
  onCancelEdit?: () => void;
  /** Sohbette değiştirilebilen otonomi seviyesi; ayar olarak kalıcılaştırılır. */
  autonomy?: AutonomyLevel;
  onAutonomyChange?: (level: AutonomyLevel) => void;
}

const MODES: Array<{ id: AgentMode; label: string; icon: React.ReactNode }> = [
  { id: 'code', label: 'Kodlama', icon: <Code2 className="ahi-icon-xs" /> },
  { id: 'plan', label: 'Planlama', icon: <Compass className="ahi-icon-xs" /> }
];

const AUTONOMY_LEVELS: Array<{ id: AutonomyLevel; label: string; icon: React.ReactNode; title: string }> = [
  {
    id: 'manual',
    label: 'Elle',
    icon: <Hand className="ahi-icon-xs" />,
    title: 'Elle: her spec ve plan onayı sizden sorulur; turlar sizinle ilerler.'
  },
  {
    id: 'guided',
    label: 'Yönlendir',
    icon: <Gauge className="ahi-icon-xs" />,
    title: 'Yönlendirilmiş: spec ve plan otomatik onaylanır; yazma ve komut izinleri yine sorulur.'
  },
  {
    id: 'auto',
    label: 'Otonom',
    icon: <Zap className="ahi-icon-xs" />,
    title: 'Otonom: görev bitene kadar turlar kendiliğinden sürer; yazma ve komut izinleri yine sorulur.'
  }
];

export const ChatInput: React.FC<ChatInputProps> = ({
  state,
  onSend,
  onModeChange,
  initialValue = '',
  isConfigured = true,
  onOpenSettings,
  editing = false,
  onCancelEdit,
  autonomy = 'manual',
  onAutonomyChange
}) => {
  const [input, setInput] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // "running" ve "waiting_approval", turun ajana ait olduğu anlamına gelir;
  // bu yüzden gönderme iptal eder. `waiting_user_input` bunun tersidir: ajan
  // bir soru sordu ve yanıt bekler; gönderme iptal değil, göndermeli.
  const isRunning = state.status === 'running' || state.status === 'waiting_approval';
  const isWaitingForAnswer = state.status === 'waiting_user_input';
  const isBlockedByApproval = Boolean(state.pendingApproval || state.pendingToolCall);

  useEffect(() => {
    if (initialValue) {
      setInput(initialValue);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [initialValue]);

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  useEffect(() => {
    resizeTextarea();
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();

    // Ayarlar yapılmadıysa görevi başlatma; ayarlar ekranına yönlendir.
    if (!isConfigured) {
      onOpenSettings?.();
      return;
    }

    // Bir onay kartı engelleyiciyken kullanıcı onu kabul etmeli veya reddetmeli;
    // iptal etmek görevi sessizce düşürürdü.
    if (isBlockedByApproval) return;

    if (isRunning) {
      vscode.postMessage({ type: 'CANCEL_TASK' });
      return;
    }

    const value = input.trim();
    if (!value) return;
    onSend(value);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const placeholder = !isConfigured
    ? 'Sohbete başlamak için lütfen önce Ayarlar ekranından bir model sağlayıcısı yapılandırın...'
    : editing
      ? 'Mesajı düzenleyin; göndermek bu turu yeniden çalıştırır'
      : isBlockedByApproval
        ? 'Onay bekleniyor: yukarıdaki onay kartını kullanın'
        : isWaitingForAnswer
          ? 'Ajanın sorusunu buraya yazıp Enter’a basın'
          : isRunning
            ? 'Ajan çalışıyor... Durdurmak için tıklayın'
            : state.mode === 'plan'
              ? 'Bir hedef tanımlayın veya soru sorun...'
              : 'Soru sorun veya bir görev tanımlayın...';

  return (
    <div className="ahi-composer">
      {editing && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 mb-2 rounded border ahi-border-brand ahi-bg-brand-soft text-xs ahi-text-brand">
          <span>Bir mesajı düzenliyorsunuz. Gönderim, o mesajdan sonraki yanıtı yeniden üretir.</span>
          {onCancelEdit && (
            <button type="button" onClick={onCancelEdit} className="font-medium underline hover:opacity-80">
              Vazgeç
            </button>
          )}
        </div>
      )}

      {!isConfigured && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 mb-2 rounded border ahi-border-warning ahi-bg-warning text-xs ahi-text-warning">
          <span>Model sağlayıcı ayarları henüz yapılmadı.</span>
          {onOpenSettings && (
            <button type="button" onClick={onOpenSettings} className="font-medium underline hover:opacity-80">
              Ayarları Yapılandır
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="ahi-composer__box">
        <Textarea
          ref={textareaRef}
          value={input}
          disabled={!isConfigured}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Ajan için mesaj"
          rows={2}
          className="ahi-composer__textarea"
        />

        <div className="ahi-composer__bar">
          <div className="flex min-w-0 items-center gap-1.5">
            <Segmented<AgentMode>
              aria-label="Görev modu"
              value={state.mode}
              onChange={onModeChange}
              disabled={isRunning || !isConfigured}
              items={MODES.map((mode) => ({
                id: mode.id,
                label: mode.label,
                icon: mode.icon,
                title: isRunning ? 'Görev çalışırken mod değiştirilemez' : `${mode.label} modu`
              }))}
            />
            {onAutonomyChange && (
              <Segmented<AutonomyLevel>
                aria-label="Otonomi seviyesi"
                value={autonomy}
                onChange={onAutonomyChange}
                disabled={!isConfigured}
                items={AUTONOMY_LEVELS.map((level) => ({
                  id: level.id,
                  label: level.label,
                  icon: level.icon,
                  title: level.title
                }))}
              />
            )}
            <span className="ahi-composer__hint hidden min-[560px]:inline">
              <CornerDownLeft className="ahi-icon-xs" />
              Göndermek için Enter · Yeni satır için Shift+Enter
            </span>
          </div>

          <Button
            type="submit"
            variant={isRunning ? 'danger' : 'primary'}
            disabled={!isConfigured ? true : isBlockedByApproval ? true : !isRunning && !input.trim()}
            className={`ahi-btn--square ${isRunning ? 'ahi-btn--stop' : ''}`}
            title={
              !isConfigured
                ? 'Önce ayarları yapılandırın'
                : isBlockedByApproval
                  ? 'Önce onay kartını yanıtlayın'
                  : isRunning
                    ? 'Görevi durdur'
                    : isWaitingForAnswer
                      ? 'Yanıtı gönder'
                      : 'Mesajı gönder'
            }
            aria-label={
              !isConfigured
                ? 'Önce ayarları yapılandırın'
                : isBlockedByApproval
                  ? 'Önce onay kartını yanıtlayın'
                  : isRunning
                    ? 'Görevi durdur'
                    : isWaitingForAnswer
                      ? 'Yanıtı gönder'
                      : 'Mesajı gönder'
            }
          >
            {isRunning ? <Square className="ahi-icon-sm fill-current" /> : <Send className="ahi-icon-sm" />}
          </Button>
        </div>
      </form>
    </div>
  );
};
