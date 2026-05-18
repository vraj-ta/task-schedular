import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/* ===========================================================================
   Form + button primitives. Thin wrappers around native elements that apply
   the design-system class names; props pass through so callers can attach
   refs, event handlers, aria-* etc.
   =========================================================================== */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', iconLeft, iconRight, loading, block, className, children, disabled, ...rest }, ref) => {
    const classes = [
      'btn',
      `btn-${variant}`,
      size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '',
      block ? 'btn-block' : '',
      className,
    ].filter(Boolean).join(' ');
    return (
      <button ref={ref} className={classes} disabled={disabled || loading} {...rest}>
        {loading ? <span className="spinner" /> : iconLeft}
        {children && <span>{children}</span>}
        {!loading && iconRight}
      </button>
    );
  },
);
Button.displayName = 'Button';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', label, className, children, ...rest }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={['btn', `btn-${variant}`, 'btn-icon', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = 'IconButton';

interface FieldShellProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export const Field = ({ label, hint, error, required, children }: FieldShellProps) => (
  <div className={['field', error ? 'invalid' : ''].filter(Boolean).join(' ')}>
    {label && (
      <label className="field-label">
        {label}
        {required && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>*</span>}
      </label>
    )}
    {children}
    {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
  </div>
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ leadingIcon, className, ...rest }, ref) => {
    if (leadingIcon) {
      return (
        <div className="input-group">
          <span className="input-leading-icon">{leadingIcon}</span>
          <input ref={ref} className={['input', className].filter(Boolean).join(' ')} {...rest} />
        </div>
      );
    }
    return <input ref={ref} className={['input', className].filter(Boolean).join(' ')} {...rest} />;
  },
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...rest }, ref) => (
    <select ref={ref} className={['select', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...rest }, ref) => (
    <textarea ref={ref} className={['textarea', className].filter(Boolean).join(' ')} {...rest} />
  ),
);
Textarea.displayName = 'Textarea';

/* ---- Badge ---- */
type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';
export const Badge = ({ tone = 'neutral', children, dot }: { tone?: BadgeTone; children: ReactNode; dot?: boolean }) => (
  <span className={`badge badge-${tone}`}>
    {dot && <span className="badge-dot" style={{ background: 'currentColor' }} />}
    {children}
  </span>
);

/* ---- Card ---- */
export const Card = ({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) => (
  <div className={['card', padded ? 'card-pad' : '', className].filter(Boolean).join(' ')}>{children}</div>
);

export const CardSection = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <div className="card">
    <div className="card-header">
      <h2>{title}</h2>
      {action}
    </div>
    <div className="card-body">{children}</div>
  </div>
);

/* ---- Banner ---- */
type BannerTone = 'info' | 'success' | 'warning' | 'error';
export const Banner = ({ tone = 'info', icon, children }: { tone?: BannerTone; icon?: ReactNode; children: ReactNode }) => (
  <div className={`banner banner-${tone}`}>
    {icon && <span className="banner-icon">{icon}</span>}
    <div className="banner-body">{children}</div>
  </div>
);

/* ---- Spinner ---- */
export const Spinner = ({ size }: { size?: 'sm' | 'lg' }) => (
  <span className={size === 'lg' ? 'spinner spinner-lg' : 'spinner'} />
);
