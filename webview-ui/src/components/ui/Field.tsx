import React, { useId } from 'react';
import { Search, X } from 'lucide-react';
import { IconButton } from './IconButton';
import { Input, InputProps, Select, SelectProps, Textarea, TextareaProps } from './Input';
import { cx } from './cx';

interface FieldShellProps {
  id: string;
  label?: string;
  hint?: string;
  error?: string;
  labelIcon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}

const FieldShell: React.FC<FieldShellProps> = ({ id, label, hint, error, labelIcon, action, children }) => (
  <div className="ahi-field">
    {(label || action) && (
      <div className="ahi-row ahi-row--between">
        {label && (
          <label htmlFor={id} className="ahi-label ahi-row">
            {labelIcon}
            {label}
          </label>
        )}
        {action}
      </div>
    )}
    {children}
    {error ? <p className="ahi-error-text">{error}</p> : hint ? <p className="ahi-hint">{hint}</p> : null}
  </div>
);

export interface TextFieldProps extends InputProps {
  label?: string;
  hint?: string;
  error?: string;
  labelIcon?: React.ReactNode;
  action?: React.ReactNode;
  /** Girişin içinde sağda gösterilir (ör. görünürlük düğmesi). */
  trailing?: React.ReactNode;
  containerClassName?: string;
}

export const TextField: React.FC<TextFieldProps> = ({
  label,
  hint,
  error,
  labelIcon,
  action,
  trailing,
  id,
  containerClassName,
  ...rest
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const input = <Input id={inputId} invalid={Boolean(error)} {...rest} />;

  return (
    <div className={containerClassName}>
      <FieldShell id={inputId} label={label} hint={hint} error={error} labelIcon={labelIcon} action={action}>
        {trailing ? (
          <div className="ahi-input-group">
            {input}
            <span className="ahi-input-group__action">{trailing}</span>
          </div>
        ) : (
          input
        )}
      </FieldShell>
    </div>
  );
};

export interface SelectFieldProps extends SelectProps {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const SelectField: React.FC<SelectFieldProps> = ({
  label,
  hint,
  error,
  id,
  containerClassName,
  children,
  ...rest
}) => {
  const generatedId = useId();
  const selectId = id || generatedId;

  return (
    <div className={containerClassName}>
      <FieldShell id={selectId} label={label} hint={hint} error={error}>
        <Select id={selectId} invalid={Boolean(error)} {...rest}>
          {children}
        </Select>
      </FieldShell>
    </div>
  );
};

export interface TextareaFieldProps extends TextareaProps {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const TextareaField: React.FC<TextareaFieldProps> = ({
  label,
  hint,
  error,
  id,
  containerClassName,
  ...rest
}) => {
  const generatedId = useId();
  const textareaId = id || generatedId;

  return (
    <div className={containerClassName}>
      <FieldShell id={textareaId} label={label} hint={hint} error={error}>
        <Textarea id={textareaId} invalid={Boolean(error)} {...rest} />
      </FieldShell>
    </div>
  );
};

export interface SearchFieldProps extends Omit<InputProps, 'type' | 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  clearLabel?: string;
}

/** Arama alanı: baştaki simge ve doluyken beliren temizleme düğmesiyle. */
export const SearchField: React.FC<SearchFieldProps> = ({
  value,
  onValueChange,
  clearLabel = 'Aramayı temizle',
  ...rest
}) => (
  <div className={cx('ahi-input-group', 'ahi-input-group--leading')}>
    <span className="ahi-input-group__icon">
      <Search className="ahi-icon-sm" />
    </span>
    <Input type="search" value={value} onChange={(event) => onValueChange(event.target.value)} {...rest} />
    {value && (
      <span className="ahi-input-group__action">
        <IconButton label={clearLabel} small onClick={() => onValueChange('')}>
          <X className="ahi-icon-xs" />
        </IconButton>
      </span>
    )}
  </div>
);
