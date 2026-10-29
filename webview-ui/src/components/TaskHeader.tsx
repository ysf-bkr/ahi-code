import React, { useEffect, useRef, useState } from 'react';
import {
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
  Undo2,
  PauseCircle,
  Ban,
  Menu as MenuIcon
} from 'lucide-react';
import { NavigationDestination, TaskState, UserSettings } from '@shared/types';
import { Logo } from './Logo';
import { vscode } from '../utils/vscode';
import { MenuView } from './MenuView';
import { Button, IconButton, ListButton } from './ui';

interface TaskHeaderProps {
  state: TaskState;
  settings: UserSettings;
  changedFileCount: number;
  onSelectMenu: (destination: NavigationDestination) => void;
}

export const TaskHeader: React.FC<TaskHeaderProps> = ({
  state,
  settings,
  changedFileCount,
  onSelectMenu
}) => {
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const checkpointButtonRef = useRef<HTMLSpanElement>(null);
  const checkpointPanelRef = useRef<HTMLDivElement>(null);

  // Her iki açılır panel de Escape ve dışarı tıklamayla kapanır. Checkpoint
  // paneli eskiden açık kalıyordu; bu, yıkıcı bir eylemi bir yanlış tıklamaya
  // yaklaştırıyordu.
  useEffect(() => {
    if (!showMenu && !showCheckpoints) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (showMenu && !menuRef.current?.contains(event.target)) setShowMenu(false);
      if (
        showCheckpoints &&
        !checkpointPanelRef.current?.contains(event.target) &&
        !checkpointButtonRef.current?.contains(event.target)
      ) {
        setShowCheckpoints(false);
        setConfirmRevert(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowMenu(false);
      setShowCheckpoints(false);
      setConfirmRevert(false);
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showMenu, showCheckpoints]);

  useEffect(() => {
    if (!showCheckpoints) setConfirmRevert(false);
  }, [showCheckpoints]);

  const statusBadge = (() => {
    switch (state.status) {
      case 'running':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium text-[var(--status-info-fg)]">
            <Loader2 className="h-2.5 w-2.5 animate-spin" /> Çalışıyor
          </span>
        );
      case 'waiting_approval':
        return (
          <span className="flex items-center gap-1 ahi-badge bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]">
            <AlertCircle className="h-2.5 w-2.5" /> Onay bekleniyor
          </span>
        );
      case 'waiting_user_input':
        return (
          <span className="flex items-center gap-1 ahi-badge bg-[var(--status-info-bg)] text-[var(--status-info-fg)]">
            <AlertCircle className="h-2.5 w-2.5" /> Yanıt bekleniyor
          </span>
        );
      case 'completed':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium text-[var(--status-success-fg)]">
            <CheckCircle2 className="h-2.5 w-2.5" /> Tamamlandı
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium text-[var(--status-error-fg)]">
            <Ban className="h-2.5 w-2.5" /> Başarısız
          </span>
        );
      case 'paused':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium text-[var(--status-warning-fg)]">
            <PauseCircle className="h-2.5 w-2.5" /> Duraklatıldı
          </span>
        );
      case 'cancelled':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium text-[var(--vscode-descriptionForeground)]">
            <Ban className="h-2.5 w-2.5" /> İptal edildi
          </span>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="relative z-10 flex shrink-0 select-none flex-col border-b border-[var(--vscode-sideBar-border)] bg-[var(--vscode-sideBar-background)] text-[var(--vscode-sideBar-foreground)]">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="ahi-avatar-soft flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[var(--ahi-brand-400)]">
            <Logo className="h-3.5 w-3.5" colored />
          </span>
          <span className="text-sm font-semibold tracking-tight">AhiCode</span>
          <span
            aria-label={`Görev modu: ${state.mode === 'plan' ? 'Planlama' : 'Kodlama'}`}
            className="ahi-badge shrink-0 border border-[var(--ahi-surface-border)] bg-[var(--ahi-surface)] text-[var(--ahi-fg)]"
          >
            {state.mode === 'plan' ? 'Planlama' : 'Kodlama'}
          </span>
          <span className="ahi-badge hidden max-w-[110px] truncate border border-[var(--ahi-surface-border)] bg-[var(--ahi-surface)] font-mono text-[var(--ahi-muted-fg)] min-[360px]:inline">
            {settings.selectedModel || 'auto'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {statusBadge}

          <div className="mx-0.5 h-3.5 w-px bg-[var(--vscode-sideBar-border)]" />

          <span ref={checkpointButtonRef} className="inline-flex">
            <IconButton
              label="Kontrol noktaları / Geri al"
              active={showCheckpoints}
              aria-haspopup="dialog"
              aria-expanded={showCheckpoints}
              onClick={() => setShowCheckpoints((value) => !value)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </IconButton>
          </span>
          <Button
            variant="primary"
            className="ahi-btn--square-sm ml-0.5"
            onClick={() => vscode.postMessage({ type: 'NEW_SESSION' })}
            title="Yeni sohbet"
            aria-label="Yeni sohbet"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <div className="relative">
            <IconButton
              label="Menüyü aç"
              active={showMenu}
              onClick={() => setShowMenu((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={showMenu}
            >
              <MenuIcon className="h-3.5 w-3.5" />
            </IconButton>
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
                  onClick={() => setShowMenu(false)}
                />
                <div
                  ref={menuRef}
                  className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col border-l border-[var(--vscode-sideBar-border)] bg-[var(--vscode-sideBar-background)] shadow-2xl"
                >
                  <MenuView
                    changedFileCount={changedFileCount}
                    onSelect={(destination) => {
                      setShowMenu(false);
                      onSelectMenu(destination);
                    }}
                    onClose={() => setShowMenu(false)}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto border-t border-[var(--vscode-sideBar-border)] bg-[var(--vscode-editorWidget-background)] px-2.5 py-1">
        {state.stats.stepsCount > 0 && (
          <span className="ahi-badge shrink-0 bg-[var(--vscode-sideBar-background)] font-mono text-[var(--ahi-muted-fg)]">
            {state.stats.stepsCount} adım
          </span>
        )}
        {state.stats.totalTokens > 0 && (
          <span className="ahi-badge shrink-0 bg-[var(--vscode-sideBar-background)] font-mono text-[var(--ahi-muted-fg)]">
            {state.stats.totalTokens.toLocaleString('tr-TR')} token
          </span>
        )}
        {state.stats.filesModified.length > 0 && (
          <span className="ahi-badge shrink-0 bg-[var(--vscode-sideBar-background)] font-mono text-[var(--ahi-muted-fg)]">
            {state.stats.filesModified.length} dosya
          </span>
        )}
        {state.stats.verification && state.stats.verification.status !== 'not_run' && (
          <span
            className={`shrink-0 rounded-full bg-[var(--vscode-sideBar-background)] px-1.5 py-0.5 font-mono text-2xs ${
              state.stats.verification.status === 'passed'
                ? 'text-[var(--status-success-fg)]'
                : state.stats.verification.status === 'failed'
                  ? 'text-[var(--status-error-fg)]'
                  : 'text-[var(--vscode-descriptionForeground)]'
            }`}
            title={state.stats.verification.summary || 'Otomatik doğrulama'}
          >
            {state.stats.verification.status === 'running'
              ? 'Doğrulanıyor'
              : state.stats.verification.status === 'passed'
                ? 'Doğrulandı'
                : state.stats.verification.status === 'failed'
                  ? 'Doğrulama başarısız'
                  : 'Doğrulama atlandı'}
            {state.stats.verification.attempts > 0 ? ` · ${state.stats.verification.attempts}` : ''}
          </span>
        )}
      </div>

      {showCheckpoints && (
        <div
          ref={checkpointPanelRef}
          role="dialog"
          aria-label="Kontrol noktaları"
          className="absolute right-2 top-full z-30 mt-1 w-64 space-y-1 rounded-lg border border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-editorWidget-background)] p-1.5 shadow-xl"
        >
          <div className="border-b border-[var(--vscode-sideBar-border)] px-1 pb-1 text-2xs font-semibold uppercase tracking-wider text-[var(--vscode-descriptionForeground)]">
            Kontrol noktaları
          </div>

          {!state.checkpoints || state.checkpoints.length === 0 ? (
            <div className="px-1 py-1.5 text-xs text-[var(--vscode-descriptionForeground)]">
              Henüz kontrol noktası yok. İlk görev sırasında otomatik olarak oluşturulur.
            </div>
          ) : (
            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {[...state.checkpoints].reverse().map((cp) => (
                <ListButton
                  key={cp.id}
                  onClick={() => {
                    vscode.postMessage({ type: 'REWIND_TO_CHECKPOINT', payload: { checkpointId: cp.id } });
                    setShowCheckpoints(false);
                  }}
                  title={cp.preview}
                  description={`Tur #${cp.turnIndex} · ${new Date(cp.timestamp).toLocaleTimeString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}`}
                />
              ))}
            </div>
          )}

          <Button
            variant={confirmRevert ? 'danger' : 'ghost'}
            block
            className="mt-1 justify-start border-t border-[var(--vscode-sideBar-border)]"
            title={
              confirmRevert
                ? 'Dosya değişikliği kalıcı olarak geri alınacak'
                : 'Son dosya değişikliğini geri almak için tekrar tıklayın'
            }
            onClick={() => {
              if (!confirmRevert) {
                setConfirmRevert(true);
                return;
              }
              vscode.postMessage({ type: 'REVERT_LAST_SNAPSHOT' });
              setConfirmRevert(false);
              setShowCheckpoints(false);
            }}
            icon={<Undo2 className="h-3 w-3" />}
          >
            {confirmRevert ? 'Geri almayı onayla' : 'Son dosya değişikliğini geri al'}
          </Button>
        </div>
      )}
    </div>
  );
};
