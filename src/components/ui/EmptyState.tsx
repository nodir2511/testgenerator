import type { ComponentType, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Пустой экран: что это за место, почему тут пусто и что сделать дальше */
export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center text-center gap-2 py-10 px-4', className)}>
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mb-1">
          <Icon className="w-7 h-7" />
        </div>
      )}
      <h3 className="font-bold text-slate-900 text-base">{title}</h3>
      {description && <p className="text-sm text-slate-600 max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
