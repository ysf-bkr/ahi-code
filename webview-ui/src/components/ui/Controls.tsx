import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'muted' | 'brand' | 'info' | 'success' | 'warning' | 'error';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  mono?: boolean;
  truncate?: boolean;
}

/** Küçük durum/etiket hapı. Renk tonları index.css'teki durum jetonlarından gelir. */
export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  mono = false,
  truncate = false,
  className,
  children,
  ...rest
}) => (
  <span
    className={cx(
      'ahi-badge',
      `ahi-badge--${tone}`,
      mono && 'ahi-badge--mono',
      truncate && 'ahi-badge--truncate',
      className
    )}
    {...rest}
  >
    {children}
  </span>
);

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: React.ReactNode;
  count?: React.ReactNode;
}

/** Seçilebilir hap düğme: filtre ve sıralama kontrolleri. */
export const Chip: React.FC<ChipProps> = ({
  active = false,
  icon,
  count,
  className,
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    aria-pressed={active}
    className={cx('ahi-chip', active && 'ahi-chip--active', className)}
    {...rest}
  >
    {icon}
    <span>{children}</span>
    {count !== undefined && <span className="ahi-chip__count">{count}</span>}
  </button>
);

export interface LinkButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Renk devralınır; yalnızca üzerine gelince alt çizgi çıkar. */
  plain?: boolean;
}

/** Metin gibi görünen düğme: e-posta, dosya yolu gibi bağlantılar. */
export const LinkButton: React.FC<LinkButtonProps> = ({
  plain = false,
  className,
  children,
  type = 'button',
  ...rest
}) => (
  <button type={type} className={cx('ahi-link', plain && 'ahi-link--plain', className)} {...rest}>
    {children}
  </button>
);

export interface ListButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  active?: boolean;
  /** `flat`: çerçevesiz satır (akordeon başlığı, açılır liste girdisi). */
  flat?: boolean;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
}

/** Tıklanabilir liste satırı/kartı. */
export const ListButton: React.FC<ListButtonProps> = ({
  active = false,
  flat = false,
  icon,
  title,
  description,
  trailing,
  className,
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    title={typeof title === 'string' ? title : undefined}
    className={cx(
      'ahi-list-item',
      flat && 'ahi-list-item--flat',
      active && 'ahi-list-item--active',
      className
    )}
    {...rest}
  >
    {children ?? (
      <>
        {icon && <span className="ahi-toggle-row__icon shrink-0">{icon}</span>}
        {(title || description) && (
          <span className="min-w-0 flex-1 text-left">
            {title && <span className="ahi-title block truncate">{title}</span>}
            {description && <span className="ahi-caption block truncate">{description}</span>}
          </span>
        )}
        {trailing && <span className="shrink-0">{trailing}</span>}
      </>
    )}
  </button>
);

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  label?: string;
  'aria-label'?: string;
  value: T;
  options?: Array<SegmentedOption<T>>;
  items?: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  disabledTitle?: string;
}

/** Bölümlü denetim: birbirini dışlayan az sayıda seçenek (ör. görev modu). */
export function Segmented<T extends string>({
  label,
  'aria-label': ariaLabel,
  value,
  options,
  items,
  onChange,
  disabled = false,
  disabledTitle
}: SegmentedProps<T>): React.ReactElement {
  const list = options ?? items ?? [];
  return (
    <div role="group" aria-label={label ?? ariaLabel ?? 'Seçenekler'} className="ahi-segmented">
      {list.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          disabled={disabled}
          aria-pressed={value === option.id}
          title={disabled && disabledTitle ? disabledTitle : (option.title ?? option.label)}
          className={cx('ahi-segmented__item', value === option.id && 'ahi-segmented__item--active')}
        >
          {option.icon}
          <span className="ahi-segmented__label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export interface IconPickerProps<T extends string> {
  'aria-label': string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  disabledTitle?: string;
}

/**
 * İkon öncelikli seçici: kapalıyken yalnızca seçili seçeneğin ikonu görünür
 * (besteci çubuğu etiket metinleriyle şişmez), tıklanınca etiketli menü yukarı
 * açılır. Dışarı tıklama ve Escape menüyü kapatır; seçim yapınca kapanır.
 */
export function IconPicker<T extends string>({
  'aria-label': ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  disabledTitle
}: IconPickerProps<T>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = options.find((option) => option.id === value) ?? options[0];
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current ? `${ariaLabel}: ${current.label}` : ariaLabel}
        title={disabled && disabledTitle ? disabledTitle : (current?.title ?? current?.label)}
        disabled={disabled}
        onClick={() => setOpen((isOpen) => !isOpen)}
        className="flex items-center gap-1 rounded-md border ahi-border-surface px-2 py-1 ahi-text-fg hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {current?.icon}
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute bottom-full left-0 z-40 mb-1 min-w-[200px] rounded-md border ahi-border-base ahi-bg-surface p-1 shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              title={option.title ?? option.label}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
              className={cx(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:opacity-80',
                option.id === value ? 'ahi-bg-brand-soft ahi-text-brand font-medium' : 'ahi-text-fg'
              )}
            >
              {option.icon}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface NavButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  expanded: boolean;
  active?: boolean;
  badge?: number;
}

/** Yan menü öğesi: daralmışken yalnızca simge, genişken simge + başlık. */
export const NavButton: React.FC<NavButtonProps> = ({
  icon,
  label,
  expanded,
  active = false,
  badge,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    aria-current={active ? 'page' : undefined}
    className={cx('ahi-nav__item', active && 'ahi-nav__item--active')}
    {...rest}
  >
    <span className="ahi-nav__icon">
      {icon}
      {badge ? <span className="ahi-nav__badge">{badge}</span> : null}
    </span>
    {expanded && <span className="ahi-nav__label">{label}</span>}
  </button>
);

export interface DisclosureProps {
  title?: React.ReactNode;
  summary?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  /** `plain`: çerçevesiz, `card`: dolgulu yüzey, `dashed`: kesikli çerçeve. */
  variant?: 'plain' | 'card' | 'dashed';
  className?: string;
  children: React.ReactNode;
}

/** Açılır bölüm. Ham `<details>/<summary>` yalnızca bu dosyada kullanılır. */
export const Disclosure: React.FC<DisclosureProps> = ({
  title,
  summary,
  icon,
  defaultOpen = false,
  variant = 'plain',
  className,
  children
}) => (
  <details
    open={defaultOpen || undefined}
    className={cx(
      'ahi-disclosure',
      variant === 'card' && 'ahi-disclosure--card',
      variant === 'dashed' && 'ahi-disclosure--dashed',
      className
    )}
  >
    <summary className="ahi-disclosure__summary">
      <ChevronRight className="ahi-icon-xs ahi-disclosure__chevron" aria-hidden="true" />
      {icon}
      {title ?? summary}
    </summary>
    <div className="ahi-disclosure__body">{children}</div>
  </details>
);
