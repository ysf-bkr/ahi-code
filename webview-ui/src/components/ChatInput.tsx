import React, { useEffect, useRef, useState } from 'react';
import { Send, Square, CornerDownLeft, Compass, Code2 } from 'lucide-react';
import { AgentMode, TaskState } from '@shared/types';
import { vscode } from '../utils/vscode';
import { Button, Segmented, Textarea } from './ui';

interface ChatInputProps {
  state: TaskState;
  onSend: (text: string) => void;
  onModeChange: (mode: AgentMode) => void;
  initialValue?: string;
}

const MODES: Array<{ id: AgentMode; label: string; icon: React.ReactNode }> = [
  { id: 'code', label: 'Kodlama', icon: <Code2 className="h-3 w-3" /> },
  { id: 'plan', label: 'Planlama', icon: <Compass className="h-3 w-3" /> }
];

export const ChatInput: React.FC<ChatInputProps> = ({ state, onSend, onModeChange, initialValue = '' }) => {
  const [input, setInput] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // "running" and "waiting_approval" mean the agent owns the turn, so submit
  // cancels it. `waiting_user_input` is the opposite: the agent asked a
  // question and needs an answer, so submit must send, not cancel.
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

    // While an approval card is blocking, the user must accept or reject it;
    // cancelling would silently drop the task.
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

  const placeholder = isBlockedByApproval
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
      <form onSubmit={handleSubmit} className="ahi-composer__box">
        <Textarea
          ref={textareaRef}
          value={input}
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
              disabled={isRunning}
              items={MODES.map((mode) => ({
                id: mode.id,
                label: mode.label,
                icon: mode.icon,
                title: isRunning ? 'Görev çalışırken mod değiştirilemez' : `${mode.label} modu`
              }))}
            />
            <span className="ahi-composer__hint">
              <CornerDownLeft className="h-2.5 w-2.5" />
              Göndermek için Enter · Yeni satır için Shift+Enter
            </span>
          </div>

          <Button
            type="submit"
            variant={isRunning ? 'danger' : 'primary'}
            disabled={isBlockedByApproval ? true : !isRunning && !input.trim()}
            className={`ahi-btn--square ${isRunning ? 'ahi-btn--stop' : ''}`}
            title={
              isBlockedByApproval
                ? 'Önce onay kartını yanıtlayın'
                : isRunning
                  ? 'Görevi durdur'
                  : isWaitingForAnswer
                    ? 'Yanıtı gönder'
                    : 'Mesajı gönder'
            }
            aria-label={
              isBlockedByApproval
                ? 'Önce onay kartını yanıtlayın'
                : isRunning
                  ? 'Görevi durdur'
                  : isWaitingForAnswer
                    ? 'Yanıtı gönder'
                    : 'Mesajı gönder'
            }
          >
            {isRunning ? <Square className="h-3.5 w-3.5 fill-current" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </form>
    </div>
  );
};
