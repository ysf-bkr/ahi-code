import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Bot, FileDiff, History, Info, MessageSquare, Server, Settings } from 'lucide-react';
import { NavigationDestination } from '@shared/types';
import { NavButton } from './ui';

export interface NavigationSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  activeDestination: NavigationDestination;
  onSelect: (destination: NavigationDestination) => void;
  changedFileCount: number;
}

interface NavItem {
  id: NavigationDestination;
  title: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'chat', title: 'Sohbet', icon: <MessageSquare className="ahi-icon-md" /> },
  { id: 'changes', title: 'Değişiklikler', icon: <FileDiff className="ahi-icon-md" /> },
  { id: 'history', title: 'Görev Geçmişi', icon: <History className="ahi-icon-md" /> },
  { id: 'agents', title: 'Ajanlar & Beceriler', icon: <Bot className="ahi-icon-md" /> },
  { id: 'mcp', title: 'MCP Sunucuları', icon: <Server className="ahi-icon-md" /> },
  { id: 'settings', title: 'Ayarlar', icon: <Settings className="ahi-icon-md" /> },
  { id: 'about', title: 'Hakkında', icon: <Info className="ahi-icon-md" /> }
];

/**
 * Sabit gezinme çubuğu. Daralmışken yalnızca simge gösterir; genişken başlıkları
 * da gösterir. Dar ekranda (<480px) genişleyen panel içeriği ezmek yerine üstüne biner.
 */
export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  isOpen,
  onToggle,
  activeDestination,
  onSelect,
  changedFileCount
}) => (
  <aside aria-label="Sabit yan menü" className={`ahi-nav ${isOpen ? 'ahi-nav--open' : ''}`}>
    <div className="ahi-nav__panel">
      <nav className="ahi-nav__list">
        {NAV_ITEMS.map((item) => {
          const showBadge = item.id === 'changes' && changedFileCount > 0;
          return (
            <NavButton
              key={item.id}
              icon={item.icon}
              label={item.title}
              expanded={isOpen}
              active={activeDestination === item.id}
              badge={showBadge ? changedFileCount : undefined}
              title={`${item.title}${showBadge ? ` (${changedFileCount} dosya)` : ''}`}
              onClick={() => onSelect(item.id)}
            />
          );
        })}
      </nav>

      <div className="ahi-nav__footer">
        <NavButton
          icon={isOpen ? <ChevronRight className="ahi-icon-sm" /> : <ChevronLeft className="ahi-icon-sm" />}
          label="Menüyü daralt"
          expanded={isOpen}
          title={isOpen ? 'Menüyü daralt (sabit ikon moduna geç)' : 'Menüyü genişlet'}
          aria-label={isOpen ? 'Menüyü daralt' : 'Menüyü genişlet'}
          onClick={onToggle}
        />
      </div>
    </div>
  </aside>
);
