// Запрет копирования на странице билета: какие действия считать попыткой и как часто о них сообщать. Без React и браузера.
//
// Мини-приложение Telegram — обычная веб-страница: запретить снимок экрана или запись экрана она не может
// (в Telegram Mini Apps такой настройки нет, в отличие от «запрета копирования» у каналов). Поэтому здесь только то,
// что страница умеет: текст не выделяется (exam.css, .exam-nocopy), копирование, вырезание, перетаскивание и меню
// по долгому нажатию отменяются, а каждая попытка записывается преподавателю.

/** События браузера, которые считаются попыткой скопировать текст билета */
export const COPY_EVENTS = ['copy', 'cut', 'contextmenu'] as const;
export type CopyEvent = (typeof COPY_EVENTS)[number];

/** Одно долгое нажатие даёт сразу несколько событий (меню и копирование) — в этот промежуток считаем их одной попыткой */
export const COPY_GAP_MS = 1500;

/** Поле ввода ответа: в нём выделение и меню нужны самому ученику, попыткой это не считается */
export function isEditable(target: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  const tag = (target?.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true;
}

export interface CopyGuard {
  /** Сообщить о событии; true — засчитано новой попыткой (и отправлено), false — то же нажатие, что и прошлое */
  hit(now?: number): boolean;
  /** Сколько попыток засчитано, пока открыта страница */
  readonly count: number;
}

export function createCopyGuard(send: () => void, gapMs = COPY_GAP_MS): CopyGuard {
  let last = -Infinity;
  let count = 0;
  return {
    hit(now = Date.now()) {
      if (now - last < gapMs) return false;
      last = now;
      count++;
      send();
      return true;
    },
    get count() { return count; },
  };
}
