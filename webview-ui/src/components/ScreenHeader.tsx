import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Menu as MenuIcon } from 'lucide-react';
import { NavigationDestination } from '@shared/types';
import { Drawer, IconButton } from './ui';
import { MenuView } from './MenuView';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Geri düğmesi. Verilmezse başlık yalnızca metin olarak gösterilir. */
  onBack?: () => void;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
  /** Menüde aktif gösterilecek ekran; açılmayan menü yanlış "Sohbet"i işaret etmesin. */
  activeDestination?: NavigationDestination;
}

/**
 * Ekran başlığı.
 *
 * Her alt görünümün en üstünde yer alır. Sol tarafta tek bir standart geri ok
 * simgesi (←) ile sohbete/önceki ekrana dönülmesini, sağ tarafta ekran eylemleri
 * ve gezinti menüsünü barındırır.
 */
export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  subtitle,
  onBack,
  icon,
  actions,
  onSelectMenu,
  changedFileCount = 0,
  activeDestination
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current && !menuRef.current.contains(event.target)) setShowMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMenu(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showMenu]);

  return (
    <header className="ahi-screen-header">
      <div className="ahi-row ahi-fill">
        {onBack && (
          <IconButton label="Geri dön" onClick={onBack}>
            <ArrowLeft className="ahi-icon-sm" />
          </IconButton>
        )}
        {icon}
        <div className="ahi-screen-header__text">
          <h1 className="ahi-heading ahi-truncate">{title}</h1>
          {subtitle && <p className="ahi-caption ahi-truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="ahi-screen-header__actions">
        {actions}
        {onSelectMenu && (
          <div className="relative">
            <IconButton
              label="Menüyü aç"
              active={showMenu}
              onClick={() => setShowMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={showMenu}
            >
              <MenuIcon className="ahi-icon-sm" />
            </IconButton>
            {showMenu && (
              <Drawer onClose={() => setShowMenu(false)} drawerRef={menuRef}>
                <MenuView
                  changedFileCount={changedFileCount}
                  activeDestination={activeDestination}
                  onSelect={(destination) => {
                    setShowMenu(false);
                    onSelectMenu(destination);
                  }}
                  onClose={() => setShowMenu(false)}
                />
              </Drawer>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
