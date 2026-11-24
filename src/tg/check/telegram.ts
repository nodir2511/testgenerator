// Доступ раздела «Проверка работ» к возможностям Telegram: кнопка «Назад», подтверждения, отклик, защита от закрытия.
// Вне Telegram и на старых клиентах всё работает через запасные варианты.
import { useEffect, useRef } from 'react';

type Cb = () => void;
export interface TgWebApp {
  isVersionAtLeast?(v: string): boolean;
  HapticFeedback?: { impactOccurred(s: string): void; notificationOccurred(s: string): void; selectionChanged?(): void };
  BackButton?: { show(): void; hide(): void; onClick(cb: Cb): void; offClick(cb: Cb): void };
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  enableVerticalSwipes?(): void;
  disableVerticalSwipes?(): void;
  CloudStorage?: {
    getKeys(cb: (err: unknown, keys?: string[]) => void): void;
    getItems(keys: string[], cb: (err: unknown, values?: Record<string, string>) => void): void;
    setItem(key: string, value: string, cb?: (err: unknown, ok?: boolean) => void): void;
    removeItem(key: string, cb?: (err: unknown, ok?: boolean) => void): void;
  };
}

export const wa = (): TgWebApp | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp);

/** Клиент Telegram не старее версии v. Без проверки старый клиент бросает исключение на неизвестном методе */
export function tgAtLeast(v: string, app: TgWebApp | undefined = wa()): boolean {
  try { return !!app?.isVersionAtLeast?.(v); } catch { return false; }
}

const quiet = (f: () => void) => { try { f(); } catch { /* возможность недоступна в этом клиенте */ } };

export const tap = () => quiet(() => wa()?.HapticFeedback?.selectionChanged?.());

// ---------- «Назад» ----------
// Обработчики лежат стопкой: открытое поверх окно (камера, снимок крупно) закрывается первым
const stack: Cb[] = [];
let bound = false;
const onNative = () => stack[stack.length - 1]?.();

export const hasNativeBack = () => !!wa()?.BackButton && tgAtLeast('6.1');

export function pushBack(f: Cb): Cb {
  stack.push(f);
  if (!bound && hasNativeBack()) quiet(() => { wa()!.BackButton!.onClick(onNative); bound = true; });
  if (hasNativeBack()) quiet(() => wa()!.BackButton!.show());
  return () => {
    const i = stack.lastIndexOf(f);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length && bound) quiet(() => { wa()!.BackButton!.offClick(onNative); wa()!.BackButton!.hide(); bound = false; });
  };
}

/** Кнопка «Назад» Telegram ведёт на handler, пока компонент на экране */
export function useBack(handler: Cb) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => pushBack(() => ref.current()), []);
}

// ---------- подтверждение ----------
export function confirmDialog(message: string): Promise<boolean> {
  const app = wa();
  if (app?.showConfirm && tgAtLeast('6.2', app)) {
    return new Promise((resolve) => {
      try { app.showConfirm!(message, (ok) => resolve(!!ok)); } catch { resolve(window.confirm(message)); }
    });
  }
  return Promise.resolve(window.confirm(message));
}

/** Пока в стопке есть несохранённые снимки, Telegram переспрашивает при закрытии приложения */
export function useClosingGuard(on: boolean) {
  useEffect(() => {
    if (!on || !tgAtLeast('6.2')) return;
    quiet(() => wa()?.enableClosingConfirmation?.());
    return () => quiet(() => wa()?.disableClosingConfirmation?.());
  }, [on]);
}

/** Пока открыта камера, смахивание вниз не сворачивает приложение */
export function useNoVerticalSwipes() {
  useEffect(() => {
    if (!tgAtLeast('7.7')) return;
    quiet(() => wa()?.disableVerticalSwipes?.());
    return () => quiet(() => wa()?.enableVerticalSwipes?.());
  }, []);
}
