import React from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
  icon?: React.ReactNode;
}

/**
 * Accessible switch row. All visuals come from `.ahi-toggle-row` and
 * `.ahi-switch` in index.css so the markup stays free of style strings.
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
