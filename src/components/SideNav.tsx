import type { ComponentType } from 'react';
import { ChevronsLeft, ChevronsRight, ExternalLink } from 'lucide-react';
import { cn } from '../lib/cn';

export interface SideNavItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Открывается в новой вкладке (например, «Своя игра») */
  external?: boolean;
}
export interface SideNavGroup { title: string; items: SideNavItem[] }

/** Боковая навигация для широких экранов: разделы сгруппированы по смыслу, панель сворачивается до иконок */
export function SideNav({ groups, activeId, onSelect, collapsed, onToggle }: {
  groups: SideNavGroup[];
  activeId: string;
  onSelect: (item: SideNavItem) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={cn(
        'hidden xl:flex flex-col shrink-0 sticky top-16 self-start h-[calc(100vh-4rem)] overflow-y-auto',
        'border-r border-slate-200/80 bg-white/60 py-4 transition-[width] duration-200',
        collapsed ? 'w-[4.75rem] px-2' : 'w-64 px-3',
      )}
    >
      <nav aria-label="Разделы" className="flex-1 space-y-5">
        {groups.map((g) => (
          <div key={g.title}>
            {collapsed
              ? <div className="mx-3 mb-2 border-t border-slate-200 first:hidden" aria-hidden />
              : <div className="px-3 pb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">{g.title}</div>}
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = item.icon;
                const active = item.id === activeId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      aria-current={active ? 'page' : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        'relative w-full min-h-[44px] flex items-center gap-3 rounded-xl text-sm font-semibold transition',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        collapsed ? 'justify-center px-0' : 'px-3 text-left',
                        active ? 'bg-primary-soft text-primary-ink' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                      )}
                    >
                      {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-primary" aria-hidden />}
                      <Icon className={cn('w-5 h-5 shrink-0', active ? 'text-primary' : 'text-slate-500')} />
                      {!collapsed && <span className="flex-1 min-w-0 truncate">{item.label}</span>}
                      {!collapsed && item.external && <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        className={cn(
          'mt-4 min-h-[44px] flex items-center gap-3 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          collapsed ? 'justify-center' : 'px-3',
        )}
      >
        {collapsed ? <ChevronsRight className="w-5 h-5" /> : <><ChevronsLeft className="w-5 h-5 text-slate-500" /><span>Свернуть меню</span></>}
      </button>
    </aside>
  );
}
