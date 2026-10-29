import React from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
  icon?: React.ReactNode;
}

/**
 * Erişilebilir anahtar satırı. Tüm görseller index.css'teki `.ahi-toggle-row`
 * ve `.ahi-switch` sınıflarından gelir; böylece işaretleme stil dizilerinden arınmış kalır.
 */
export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, title, description, icon }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={title}
    onClick={() => onChange(!checked)}
    className="ahi-toggle-row"
  >
    {icon && <span className="ahi-toggle-row__icon">{icon}</span>}
    <span className="min-w-0 flex-1">
      <span className="ahi-title block">{title}</span>
      <span className="ahi-caption mt-0.5 block">{description}</span>
    </span>
    <span className={`ahi-switch ${checked ? 'ahi-switch--on' : ''}`} aria-hidden="true">
      <span className="ahi-switch__thumb" />
    </span>
  </button>
);
