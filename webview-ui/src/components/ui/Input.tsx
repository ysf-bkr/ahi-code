import React, { forwardRef } from 'react';
import { cx } from './cx';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  invalid?: boolean;
}

/** Tek satırlık metin girişi. Ham `<input>` yalnızca bu dosyada kullanılır. */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ mono = false, invalid, className, ...rest }, ref) => (
    <input
      ref={ref}
      className={cx('ahi-input', mono && 'ahi-input--mono', className)}
      aria-invalid={invalid ? true : undefined}
      {...rest}
    />
  )
);
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
  invalid?: boolean;
  /** `composer`: kapsayıcının çerçevesini kullanan çıplak mesaj kutusu. */
  variant?: 'field' | 'composer';
  /** Dikey yeniden boyutlandırmayı kapatır. */
  fixed?: boolean;
}

/** Çok satırlı metin girişi. Ham `<textarea>` yalnızca bu dosyada kullanılır. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ mono = false, invalid, variant = 'field', fixed = false, className, ...rest }, ref) => (
    <textarea
      ref={ref}
      className={cx(
        'ahi-textarea',
        variant === 'composer' && 'ahi-textarea--composer',
        mono && 'ahi-textarea--mono',
        fixed && 'ahi-textarea--fixed',
        className
      )}
      aria-invalid={invalid ? true : undefined}
      {...rest}
    />
  )
);
Textarea.displayName = 'Textarea';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  mono?: boolean;
  invalid?: boolean;
}

/** Açılır seçim. Ham `<select>` yalnızca bu dosyada kullanılır. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ mono = false, invalid, className, children, ...rest }, ref) => (
    <select
      ref={ref}
      className={cx('ahi-select', mono && 'ahi-select--mono', className)}
      aria-invalid={invalid ? true : undefined}
      {...rest}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  label: React.ReactNode;
}

/** Etiketiyle birlikte onay kutusu; etiket tıklaması kutuyu değiştirir. */
export const Checkbox: React.FC<CheckboxProps> = ({ label, disabled, ...rest }) => (
  <label className={cx('ahi-check', disabled && 'ahi-check--disabled')}>
    <input type="checkbox" className="ahi-check__box" disabled={disabled} {...rest} />
    <span>{label}</span>
  </label>
);
