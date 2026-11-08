import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePref } from '../hooks/useTheme';
import { IconButton } from './ui';
import { cn } from '../lib/cn';

const OPTIONS: Array<{ id: ThemePref; label: string; icon: typeof Sun }> = [
  { id: 'light', label: 'Светлая', icon: Sun },
  { id: 'dark', label: 'Тёмная', icon: Moon },
  { id: 'system', label: 'Как в системе', icon: Monitor },
];

/** Кнопка в шапке: по нажатию меняет тему по кругу — светлая, тёмная, как в системе */
export function ThemeButton({ className }: { className?: string }) {
  const { pref, setPref } = useTheme();
  const i = OPTIONS.findIndex((o) => o.id === pref);
  const current = OPTIONS[i];
  const next = OPTIONS[(i + 1) % OPTIONS.length];
  return (
    <IconButton
      icon={current.icon}
      label={`Тема: ${current.label.toLowerCase()}. Нажмите, чтобы выбрать «${next.label.toLowerCase()}»`}
      onClick={() => setPref(next.id)}
      className={cn('w-10 h-10 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50', className)}
    />
  );
}

/** Три кнопки выбора темы — для меню на телефоне */
export function ThemeSegmented() {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Тема оформления" className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-2xl">
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={pref === id}
          onClick={() => setPref(id)}
          className={cn(
            'min-h-[44px] rounded-xl text-sm font-semibold flex flex-col items-center justify-center gap-0.5 transition',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            pref === id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600',
          )}
        >
          <Icon className="w-4 h-4" aria-hidden />
          <span className="text-xs">{label}</span>
        </button>
      ))}
    </div>
  );
}
