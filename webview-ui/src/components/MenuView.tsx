import React from 'react';
import { Bot, ChevronRight, FileDiff, History, Info, Server, Settings, X, MessageSquare } from 'lucide-react';
import { NavigationDestination } from '@shared/types';
import { IconButton, ListButton } from './ui';

export type MenuDestination = NavigationDestination;

interface MenuViewProps {
  onSelect: (destination: NavigationDestination) => void;
  changedFileCount: number;
  activeDestination?: string;
  onClose?: () => void;
}

interface MenuItem {
  id: NavigationDestination;
  title: string;
  description: string;
  icon: React.ReactNode;
  category: 'workspace' | 'ai' | 'system';
}

const MENU_ITEMS: MenuItem[] = [
  {
    id: 'chat',
    title: 'Sohbet',
    description: 'Ana asistan çalışma alanı',
    icon: <MessageSquare className="h-4 w-4 text-[var(--ahi-brand-400)]" />,
    category: 'workspace'
  },
  {
    id: 'changes',
    title: 'Değişiklikler',
    description: 'Görev dosyalarını ve Git durumunu incele',
    icon: <FileDiff className="h-4 w-4 text-amber-400" />,
    category: 'workspace'
  },
  {
    id: 'history',
    title: 'Görev geçmişi',
    description: 'Önceki sohbetleri görüntüle ve devam et',
    icon: <History className="h-4 w-4 text-sky-400" />,
    category: 'workspace'
  },
  {
    id: 'agents',
    title: 'Ajanlar ve beceriler',
    description: '13 uzman alt ajan ve proje yönergeleri',
    icon: <Bot className="h-4 w-4 text-emerald-400" />,
    category: 'ai'
  },
  {
    id: 'mcp',
    title: 'MCP sunucuları',
    description: 'Bağlantıları ve araçları yönet',
    icon: <Server className="h-4 w-4 text-violet-400" />,
    category: 'ai'
  },
  {
    id: 'settings',
    title: 'Ayarlar',
    description: 'Model, onaylar ve çalışma tercihleri',
    icon: <Settings className="h-4 w-4 text-[var(--ahi-brand-400)]" />,
    category: 'system'
  },
  {
    id: 'about',
    title: 'Hakkında',
    description: 'Sürüm, tanılama ve proje bilgileri',
    icon: <Info className="h-4 w-4 text-[var(--ahi-muted-fg)]" />,
    category: 'system'
  }
];

const CATEGORIES: Array<{ key: 'workspace' | 'ai' | 'system'; label: string }> = [
  { key: 'workspace', label: 'Çalışma Alanı' },
  { key: 'ai', label: 'Yapay Zekâ ve Beceriler' },
  { key: 'system', label: 'Yapılandırma' }
];

export const MenuView: React.FC<MenuViewProps> = ({
  onSelect,
  changedFileCount,
  activeDestination = 'chat',
  onClose
}) => (
  <div
    role="menu"
    aria-label="Sohbet menüsü"
    className="flex h-full w-full flex-col overflow-hidden text-[var(--vscode-sideBar-foreground)]"
  >
    {/* Panel Başlığı */}
    <div className="flex shrink-0 items-center justify-between border-b border-[var(--vscode-sideBar-border)] px-3 py-2.5 bg-[var(--vscode-sideBarSectionHeader-background,var(--vscode-sideBar-background))]">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ahi-muted-fg)]">
          Gezinti ve Ayarlar
        </span>
      </div>
      {onClose && (
        <IconButton label="Kapat" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </div>

    {/* Menü Listesi */}
    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
      {CATEGORIES.map((cat) => {
        const items = MENU_ITEMS.filter((item) => item.category === cat.key);
        if (items.length === 0) return null;

        return (
          <div key={cat.key} className="space-y-1">
            <div className="px-2 text-2xs font-semibold uppercase tracking-wider text-[var(--ahi-muted-fg)] opacity-80">
              {cat.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {items.map((item) => {
                const isActive = activeDestination === item.id;
                return (
                  <ListButton
                    key={item.id}
                    role="menuitem"
                    onClick={() => onSelect(item.id)}
                    active={isActive}
                    icon={item.icon}
                    title={
                      <span className="flex items-center gap-1.5 font-medium text-[var(--ahi-fg)]">
                        {item.title}
                        {item.id === 'changes' && changedFileCount > 0 && (
                          <span className="ahi-badge bg-[var(--ahi-brand-500)] font-mono text-white">
                            {changedFileCount}
                          </span>
                        )}
                      </span>
                    }
                    description={item.description}
                    trailing={
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ahi-muted-fg)] opacity-60" />
                    }
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>

    {/* Alt Bilgi */}
    <div className="shrink-0 border-t border-[var(--vscode-sideBar-border)] bg-[var(--ahi-surface-subtle)] px-3 py-2 text-2xs text-[var(--ahi-muted-fg)]">
      <div className="flex items-center justify-between">
        <span>AhiCode</span>
        <span className="font-mono">
          v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.1'}
        </span>
      </div>
    </div>
  </div>
);
