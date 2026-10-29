import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from './ui';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Geri düğmesi. Verilmezse başlık yalnızca metin olarak gösterilir. */
  onBack?: () => void;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * Ekran başlığı.
 *
 * Gezinme yan menüden de yapılabilir; ancak ayarlar gibi kaydedilmemiş
 * değişiklik onayı gerektiren ekranlar kendi geri davranışını vermek zorunda.
 * Bu yüzden `onBack` isteğe bağlıdır.
 */
export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ title, subtitle, onBack, icon, actions }) => (
  <header className="ahi-screen-header">
    <div className="ahi-row ahi-fill">
      {onBack && (
        <IconButton label="Geri" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {icon}
      <div className="ahi-screen-header__text">
        <h1 className="ahi-heading ahi-truncate">{title}</h1>
        {subtitle && <p className="ahi-caption ahi-truncate">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="ahi-screen-header__actions">{actions}</div>}
  </header>
);
