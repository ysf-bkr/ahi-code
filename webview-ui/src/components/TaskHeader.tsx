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
import { NavigationDestination, TaskState } from '@shared/types';
import { Logo } from './Logo';
import { vscode } from '../utils/vscode';
import { MenuView } from './MenuView';
import { Badge, Button, Drawer, IconButton, ListButton, Popover } from './ui';

interface TaskHeaderProps {
  state: TaskState;
  changedFileCount: number;
  onSelectMenu: (destination: NavigationDestination) => void;
}

export const TaskHeader: React.FC<TaskHeaderProps> = ({ state, changedFileCount, onSelectMenu }) => {
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
          <Badge tone="info">
            <Loader2 className="ahi-icon-xs animate-spin" /> Çalışıyor
          </Badge>
        );
      case 'waiting_approval':
        return (
          <Badge tone="warning">
            <AlertCircle className="ahi-icon-xs" /> Onay bekleniyor
          </Badge>
        );
      case 'waiting_user_input':
        return (
          <Badge tone="info">
            <AlertCircle className="ahi-icon-xs" /> Yanıt bekleniyor
          </Badge>
        );
      case 'completed':
        return (
          <Badge tone="success">
            <CheckCircle2 className="ahi-icon-xs" /> Tamamlandı
          </Badge>
        );
      case 'failed':
        return (
          <Badge tone="error">
            <Ban className="ahi-icon-xs" /> Başarısız
          </Badge>
        );
      case 'paused':
        return (
          <Badge tone="warning">
            <PauseCircle className="ahi-icon-xs" /> Duraklatıldı
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge tone="muted">
            <Ban className="ahi-icon-xs" /> İptal edildi
          </Badge>
        );
      default:
        return null;
    }
  })();

  return (
    <header className="ahi-header">
      <div className="ahi-header__row">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="ahi-avatar ahi-avatar-soft ahi-avatar--xs ahi-text-brand">
            <Logo className="ahi-icon-sm" colored />
          </span>
          <span className="text-sm font-semibold tracking-tight">AhiCode</span>
          <Badge tone="neutral" aria-label={`Görev modu: ${state.mode === 'plan' ? 'Planlama' : 'Kodlama'}`}>
            {state.mode === 'plan' ? 'Planlama' : 'Kodlama'}
          </Badge>
        </div>

        <div className="ahi-header__actions">
          {statusBadge}

          <span className="ahi-divider ahi-divider--vertical mx-0.5" aria-hidden="true" />

          <span ref={checkpointButtonRef} className="inline-flex">
            <IconButton
              label="Kontrol noktaları / Geri al"
              active={showCheckpoints}
              aria-haspopup="dialog"
              aria-expanded={showCheckpoints}
              onClick={() => setShowCheckpoints((value) => !value)}
            >
              <RotateCcw className="ahi-icon-sm" />
            </IconButton>
          </span>
          <Button
            variant="primary"
            className="ahi-btn--square-sm ml-0.5"
            onClick={() => vscode.postMessage({ type: 'NEW_SESSION' })}
            title="Yeni sohbet"
            aria-label="Yeni sohbet"
          >
            <Plus className="ahi-icon-sm" />
          </Button>
          <div className="relative">
            <IconButton
              label="Menüyü aç"
              active={showMenu}
              onClick={() => setShowMenu((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={showMenu}
            >
              <MenuIcon className="ahi-icon-sm" />
            </IconButton>
            {showMenu && (
              <Drawer onClose={() => setShowMenu(false)} drawerRef={menuRef}>
                <MenuView
                  changedFileCount={changedFileCount}
                  onSelect={(destination) => {
                    setShowMenu(false);
                    onSelectMenu(destination);
                  }}
                  onClose={() => setShowMenu(false)}
                />
              </Drawer>
            )}
          </div>
        </div>
      </div>

      {showCheckpoints && (
        <Popover
          title="Kontrol noktaları"
          popoverRef={checkpointPanelRef}
          role="dialog"
          aria-label="Kontrol noktaları"
        >
          {!state.checkpoints || state.checkpoints.length === 0 ? (
            <div className="px-1 py-1.5 text-xs ahi-text-muted">
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
            className="mt-1 justify-start border-t ahi-border-base"
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
            icon={<Undo2 className="ahi-icon-xs" />}
          >
            {confirmRevert ? 'Geri almayı onayla' : 'Son dosya değişikliğini geri al'}
          </Button>
        </Popover>
      )}
    </header>
  );
};
