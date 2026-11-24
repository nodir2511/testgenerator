// Уход ученика со страницы билета: что считать уходом и как сообщить об этом серверу. Без React и браузера.

/**
 * События, по которым страница узнаёт, что её не видят или она не в фокусе:
 * hidden / visible — страница скрыта или снова видна (visibilitychange, pagehide);
 * blur / focus — окно потеряло или получило фокус (другое окно или приложение поверх);
 * inactive / active — мини-приложение Telegram свернули или вернули;
 * touch — ученик нажал на страницу: он точно здесь, даже если «возвратное» событие не пришло.
 */
export type FocusSignal = 'hidden' | 'visible' | 'blur' | 'focus' | 'inactive' | 'active' | 'touch';
export interface FocusFlags { hidden: boolean; blurred: boolean; inactive: boolean }

export const NO_FOCUS_FLAGS: FocusFlags = { hidden: false, blurred: false, inactive: false };

/**
 * Считаем события, а не состояние: в Telegram Web страница открывается во фрейме без фокуса,
 * и проверка «есть ли фокус сейчас» записала бы уход тому, кто никуда не уходил.
 */
export function applyFocusSignal(f: FocusFlags, s: FocusSignal): FocusFlags {
  switch (s) {
    case 'hidden': return { ...f, hidden: true };
    case 'visible': return { ...f, hidden: false };
    case 'blur': return { ...f, blurred: true };
    case 'focus': return { ...f, blurred: false };
    case 'inactive': return { ...f, inactive: true };
    case 'active': return { ...f, inactive: false };
    case 'touch': return NO_FOCUS_FLAGS;
  }
}

export const isAway = (f: FocusFlags): boolean => f.hidden || f.blurred || f.inactive;

/** Отправка на сервер: away = true — ушёл, false — вернулся (ms — сколько был не на странице по часам телефона) */
export type FocusSend = (away: boolean, ms?: number) => Promise<unknown>;

export interface AwayReporterOptions {
  /** Пауза перед повтором после сбоя связи */
  retryMs?: number;
  /** Сколько раз пробовать одно сообщение */
  maxTries?: number;
  /** Сбой, после которого стоит повторить (нет связи, ошибка сервера); остальные — сообщение отбрасывается */
  isRetryable?: (e: unknown) => boolean;
}

export interface AwayReporter {
  /** Ученик ушёл со страницы; повторный вызов без back ничего не делает */
  leave(now?: number): void;
  /** Ученик вернулся */
  back(now?: number): void;
  /**
   * Страница билета открыта (заново): если сервер считает ученика ушедшим (закрыл страницу и открыл снова,
   * или прошлое возвращение не дошло) — закрыть тот уход. Ученик на странице и уходов нет — на сервере ничего не меняется.
   */
  arrive(): void;
  /** Билет закончен: ничего больше не отправлять */
  stop(): void;
  /** Сколько раз ученик уходил, пока открыта страница */
  readonly count: number;
}

export const AWAY_RETRY_MS = 4000;
export const AWAY_MAX_TRIES = 5;

interface Op { away: boolean; ms?: number; tries: number }

/**
 * Сообщения уходят строго по одному и по порядку: возвращение, обогнавшее уход, сервер принял бы за новый уход.
 * Сбой связи — повтор через retryMs. Недошедший уход отбрасывается, если ученик уже вернулся:
 * возвращение несёт длительность, и сервер засчитает уход по ней.
 */
export function createAwayReporter(send: FocusSend, opts: AwayReporterOptions = {}): AwayReporter {
  const retryMs = opts.retryMs ?? AWAY_RETRY_MS;
  const maxTries = opts.maxTries ?? AWAY_MAX_TRIES;
  const isRetryable = opts.isRetryable ?? (() => true);
  const queue: Op[] = [];
  let awayAt: number | null = null;
  let count = 0;
  let busy = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pump = async () => {
    if (busy || stopped || timer) return;
    busy = true;
    try {
      while (queue.length && !stopped) {
        const op = queue[0];
        try {
          await send(op.away, op.ms);
          queue.shift();
        } catch (e) {
          op.tries++;
          const superseded = op.away && queue.length > 1;
          if (superseded || !isRetryable(e) || op.tries >= maxTries) { queue.shift(); continue; }
          timer = setTimeout(() => { timer = null; void pump(); }, retryMs);
          return;
        }
      }
    } finally {
      busy = false;
    }
  };

  return {
    leave(now = Date.now()) {
      if (stopped || awayAt !== null) return;
      awayAt = now;
      count++;
      queue.push({ away: true, tries: 0 });
      void pump();
    },
    back(now = Date.now()) {
      if (stopped || awayAt === null) return;
      const ms = Math.max(0, now - awayAt);
      awayAt = null;
      // Уход ещё не отправлен (ждёт очереди или повтора) — убираем: возвращение несёт длительность и заменит его.
      // Уход, который отправляется прямо сейчас (busy, первый в очереди), не трогаем
      const last = queue[queue.length - 1];
      if (last?.away && !(busy && queue.length === 1)) queue.pop();
      queue.push({ away: false, ms, tries: 0 });
      if (timer) { clearTimeout(timer); timer = null; }
      void pump();
    },
    arrive() {
      if (stopped || awayAt !== null) return;
      queue.push({ away: false, tries: 0 });
      void pump();
    },
    stop() {
      stopped = true;
      queue.length = 0;
      if (timer) { clearTimeout(timer); timer = null; }
    },
    get count() { return count; },
  };
}
