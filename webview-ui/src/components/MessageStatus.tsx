import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, Sparkles, Wrench } from 'lucide-react';
import { ChatMessage, ToolCall } from '@shared/types';

export type MessagePhase = 'thinking' | 'writing' | 'working' | 'done' | 'error';

interface PhaseMeta {
  label: string;
  className: string;
  icon: React.ReactNode;
}

const PHASE_META: Record<MessagePhase, PhaseMeta> = {
  thinking: {
    label: 'düşünüyor',
    className: 'text-[var(--ahi-brand-400)]',
    icon: <Sparkles className="h-2.5 w-2.5 animate-pulse" />
  },
  writing: {
    label: 'yazıyor',
    className: 'text-[var(--ahi-brand-400)]',
    icon: <Loader2 className="h-2.5 w-2.5 animate-spin" />
  },
  working: {
    label: 'çalışıyor',
    className: 'text-[var(--ahi-brand-400)]',
    icon: <Wrench className="h-2.5 w-2.5 animate-pulse" />
  },
  done: {
    label: 'tamamlandı',
    className: 'text-[var(--status-success-fg)]',
    icon: <CheckCircle2 className="h-2.5 w-2.5" />
  },
  error: {
    label: 'hata',
    className: 'text-[var(--status-error-fg)]',
    icon: <AlertCircle className="h-2.5 w-2.5" />
  }
};

const ACTIVE_STATUSES: ReadonlyArray<ToolCall['status']> = ['pending', 'approved', 'executing'];

export interface MessagePhaseInfo {
  phase: MessagePhase;
  /** Name of the tool that is currently running, if any. */
  tool?: string;
  /** 1-based position of the active tool among the turn's tool calls. */
  step?: number;
  totalSteps?: number;
  /** Longer explanation, shown as a tooltip. */
  detail?: string;
}

/**
 * Derives what the assistant is actually doing from the message itself.
 *
 * The UI must never claim "writing" while a tool is running: in that state the
 * model is waiting for a command or a file edit, not producing text.
 */
export function resolveMessagePhase(message: ChatMessage): MessagePhaseInfo | undefined {
  const toolCalls: ToolCall[] = message.toolCalls ?? [];
  const activeIndex = toolCalls.findIndex((call) => ACTIVE_STATUSES.includes(call.status));
  const activeTool = activeIndex >= 0 ? toolCalls[activeIndex] : undefined;

  if (message.error) {
    return { phase: 'error', detail: message.error };
  }

  if (activeTool) {
    const step = activeIndex + 1;
    const name = String(activeTool.name || 'araç');
    const explanation = activeTool.explanation ? ` — ${activeTool.explanation}` : '';
    return {
      phase: 'working',
      tool: name,
      step,
      totalSteps: toolCalls.length,
      detail: `${name} çalışıyor (adım ${step}/${toolCalls.length})${explanation}`
    };
  }

  if (message.isStreaming) {
    return message.content
      ? { phase: 'writing', detail: 'Yanıt metni akıyor.' }
      : { phase: 'thinking', detail: 'Model yanıtı hazırlıyor.' };
  }

  if (toolCalls.length > 0) {
    const failed = toolCalls.filter((call) => call.status === 'error').length;
    return {
      phase: 'done',
      totalSteps: toolCalls.length,
      detail:
        failed > 0
          ? `Tur bitti; ${failed} araç adımı hata verdi.`
          : `Tur bitti; ${toolCalls.length} araç adımı tamamlandı.`
    };
  }

  return undefined;
}

interface MessageStatusProps {
  message: ChatMessage;
}

/** Small inline icon + label describing the turn state, derived from the message. */
export const MessageStatus: React.FC<MessageStatusProps> = ({ message }) => {
  const info = resolveMessagePhase(message);
  if (!info) return null;

  const meta = PHASE_META[info.phase];
  const suffix =
    info.phase === 'working' && info.tool
      ? `: ${info.tool}${info.totalSteps ? ` (${info.step}/${info.totalSteps})` : ''}`
      : '';

  return (
    <span
      className={`flex items-center gap-1 text-2xs ${meta.className}`}
      role="status"
      aria-live="polite"
      title={info.detail}
    >
      {meta.icon}
      {meta.label}
      {suffix}
    </span>
  );
};

/** Expanded error block with the failure text. */
export const MessageError: React.FC<{ error: string }> = ({ error }) => (
  <div className="flex items-start gap-1.5 rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-2.5 py-1.5">
    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-[var(--status-error-fg)]" />
    <span className="text-2xs whitespace-pre-wrap break-words leading-relaxed text-[var(--ahi-fg)]">
      {error}
    </span>
  </div>
);
