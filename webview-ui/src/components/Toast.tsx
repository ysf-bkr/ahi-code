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
    box: 'border-[var(--status-error-border)] bg-[var(--status-error-bg)]',
    icon: 'bg-[var(--status-error-bg)] text-[var(--status-error-fg)]'
  },
  warning: {
    box: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]',
    icon: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]'
  },
  info: {
    box: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)]',
    icon: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]'
  }
};

/**
 * Transient notification. Positioned by the caller so it can sit directly above
 * the composer instead of covering the header.
 */
export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const style = LEVEL_STYLES[toast.level];
  const Icon = toast.level === 'info' ? CheckCircle2 : AlertCircle;

  return (
    <div
      role={toast.level === 'error' ? 'alert' : 'status'}
      aria-live={toast.level === 'error' ? 'assertive' : 'polite'}
      className={`ahi-animate-in flex items-start gap-2 rounded-lg border p-2.5 text-sm text-[var(--ahi-fg)] shadow-xl backdrop-blur-sm ${style.box}`}
    >
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${style.icon}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="flex-1 break-words pt-0.5 leading-relaxed">{toast.message}</span>
      <IconButton label="Bildirimi kapat" small className="shrink-0" onClick={onDismiss}>
        <X className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
};
