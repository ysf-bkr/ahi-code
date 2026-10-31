import React from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { ToastLevel, ToastNotification } from '@shared/types';
import { IconButton } from './ui';

export type { ToastNotification };

interface ToastProps {
  toast: ToastNotification;
  onDismiss: () => void;
}

const LEVEL_STYLES: Record<ToastLevel, { box: string; icon: string }> = {
  error: {
    box: 'ahi-border-error ahi-bg-error',
    icon: 'ahi-bg-error ahi-text-error'
  },
  warning: {
    box: 'ahi-border-warning ahi-bg-warning',
    icon: 'ahi-bg-warning ahi-text-warning'
  },
  info: {
    box: 'ahi-border-info ahi-bg-info',
    icon: 'ahi-bg-info ahi-text-info'
  }
};

/**
 * Geçici bildirim. Çağıran normal akışta plan çubuğunun hemen üstüne yer
 * verir; bildirim hiçbir arayüz katmanının üstüne uçmaz. Uzun metin kendi
 * içinde kaydırılır, sohbet alanını ezmez.
 */
export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const style = LEVEL_STYLES[toast.level];
  const Icon = toast.level === 'info' ? CheckCircle2 : AlertCircle;

  return (
    <div
      role={toast.level === 'error' ? 'alert' : 'status'}
      aria-live={toast.level === 'error' ? 'assertive' : 'polite'}
      className={`ahi-animate-in ahi-shadow-lg flex items-start gap-2 rounded-lg border p-2.5 text-sm ahi-text-fg backdrop-blur-sm ${style.box}`}
    >
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${style.icon}`}>
        <Icon className="ahi-icon-sm" />
      </span>
      <span
        className="max-h-24 flex-1 overflow-y-auto break-words pt-0.5 leading-relaxed"
        title={toast.message}
      >
        {toast.message}
      </span>
      <IconButton label="Bildirimi kapat" small className="shrink-0" onClick={onDismiss}>
        <X className="ahi-icon-sm" />
      </IconButton>
    </div>
  );
};
