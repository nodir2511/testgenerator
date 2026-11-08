import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  primary: 'bg-primary-soft text-primary-ink border-indigo-200',
  success: 'bg-success-soft text-success border-success-line',
  warning: 'bg-warning-soft text-warning border-warning-line',
  danger: 'bg-destructive-soft text-destructive-hover border-destructive-line',
  info: 'bg-info-soft text-info border-info-line',
};

/** Метка-статус: тип вопроса, роль, «Откачено»… Текст не мельче 12 px */
export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold leading-5', TONE[tone], className)}
      {...rest}
    />
  );
}
