import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Pad = 'none' | 'sm' | 'md' | 'lg';
const PAD: Record<Pad, string> = { none: '', sm: 'p-3', md: 'p-4 sm:p-5', lg: 'p-5 sm:p-6' };

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article';
  padding?: Pad;
  /** Подсветка рамки по смыслу (например, успех после генерации) */
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  /** Реагирует на наведение — для кликабельных карточек */
  interactive?: boolean;
}

const TONE = {
  default: 'border-slate-200',
  primary: 'border-indigo-200 bg-primary-soft/60',
  success: 'border-success-line',
  warning: 'border-warning-line bg-warning-soft/60',
  danger: 'border-destructive-line bg-destructive-soft/60',
};

/** Единая белая карточка: один радиус, одна рамка, одна тень */
export function Card({ as: Tag = 'div', padding = 'md', tone = 'default', interactive, className, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        'bg-card rounded-card border shadow-[0_1px_3px_rgba(15,23,42,0.05)]',
        interactive && 'transition hover:border-indigo-200 hover:shadow-md',
        TONE[tone], PAD[padding], className,
      )}
      {...rest}
    />
  );
}

/** Заголовок блока внутри карточки: «1. Предмет», «Активность»… */
export function CardTitle({ icon: Icon, children, action, className }: { icon?: React.ComponentType<{ className?: string }>; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <h3 className="font-bold text-slate-900 text-base flex items-center gap-2 min-w-0">
        {Icon && <Icon className="w-4 h-4 text-primary shrink-0" />}
        <span className="min-w-0">{children}</span>
      </h3>
      {action}
    </div>
  );
}
