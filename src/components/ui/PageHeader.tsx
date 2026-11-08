import type { ComponentType, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Заголовок раздела: одинаковый на всех страницах. title → «что это», description → «что здесь делать» */
export function PageHeader({ title, description, icon: Icon, actions, className }: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** Главные кнопки раздела (справа; на телефоне — под заголовком) */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 px-1', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <div className="w-10 h-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight tracking-tight">{title}</h2>
          {description && <p className="text-sm text-slate-600 mt-1 leading-relaxed">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
