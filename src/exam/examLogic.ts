// Чистая логика страницы /tg/exam (без React и браузера): таймер, формы ответов, разбор.
import { countdownDigit, EXAM_COUNTDOWN_SEC } from '../../supabase/functions/_shared/exam';
import { OPEN_CELLS, openCellsFor } from '../lib/openAnswer';
import { examTexts } from './i18n';

export type Lang = 'ru' | 'tg';
export type Answer = string | Record<string, string> | null;
export type Answers = Record<string, Answer>;
export interface ExamQ { tqId: string; snapshot: any }
export interface ReviewItem { tqId: string; snapshot: any; answer: Answer; points: number; max: number }

/** Осталось до срока по часам сервера: offset = серверное «сейчас» − клиентское «сейчас» */
export const remainingMs = (deadlineIso: string, offsetMs: number, clientNow: number = Date.now()): number =>
  Date.parse(deadlineIso) - (clientNow + offsetMs);

export function formatRemaining(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const isEmptyQ = (snap: any): boolean => !snap || snap.empty === true;

export function isAnswered(type: string, a: Answer | undefined): boolean {
  if (a == null) return false;
  if (type === 'matching') return typeof a === 'object' && Object.values(a).some((v) => !!v);
  if (type === 'open') return typeof a === 'string' && a.trim() !== '';
  return typeof a === 'string' && a !== '';
}

export function countAnswered(questions: ExamQ[], answers: Answers): { answered: number; total: number } {
  let answered = 0, total = 0;
  for (const q of questions) {
    if (isEmptyQ(q.snapshot)) continue;
    total++;
    if (isAnswered(q.snapshot.type, answers[q.tqId])) answered++;
  }
  return { answered, total };
}

/** Оставляет знак в начале, цифры и один разделитель (запятая или точка) */
export function normalizeOpen(raw: string): string {
  let out = '';
  let sep = false;
  for (const ch of raw.trim()) {
    if (/\d/.test(ch)) out += ch;
    else if ((ch === ',' || ch === '.') && !sep) { out += ch; sep = true; }
    else if ((ch === '-' || ch === '+') && out === '') out += ch;
  }
  return out;
}

/** Новый ответ на соответствие: пара leftId → rightId, null — снять пару */
export function matchingAnswer(prev: Answer | undefined, leftId: string, rightId: string | null): Record<string, string> {
  const base: Record<string, string> = prev && typeof prev === 'object' ? { ...prev } : {};
  if (rightId) base[leftId] = rightId; else delete base[leftId];
  return base;
}

export const nameOk = (v: string): boolean => {
  const n = [...v.replace(/\s+/g, ' ').trim()].length;
  return n >= 2 && n <= 80;
};

export const sortByOrder = (a: any, b: any): number => (a.order_index || 0) - (b.order_index || 0);

/** Текст поля на языке билета; пустой перевод заменяется базовым полем */
export function pickText(o: any, lang: Lang, prefix: 'text' | 'content' = 'text'): string {
  if (!o) return '';
  const localized = lang === 'tg' ? o[`${prefix}_tg`] : o[`${prefix}_ru`];
  return String(localized || o[prefix] || '');
}

/** Только вопросы, где потеряны баллы; n — номер в билете */
export function reviewMistakes(items: ReviewItem[]): Array<{ n: number; item: ReviewItem }> {
  const out: Array<{ n: number; item: ReviewItem }> = [];
  let n = 0; // номер среди непустых мест — тот же, что видел ученик в билете
  for (const item of items) {
    if (isEmptyQ(item.snapshot)) continue;
    n++;
    if (item.points < item.max) out.push({ n, item });
  }
  return out;
}

/** Смещение часов: серверное время минус середина интервала «отправили — получили» (задержка сети делится пополам) */
export const serverOffset = (serverNow: number, sentAt: number, receivedAt: number): number =>
  serverNow - (sentAt + receivedAt) / 2;

/** Индексы вопросов, по которым ходит ученик: пустые места пропускаются */
export const navIndexes = (questions: ExamQ[]): number[] =>
  questions.flatMap((q, i) => (isEmptyQ(q.snapshot) ? [] : [i]));

/** Доля заполнения полосы прогресса, 0..1 */
export const progressFraction = (answered: number, total: number): number =>
  total <= 0 ? 0 : Math.min(1, Math.max(0, answered / total));

/** Шаг по позиции в списке навигации с остановкой на краях */
export const stepNav = (count: number, pos: number, dir: 1 | -1): number =>
  Math.min(Math.max(0, count - 1), Math.max(0, pos + dir));

/**
 * Режим «без возврата к вопросам»: с какой позиции навигации продолжать. serverPos — номер (с нуля, в билете)
 * самого дальнего вопроса, до которого ученик дошёл; пустые места в навигацию не входят — берём первый вопрос не раньше него.
 */
export function noBackStartPos(nav: number[], serverPos: number): number {
  const p = nav.findIndex((i) => i >= serverPos);
  return p < 0 ? Math.max(0, nav.length - 1) : p;
}

/** С какой позиции начинать: первый вопрос без ответа, иначе первый */
export function firstUnansweredPos(questions: ExamQ[], answers: Answers): number {
  const nav = navIndexes(questions);
  const p = nav.findIndex((i) => !isAnswered(questions[i].snapshot.type, answers[questions[i].tqId]));
  return p < 0 ? 0 : p;
}

/** Что делать, когда не удалось получить разбор: показать результат (разбор не готов), предложить «Повторить» или показать ошибку */
export function reviewFailureKind(e: unknown): 'not_ready' | 'retry' | 'error' {
  const x = e as { status?: number; code?: string } | null;
  if (x?.code === 'review_not_ready') return 'not_ready';
  if (typeof x?.status === 'number' && (x.status === 0 || x.status >= 500)) return 'retry';
  return 'error';
}

/**
 * Что показывать в зале по ответу сервера: ждать, «скоро начнём» (старт назначен, до него больше 3 с),
 * отсчёт 3, 2, 1 (последние секунды) или идти за билетом. Время — по часам сервера (offset).
 */
export type LobbyView = { kind: 'waiting' } | { kind: 'soon' } | { kind: 'countdown'; digit: number } | { kind: 'run' };
export function lobbyView(res: { state: string; attempt?: { ticketNumber?: number | null; startsAt?: string } }, offsetMs: number, clientNow: number = Date.now()): LobbyView {
  if (res.state === 'running') return { kind: 'run' };
  if (res.state !== 'countdown' || !res.attempt?.startsAt) return { kind: 'waiting' };
  const startsAt = Date.parse(res.attempt.startsAt);
  if (Number.isNaN(startsAt)) return { kind: 'waiting' };
  const serverNow = clientNow + offsetMs;
  // Сервер ставит старт с запасом (несколько секунд): цифры — только за последние EXAM_COUNTDOWN_SEC
  if (startsAt - serverNow > EXAM_COUNTDOWN_SEC * 1000) return { kind: 'soon' };
  const digit = countdownDigit(startsAt, serverNow);
  return digit === 0 ? { kind: 'run' } : { kind: 'countdown', digit };
}

export const waitText = (res: { state: string }, lang: Lang = 'ru'): string =>
  res.state === 'countdown' ? examTexts(lang).starting : examTexts(lang).waitTeacher;

/** Подпись под номером варианта в зале (на языке билета) */
export function lobbyWaitText(lv: LobbyView, lang: Lang = 'ru'): string {
  const t = examTexts(lang);
  if (lv.kind === 'soon') return t.soon;
  if (lv.kind === 'run' || lv.kind === 'countdown') return t.starting;
  return t.waitTeacher;
}

/** «Время: N мин» — когда преподаватель уже выбрал длительность (сервер прислал minutes) */
export const lobbyMinutesText = (res: { minutes?: number | null }, lang: Lang = 'ru'): string =>
  typeof res.minutes === 'number' && res.minutes > 0 ? examTexts(lang).minutes(res.minutes) : '';

/** Ответ save: state 'waiting' — сервер ещё не считает сессию начатой (часы на границе старта) */
export interface SaveResponse { ok: boolean; state?: string }
export const SAVE_WAIT_RETRY_MS = 700;
export const SAVE_WAIT_MAX_TRIES = 5;
/** saved — записано; retry — повторить через SAVE_WAIT_RETRY_MS; finish — приём закрыт или время вышло, сдать; keep — не сдавать, оставить «не сохранено» */
export function saveOutcome(r: SaveResponse): 'saved' | 'retry' | 'finish' | 'keep' {
  if (r.ok) return 'saved';
  if (r.state === 'waiting') return 'retry';
  if (r.state === 'closed' || r.state === 'finished') return 'finish';
  return 'keep';
}

/** Сколько минут осталось, для надписи «осталось N мин»: вверх, не меньше 1 */
export const minutesLeft = (ms: number): number => Math.max(1, Math.ceil(ms / 60_000));

/** Что показать ученику про сохранение ответа: saving — отправляем (жёлтое), failed — отправить не вышло, повторяем (красное), saved — записано (зелёное), none — ответа ещё нет */
export type SaveStatus = 'saving' | 'failed' | 'saved' | 'none';
export function saveStatus(tqId: string, unsaved: ReadonlySet<string>, failed: ReadonlySet<string>, saved: ReadonlySet<string>): SaveStatus {
  if (unsaved.has(tqId)) return failed.has(tqId) ? 'failed' : 'saving';
  return saved.has(tqId) ? 'saved' : 'none';
}

/** Клеток под открытый ответ, как на бланке (5 у таджикского и английского, 4 у остальных) — правило общее с проверкой ключа при импорте и в форме вопроса */
export { OPEN_CELLS, openCellsFor };
/** Открытый ответ: до cells цифр (как клетки на бланке); всё, кроме цифр, отбрасывается */
export const openDigits = (raw: string, cells: number = OPEN_CELLS): string => raw.replace(/\D/g, '').slice(0, cells);
