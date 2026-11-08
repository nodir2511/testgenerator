// Своё окно подтверждения вместо системного confirm(): понятный заголовок, последствия списком
// и кнопки с глаголами («Удалить главу» / «Оставить»). Использование: if (!(await confirmAction({...}))) return;

export interface ConfirmOptions {
  title: string;
  /** Пояснение: что произойдёт после подтверждения */
  message?: string;
  /** Что именно будет затронуто — короткий список («3 темы», «142 вопроса») */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger — необратимое действие (красная кнопка), default — обычное */
  tone?: 'danger' | 'default';
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

type Listener = (req: ConfirmRequest) => void;

let listener: Listener | null = null;
let nextId = 0;

/** Окно подключает себя при показе страницы; возвращает функцию отключения */
export function registerConfirmHost(fn: Listener): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (listener) {
      listener({ ...opts, id: ++nextId, resolve });
      return;
    }
    // Окно ещё не подключено (не должно случаться) — не теряем подтверждение, спрашиваем системным
    const text = [opts.title, opts.message, ...(opts.details ?? [])].filter(Boolean).join('\n');
    resolve(typeof globalThis.confirm === 'function' ? globalThis.confirm(text) : false);
  });
}
