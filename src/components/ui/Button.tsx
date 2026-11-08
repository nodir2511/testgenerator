import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

type Icon = ComponentType<{ className?: string }>;
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-soft' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
  danger: 'bg-destructive text-destructive-foreground hover:bg-destructive-hover shadow-sm',
  'danger-soft': 'bg-destructive-soft text-destructive border border-destructive-line hover:bg-red-100',
  ghost: 'text-slate-700 hover:bg-slate-100',
};
// Высота — не меньше 40 px: на телефоне по кнопке должно быть легко попасть пальцем
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-[40px] px-3.5 text-sm gap-1.5',
  md: 'min-h-[44px] px-4 text-sm gap-2',
  lg: 'min-h-[52px] px-5 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: Icon;
  /** Показывает спиннер вместо иконки и блокирует кнопку */
  loading?: boolean;
  children?: ReactNode;
}

/** Единая кнопка сайта. Подпись всегда текстом; только-иконка — это IconButton */
export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-semibold transition active:scale-[0.98] select-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANT[variant], SIZE[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : Icon && <Icon className="w-4 h-4 shrink-0" />}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'size'> {
  icon: Icon;
  /** Обязательная подпись: читается экранным диктором и показывается подсказкой */
  label: string;
}

/** Кнопка-иконка 44×44 с обязательной подписью (aria-label + title) */
export function IconButton({ icon: Icon, label, variant = 'ghost', loading, disabled, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 transition active:scale-95',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:opacity-40 disabled:pointer-events-none',
        variant === 'ghost' ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900' : VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
    </button>
  );
}
