import React from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label, also used as the tooltip. */
  label: string;
  active?: boolean;
  small?: boolean;
  children: React.ReactNode;
}

/**
 * Square, icon-only button used in headers and toolbars.
 */
export const IconButton: React.FC<IconButtonProps> = ({
  label,
  active = false,
  small = false,
  className = '',
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    title={label}
    aria-label={label}
    aria-pressed={active || undefined}
    className={[
      'ahi-icon-btn',
      small ? 'ahi-icon-btn--sm' : '',
      active ? 'ahi-icon-btn--active' : '',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...rest}
  >
    {children}
  </button>
);
