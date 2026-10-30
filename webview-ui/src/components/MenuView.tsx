import React from 'react';
import { Bot, ChevronRight, FileDiff, History, Info, Server, Settings, X, MessageSquare } from 'lucide-react';
import { NavigationDestination } from '@shared/types';
import { Badge, IconButton, ListButton } from './ui';

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
    icon: <MessageSquare className="ahi-icon-md ahi-text-brand" />,
    category: 'workspace'
  },
  {
    id: 'changes',
    title: 'Değişiklikler',
    description: 'Görev dosyalarını ve Git durumunu incele',
    icon: <FileDiff className="ahi-icon-md ahi-text-warning" />,
    category: 'workspace'
  },
  {
    id: 'history',
    title: 'Görev geçmişi',
    description: 'Önceki sohbetleri görüntüle ve devam et',
    icon: <History className="ahi-icon-md ahi-text-brand" />,
    category: 'workspace'
  },
  {
    id: 'agents',
    title: 'Ajanlar ve beceriler',
    description: '13 uzman alt ajan ve proje yönergeleri',
    icon: <Bot className="ahi-icon-md ahi-text-success" />,
    category: 'ai'
  },
  {
    id: 'mcp',
    title: 'MCP sunucuları',
    description: 'Bağlantıları ve araçları yönet',
    icon: <Server className="ahi-icon-md ahi-text-info" />,
    category: 'ai'
  },
  {
    id: 'settings',
    title: 'Ayarlar',
    description: 'Model, onaylar ve çalışma tercihleri',
    icon: <Settings className="ahi-icon-md ahi-text-brand" />,
    category: 'system'
  },
  {
    id: 'about',
    title: 'Hakkında',
    description: 'Sürüm, tanılama ve proje bilgileri',
    icon: <Info className="ahi-icon-md ahi-text-muted" />,
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
    className="flex h-full w-full flex-col overflow-hidden ahi-text-fg"
  >
    {/* Panel Başlığı */}
    <div className="flex shrink-0 items-center justify-between border-b ahi-border-base ahi-bg-section px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="ahi-overline">Gezinti ve Ayarlar</span>
      </div>
      {onClose && (
        <IconButton label="Kapat" onClick={onClose}>
          <X className="ahi-icon-sm" />
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
            <div className="px-2 ahi-overline ahi-text-muted opacity-80">{cat.label}</div>
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
                      <span className="flex items-center gap-1.5 font-medium ahi-text-fg">
                        {item.title}
                        {item.id === 'changes' && changedFileCount > 0 && (
                          <Badge tone="brand" mono>
                            {changedFileCount}
                          </Badge>
                        )}
                      </span>
                    }
                    description={item.description}
                    trailing={<ChevronRight className="ahi-icon-sm shrink-0 ahi-text-muted opacity-60" />}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>

    {/* Alt Bilgi */}
    <div className="shrink-0 border-t ahi-border-base ahi-soft-card px-3 py-2 text-2xs ahi-text-muted">
      <div className="flex items-center justify-between">
        <span>AhiCode</span>
        <span className="font-mono">
          v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.1'}
        </span>
      </div>
    </div>
  </div>
);
