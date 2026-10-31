import React from 'react';

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
