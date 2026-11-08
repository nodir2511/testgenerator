import { supabase, isSupabaseConfigured } from './supabase';

// Отправка необработанных ошибок интерфейса в журнал public.client_errors (см. supabase/sql/client_errors.sql).
// Ограничения: не больше 5 разных ошибок за сеанс, одинаковые не повторяются, сбой отправки молча игнорируется.

const MAX_PER_SESSION = 5;
const seen = new Set<string>();

// Шум, который не является ошибкой сайта
const IGNORED = [/ResizeObserver loop/i, /Script error\.?$/i, /Loading chunk .* failed/i, /Failed to fetch dynamically imported module/i];

export function reportError(err: unknown, context = ''): void {
  try {
    if (!isSupabaseConfigured || seen.size >= MAX_PER_SESSION) return;
    const e = err as { message?: string; stack?: string } | string | null;
    const message = (typeof e === 'string' ? e : e?.message) || 'Неизвестная ошибка';
    if (IGNORED.some((re) => re.test(message))) return;
    const key = message.slice(0, 200);
    if (seen.has(key)) return;
    seen.add(key);
    const stack = typeof e === 'object' && e ? e.stack : undefined;
    void supabase
      .rpc('report_client_error', {
        p_message: context ? `[${context}] ${message}` : message,
        p_stack: stack ?? null,
        p_url: window.location.pathname,
        p_version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null,
      })
      .then(() => undefined, () => undefined);
  } catch {
    /* отчёт об ошибке не должен сам ронять сайт */
  }
}

export function installGlobalErrorReporting(): void {
  window.addEventListener('error', (ev) => reportError(ev.error ?? ev.message, 'window'));
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason, 'promise'));
}
