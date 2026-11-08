import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'examiner_theme';

const readPref = (): ThemePref => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
};
const systemDark = () => !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;

/** Применяет тему к <html>: класс .dark и цвет строки браузера на телефоне */
export const applyTheme = (pref: ThemePref) => {
  const dark = pref === 'dark' || (pref === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1324' : '#ffffff');
};

/** Выбор темы: светлая (по умолчанию), тёмная или как в системе. Выбор запоминается в браузере */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try { localStorage.setItem(KEY, next); } catch { /* не страшно: тема останется до закрытия вкладки */ }
    applyTheme(next);
  }, []);

  // «Как в системе»: следим за переключением темы в самой системе
  useEffect(() => {
    if (pref !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pref]);

  return { pref, setPref };
}
