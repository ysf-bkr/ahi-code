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
    className: 'ahi-text-brand',
    icon: <Sparkles className="ahi-icon-xs animate-pulse" />
  },
  writing: {
    label: 'yazıyor',
    className: 'ahi-text-brand',
    icon: <Loader2 className="ahi-icon-xs animate-spin" />
  },
  working: {
    label: 'çalışıyor',
    className: 'ahi-text-brand',
    icon: <Wrench className="ahi-icon-xs animate-pulse" />
  },
  done: {
    label: 'tamamlandı',
    className: 'ahi-text-success',
    icon: <CheckCircle2 className="ahi-icon-xs" />
  },
  error: {
    label: 'hata',
    className: 'ahi-text-error',
    icon: <AlertCircle className="ahi-icon-xs" />
  }
};

const ACTIVE_STATUSES: ReadonlyArray<ToolCall['status']> = ['pending', 'approved', 'executing'];

export interface MessagePhaseInfo {
  phase: MessagePhase;
  /** Şu anda çalışan aracın adı, varsa. */
  tool?: string;
  /** Etkin aracın turdaki araç çağrıları arasındaki 1 tabanlı konumu. */
  step?: number;
  totalSteps?: number;
  /** Araç ipucu olarak gösterilen daha uzun açıklama. */
  detail?: string;
}

/**
 * Asistanın gerçekte ne yaptığını mesajın kendisinden çıkarır.
 *
 * Arayüz, bir araç çalışırken asla "yazıyor" dememeli: o durumda model
 * metin üretmiyor, bir komutun veya dosya düzenlemesinin bitmesini bekliyor.
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

/** Tur durumunu mesajdan türetilen küçük satır içi simge + etiket. */
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

/** Hata metnini içeren genişletilmiş hata bloğu. */
export const MessageError: React.FC<{ error: string }> = ({ error }) => (
  <div className="flex items-start gap-1.5 rounded-md border ahi-border-error ahi-bg-error px-2.5 py-1.5">
    <AlertCircle className="ahi-icon-xs mt-0.5 shrink-0 ahi-text-error" />
    <span className="text-2xs whitespace-pre-wrap break-words leading-relaxed ahi-text-fg">{error}</span>
  </div>
);
