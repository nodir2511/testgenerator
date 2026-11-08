import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** Общий вид поля ввода: высота 44 px, текст 16 px на телефоне (iOS не приближает страницу при фокусе) */
export const inputClass =
  'w-full min-h-[44px] px-3 text-base sm:text-sm bg-white border border-input rounded-xl text-slate-900 placeholder:text-slate-500 ' +
  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary disabled:bg-slate-50 disabled:text-slate-500';

export const Input = ({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn(inputClass, className)} {...rest} />
);
export const Textarea = ({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cn(inputClass, 'py-2.5 min-h-[88px]', className)} {...rest} />
);

/** Подпись, поле, подсказка и ошибка — вместе. Оборачивает любой input/select */
export function Field({ label, hint, error, required, children, className }: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="block text-sm font-semibold text-slate-800 mb-1">
        {label}{required && <span className="text-destructive" aria-hidden> *</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-xs text-slate-600 mt-1">{hint}</span>}
      {error && <span role="alert" className="block text-xs font-semibold text-destructive-hover mt-1">{error}</span>}
    </label>
  );
}
