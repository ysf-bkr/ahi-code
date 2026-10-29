import React from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'xs';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** İçeriği sola yaslar (menü benzeri tam genişlik düğmeler için). */
  start?: boolean;
  icon?: React.ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'ahi-btn--primary',
  secondary: 'ahi-btn--secondary',
  ghost: 'ahi-btn--ghost',
  danger: 'ahi-btn--danger'
};

/**
 * Webview'daki tek düğme ilkeli. Görsel biçim index.css'te yaşar;
 * çağıran yalnızca anlamsal bir varyant seçer.
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'sm',
  block = false,
  start = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    className={cx(
      'ahi-btn',
      variantClass[variant],
      size === 'xs' && 'ahi-btn--xs',
      block && 'ahi-btn--block',
      start && 'ahi-btn--start',
      className
    )}
    {...rest}
  >
    {icon}
    {children}
  </button>
);
