import React from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw, ShieldQuestion } from 'lucide-react';
import { TaskState } from '@shared/types';
import { Button } from './ui';
import { resolveMessagePhase } from './MessageStatus';
import { stageLabel } from '@shared/workflowLabels';

export interface ChatStatus {
  kind: 'idle' | 'busy' | 'waiting' | 'error' | 'paused' | 'stopped' | 'done';
  message: string;
  /** Bir hatadan sonra kullanıcının son istemi yeniden gönderebilip gönderemeyeceği. */
  canRetry: boolean;
}

/**
 * Bestecinin altında gösterilen tek satırlık durumu türetir.
 *
 * Kullanıcının bir bakışta ihtiyaç duyduğu her şey — iş akışı aşaması, plan
 * konumu ve dürüst görev durumu — bu tek satırdadır; sohbetin kendisi sade kalır.
 */
export function resolveChatStatus(state: TaskState): ChatStatus {
  const stage = state.workflow ? stageLabel(state.workflow.stage) : undefined;

  if (state.pendingApproval) {
    return {
      kind: 'waiting',
      message:
        state.pendingApproval.kind === 'spec'
          ? 'Spec onayı bekleniyor — karttaki onay veya ret düğmesini kullanın.'
          : 'Plan onayı bekleniyor — karttaki onay veya ret düğmesini kullanın.',
      canRetry: false
    };
  }

  if (state.pendingQuestion) {
    return { kind: 'waiting', message: 'Ajan bir soru sordu; yanıtınızı bekliyor.', canRetry: false };
  }

  if (state.pendingToolCall) {
    return {
      kind: 'waiting',
      message: `Araç onayı bekleniyor: ${state.pendingToolCall.name}`,
      canRetry: false
    };
  }

  if (state.activeSubagent) {
    const sub = state.activeSubagent;
    const agentName = sub.displayName || sub.role;
    const location = sub.isolate ? ' · İzole Worktree' : '';
    let action = 'çalışıyor…';
    if (sub.currentTool) {
      const stepStr = sub.step ? ` (${sub.step}/${sub.maxSteps || 8})` : '';
      action = `araç çalışıyor: ${sub.currentTool}${stepStr}`;
    }
    return {
      kind: 'busy',
      message: `Alt Ajan [${agentName}]: ${action}${location}`,
      canRetry: false
    };
  }

  const lastAssistant = [...state.messages].reverse().find((message) => message.role === 'assistant');

  if (state.status === 'running') {
    const info = lastAssistant ? resolveMessagePhase(lastAssistant) : undefined;
    let action = 'Yanıt bekleniyor…';
    if (info?.phase === 'working' && info.tool) {
      action = `Araç çalışıyor: ${info.tool}${info.totalSteps ? ` (${info.step}/${info.totalSteps})` : ''}`;
    } else if (info?.phase === 'writing') {
      action = 'Yanıt yazılıyor…';
    }
    return { kind: 'busy', message: [stage, action].filter(Boolean).join(' · '), canRetry: false };
  }

  if (state.status === 'failed') {
    const error = lastAssistant?.error;
    return {
      kind: 'error',
      message: error ? `Hata: ${error}` : 'Görev hata ile sonlandı.',
      canRetry: state.messages.some((message) => message.role === 'user')
    };
  }

  if (state.status === 'paused') {
    return {
      kind: 'paused',
      message: 'Görev duraklatıldı — devam etmek için mesaj gönderin.',
      canRetry: true
    };
  }

  if (state.status === 'cancelled') {
    return { kind: 'stopped', message: 'Görev durduruldu.', canRetry: true };
  }

  if (state.status === 'completed') {
    return {
      kind: 'done',
      message: [stage, 'Yanıt tamamlandı'].filter(Boolean).join(' · '),
      canRetry: false
    };
  }

  return { kind: 'idle', message: '', canRetry: false };
}

const ICONS: Record<ChatStatus['kind'], React.ReactNode> = {
  idle: null,
  busy: <Loader2 className="h-2.5 w-2.5 animate-spin" />,
  waiting: <ShieldQuestion className="h-2.5 w-2.5" />,
  error: <AlertCircle className="h-2.5 w-2.5" />,
  paused: <Clock className="h-2.5 w-2.5" />,
  stopped: <Clock className="h-2.5 w-2.5" />,
  done: <CheckCircle2 className="h-2.5 w-2.5" />
};

const TONES: Record<ChatStatus['kind'], string> = {
  idle: 'text-[var(--ahi-muted-fg)]',
  busy: 'text-[var(--ahi-brand-400)]',
  waiting: 'text-[var(--status-warning-fg)]',
  error: 'text-[var(--status-error-fg)]',
  paused: 'text-[var(--status-warning-fg)]',
  stopped: 'text-[var(--ahi-muted-fg)]',
  done: 'text-[var(--status-success-fg)]'
};

interface ChatStatusBarProps {
  state: TaskState;
  onRetry: () => void;
}

/** Bestecinin altındaki tek satırlık durum çizgisi. */
export const ChatStatusBar: React.FC<ChatStatusBarProps> = ({ state, onRetry }) => {
  const status = resolveChatStatus(state);
  if (status.kind === 'idle' || !status.message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`text-2xs flex items-center gap-1.5 px-1 pt-1.5 ${TONES[status.kind]}`}
    >
      <span className="shrink-0">{ICONS[status.kind]}</span>
      <span className="min-w-0 flex-1 truncate leading-relaxed" title={status.message}>
        {status.message}
      </span>
      {status.canRetry && (
        <Button
          size="xs"
          variant="secondary"
          onClick={onRetry}
          title="Son istemi yeniden gönder"
          icon={<RefreshCw className="h-2.5 w-2.5" />}
        >
          Yeniden gönder
        </Button>
      )}
    </div>
  );
};
