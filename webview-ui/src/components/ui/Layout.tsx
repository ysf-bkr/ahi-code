import React from 'react';
import { cx } from './cx';

export interface ScreenProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/** Tam yükseklikli ekran kabuğu: başlık + kaydırılabilir gövde. */
export const Screen: React.FC<ScreenProps> = ({ className, children, ...rest }) => (
  <div className={cx('ahi-screen', className)} {...rest}>
    {children}
  </div>
);

/** Kaydırılabilir ekran gövdesi; geniş alanda içerik okunabilir sütunda ortalanır. */
export const ScreenBody: React.FC<ScreenProps> = ({ className, children, ...rest }) => (
  <div className={cx('ahi-screen-body', className)} {...rest}>
    {children}
  </div>
);

export const Stack: React.FC<ScreenProps> = ({ className, children, ...rest }) => (
  <div className={cx('ahi-stack', className)} {...rest}>
    {children}
  </div>
);

export interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  between?: boolean;
  wrap?: boolean;
}

export const Row: React.FC<RowProps> = ({ between = false, wrap = false, className, children, ...rest }) => (
  <div className={cx('ahi-row', between && 'ahi-row--between', wrap && 'ahi-row--wrap', className)} {...rest}>
    {children}
  </div>
);

/** Geniş ekranda sütunlara bölünen, dar ekranda tek sütun olan kart ızgarası. */
export const Grid: React.FC<ScreenProps> = ({ className, children, ...rest }) => (
  <div className={cx('ahi-grid', className)} {...rest}>
    {children}
  </div>
);

export interface KeyValueProps {
  label: string;
  children: React.ReactNode;
}

export const KeyValue: React.FC<KeyValueProps> = ({ label, children }) => (
  <div className="ahi-kv">
    <span className="ahi-kv__key">{label}</span>
    <span className="ahi-kv__value">{children}</span>
  </div>
);

export interface BackdropProps {
  onClose: () => void;
}

/** Açık katmanın arkasındaki karartma; tıklayınca katman kapanır. */
export const Backdrop: React.FC<BackdropProps> = ({ onClose }) => (
  <div className="ahi-backdrop" onClick={onClose} aria-hidden="true" />
);

export interface DrawerProps extends React.HTMLAttributes<HTMLDivElement> {
  onClose: () => void;
  drawerRef?: React.Ref<HTMLDivElement>;
}

/** Sağdan açılan yan sayfa (karartmayla birlikte). */
export const Drawer: React.FC<DrawerProps> = ({ onClose, drawerRef, children, ...rest }) => (
  <>
    <Backdrop onClose={onClose} />
    <div ref={drawerRef} className="ahi-drawer" {...rest}>
      {children}
    </div>
  </>
);

export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  popoverRef?: React.Ref<HTMLDivElement>;
}

/** Başlığın altında açılan küçük panel. */
export const Popover: React.FC<PopoverProps> = ({ title, popoverRef, children, ...rest }) => (
  <div ref={popoverRef} className="ahi-popover" {...rest}>
    {title && <div className="ahi-popover__title">{title}</div>}
    {children}
  </div>
);
