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
      const stepStr = sub.step
        ? sub.maxSteps
          ? ` (${sub.step}/${sub.maxSteps})`
          : ` (adım ${sub.step})`
        : '';
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
  busy: <Loader2 className="ahi-icon-xs animate-spin" />,
  waiting: <ShieldQuestion className="ahi-icon-xs" />,
  error: <AlertCircle className="ahi-icon-xs" />,
  paused: <Clock className="ahi-icon-xs" />,
  stopped: <Clock className="ahi-icon-xs" />,
  done: <CheckCircle2 className="ahi-icon-xs" />
};

const TONES: Record<ChatStatus['kind'], string> = {
  idle: 'ahi-text-muted',
  busy: 'ahi-text-brand',
  waiting: 'ahi-text-warning',
  error: 'ahi-text-error',
  paused: 'ahi-text-warning',
  stopped: 'ahi-text-muted',
  done: 'ahi-text-success'
};

interface ChatStatusBarProps {
  state: TaskState;
  onRetry: () => void;
}

/** Otomatik doğrulama sonucunu durum satırının sonunda gösteren kısa etiket. */
const verificationLabel = (state: TaskState): { text: string; tone: string } | null => {
  const verification = state.stats.verification;
  if (!verification || verification.status === 'not_run') return null;
  const attempts = verification.attempts > 0 ? ` · ${verification.attempts}` : '';
  switch (verification.status) {
    case 'running':
      return { text: `Doğrulanıyor${attempts}`, tone: 'ahi-text-info' };
    case 'passed':
      return { text: `Doğrulandı${attempts}`, tone: 'ahi-text-success' };
    case 'failed':
      return { text: `Doğrulama başarısız${attempts}`, tone: 'ahi-text-error' };
    default:
      return { text: `Doğrulama atlandı${attempts}`, tone: 'ahi-text-muted' };
  }
};

/** Bestecinin altındaki tek satırlık durum çizgisi. */
export const ChatStatusBar: React.FC<ChatStatusBarProps> = ({ state, onRetry }) => {
  const status = resolveChatStatus(state);
  const verification = verificationLabel(state);
  if ((status.kind === 'idle' || !status.message) && !verification) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`text-2xs flex items-center gap-1.5 px-1 pt-1.5 ${TONES[status.kind]}`}
    >
      {status.kind !== 'idle' && status.message && (
        <>
          <span className="shrink-0">{ICONS[status.kind]}</span>
          <span className="min-w-0 flex-1 truncate leading-relaxed" title={status.message}>
            {status.message}
          </span>
        </>
      )}
      {verification && (
        <span
          className={`shrink-0 font-mono ${verification.tone}`}
          title={state.stats.verification?.summary || 'Otomatik doğrulama'}
        >
          {verification.text}
        </span>
      )}
      {status.canRetry && (
        <Button
          size="xs"
          variant="secondary"
          onClick={onRetry}
          title="Son istemi yeniden gönder"
          icon={<RefreshCw className="ahi-icon-xs" />}
        >
          Yeniden gönder
        </Button>
      )}
    </div>
  );
};
