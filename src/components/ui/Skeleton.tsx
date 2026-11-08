import { cn } from '../../lib/cn';

/** Серая заглушка вместо спиннера: показывает форму будущего содержимого */
export const Skeleton = ({ className }: { className?: string }) => (
  <div aria-hidden className={cn('animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none', className)} />
);

/** Заглушка списка карточек */
export const SkeletonList = ({ rows = 3 }: { rows?: number }) => (
  <div className="space-y-3" role="status" aria-label="Загрузка">
    {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}
  </div>
);
