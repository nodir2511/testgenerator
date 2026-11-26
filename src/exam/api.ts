import { loadTelegramScript } from '../tg/telegramScript';
import { serverOffset } from './examLogic';
import type { Answer, Answers, ExamQ, Lang, ReviewItem } from './examLogic';

// Клиент Edge Function tg-exam (действия ученика). Подлинность — подпись initData в заголовке.

export interface TgWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  colorScheme?: 'light' | 'dark';
  onEvent?(e: string, cb: () => void): void;
  offEvent?(e: string, cb: () => void): void;
  HapticFeedback?: { notificationOccurred(s: string): void };
  // Полный экран, подтверждение закрытия и жест «смахнуть вниз» — есть не во всех версиях Telegram
  isVersionAtLeast?(v: string): boolean;
  isFullscreen?: boolean;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
}
export const tgApp = (): TgWebApp | undefined => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

/** Telegram иногда внедряет initData с задержкой в несколько миллисекунд */
export async function waitTelegram(maxWaitMs = 800): Promise<TgWebApp | undefined> {
  await loadTelegramScript();
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const app = tgApp();
    if (app?.initData) return app;
    await new Promise((r) => setTimeout(r, 60));
  }
  return tgApp();
}

export class ExamApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
  /** Нет связи или сбой сервера: ответ можно повторить */
  get retryable() { return this.status === 0 || this.status >= 500; }
}

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tg-exam`;

/** Смещение часов сервера относительно телефона (мс); null — сервер ещё не ответил со своим временем. Обновляется с каждым ответом. */
let serverOffsetMs: number | null = null;
export const getServerOffset = (): number | null => serverOffsetMs;

/** keepalive — запрос должен уйти, даже если страницу тут же свернули или закрыли (сообщение об уходе) */
export async function examApi<T>(action: string, body: Record<string, unknown> = {}, opts: { keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  const sentAt = Date.now();
  try {
    res = await fetch(FN_URL, {
      method: 'POST',
      keepalive: opts.keepalive === true,
      headers: { 'Content-Type': 'application/json', 'X-Tg-Init-Data': tgApp()?.initData ?? '' },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new ExamApiError('network', 'Нет связи с сервером. Проверьте интернет.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (typeof data.now === 'number') serverOffsetMs = serverOffset(data.now, sentAt, Date.now());
  if (!res.ok) throw new ExamApiError(data.error || 'error', data.message || (typeof data.error === 'string' ? data.error : '') || `Ошибка ${res.status}`, res.status);
  return data as T;
}

/** minutes — null, пока преподаватель не назначил время (зал ожидания) */
export interface ViewBase { now?: number; title: string; subject: string; minutes: number | null; lang: Lang }
/** Правило о выходах: включено ли (галочка преподавателя), пороги и сколько уже израсходовано (выходов и мс вне страницы) */
export interface AwayRules { strict: boolean; maxCount: number; maxMs: number; count: number; ms: number }
export type OpenResponse =
  // new: попытки ещё нет; session — идёт ли уже сессия класса (тогда remainingMs — сколько осталось)
  | (ViewBase & { state: 'new'; session?: 'waiting' | 'running'; remainingMs?: number })
  | (ViewBase & { state: 'closed' })
  // awayClosed — билет закрыло правило о выходах; canReturn — сессия ещё идёт, преподаватель может вернуть в билет
  | (ViewBase & { state: 'finished'; attempt: { score: number; max: number; review: boolean; awayClosed?: boolean; canReturn?: boolean } })
  // зал ожидания и отсчёт: вопросов нет, только номер варианта (и время старта)
  | (ViewBase & { state: 'waiting'; attempt: { ticketNumber: number | null } })
  | (ViewBase & { state: 'countdown'; attempt: { ticketNumber: number | null; startsAt: string; awayStrict?: boolean } })
  | (ViewBase & { state: 'running'; attempt: { ticketNumber: number | null; deadline: string; questions: ExamQ[]; answers: Answers; away?: AwayRules; noBack?: boolean; pos?: number; studentName?: string } });

export type LobbyResponse = Extract<OpenResponse, { state: 'waiting' | 'countdown' }>;

export const apiOpen =(code: string) => examApi<OpenResponse>('open', { code });
export const apiStart = (code: string, name: string, lang: Lang = 'ru') => examApi<OpenResponse>('start', { code, name, lang });
export const apiSave = (code: string, tqId: string, answer: Answer) =>
  // waiting — по часам сервера сессия ещё не началась (граница старта): ответ не записан, повторить
  examApi<{ ok: boolean; state?: 'new' | 'closed' | 'finished' | 'waiting'; now?: number }>('save', { code, tqId, answer });
/** Ученик ушёл со страницы билета (away) или вернулся (ms — сколько его не было по часам телефона) */
export const apiFocus = (code: string, away: boolean, ms?: number) =>
  // closed — этим выходом правило закрыло билет; away — счётчики правила после этого сообщения
  examApi<{ ok: boolean; closed?: boolean; away?: AwayRules }>('focus', { code, away, ...(ms == null ? {} : { ms }) }, { keepalive: true });
/** Ученик перешёл к вопросу с номером pos (с нуля, по порядку в билете): в режиме «без возврата» сервер закрывает прошлые */
export const apiAdvance = (code: string, pos: number) => examApi<{ ok: boolean; pos?: number }>('advance', { code, pos });
/** Попытка скопировать текст билета: преподаватель видит счётчик */
export const apiCopy = (code: string) => examApi<{ ok: boolean }>('copy', { code }, { keepalive: true });
export const apiSubmit =(code: string) => examApi<{ score: number; max: number; now?: number }>('submit', { code });
export const apiReview = (code: string) => examApi<{ questions: ReviewItem[] }>('review', { code });
