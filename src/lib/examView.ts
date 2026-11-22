// Чистые функции раздела «Билеты классу»: состояние запуска, сводка, строки таблицы. Без обращений к базе.

type Finishable = { finished_at: string | null };
/** Поля запуска, от которых зависит время: старт и длительность задаёт преподаватель, конец общий для класса */
export interface SessionLinkTimes { session_start_at: string | null; duration_min: number; closed_at: string | null }
export type LinkState = 'waiting' | 'open' | 'closed' | 'expired';
export type AttemptState = 'finished' | 'running' | 'timeout';

export function buildExamUrl(bot: string | undefined, code: string): string {
  return bot ? `https://t.me/${bot}?start=exam_${code}` : '';
}

/** waiting — преподаватель ещё не нажал «Начать»; open — сессия начата; closed/expired — приём окончен */
export function linkState(l: { closed_at: string | null; closes_at: string; session_start_at: string | null }, now: number): LinkState {
  if (l.closed_at) return 'closed';
  if (Date.parse(l.closes_at) <= now) return 'expired';
  return l.session_start_at ? 'open' : 'waiting';
}

/** Конец сессии класса: старт + минуты, но не позже закрытия; null, пока сессия не начата */
export function sessionEndOf(l: SessionLinkTimes): string | null {
  if (!l.session_start_at) return null;
  const start = Date.parse(l.session_start_at);
  if (Number.isNaN(start)) return null;
  const end = start + l.duration_min * 60_000;
  const closed = l.closed_at ? Date.parse(l.closed_at) : Infinity;
  return new Date(Math.min(end, closed)).toISOString();
}

/** Начать можно, пока запуск ждёт старта и в зале есть хотя бы один ученик */
export function canStartSession(l: { closed_at: string | null; closes_at: string; session_start_at: string | null }, attemptsCount: number, now: number): boolean {
  return linkState(l, now) === 'waiting' && attemptsCount >= 1;
}

/** end — конец сессии (sessionEndOf); null — сессия не начата, работа ещё не «вышла» */
export function attemptState(a: Finishable, now: number, end: string | null): AttemptState {
  if (a.finished_at) return 'finished';
  if (end === null) return 'running';
  return Date.parse(end) > now ? 'running' : 'timeout';
}

export function remainingMinutes(deadline: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 60_000));
}

export interface AttemptCounts { finished: number; running: number; timeout: number }

export function countAttempts(attempts: Finishable[], now: number, link: SessionLinkTimes): AttemptCounts {
  const c: AttemptCounts = { finished: 0, running: 0, timeout: 0 };
  const end = sessionEndOf(link);
  for (const a of attempts) c[attemptState(a, now, end)]++;
  return c;
}

/** Для запуска в ожидании — «ждут: N» (все, кто пришёл) */
export function summaryText(c: AttemptCounts, state?: LinkState): string {
  if (state === 'waiting') return `ждут: ${c.finished + c.running + c.timeout}`;
  if (c.finished + c.running + c.timeout === 0) return 'пока никто не начал';
  return `сдали ${c.finished}, идут ${c.running}`;
}

/** Ждущие и идущие запуски сверху, внутри групп — новые сверху */
export function sortLinks<T extends { closed_at: string | null; closes_at: string; created_at: string; session_start_at: string | null }>(rows: T[], now: number): T[] {
  const rank = (r: T) => {
    const s = linkState(r, now);
    return s === 'open' || s === 'waiting' ? 0 : 1;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b) || Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function formatScore(score: number | null, max: number | null): string {
  return score == null || max == null ? '' : `${score} / ${max}`;
}

export interface AttemptInput extends Finishable {
  id: string;
  student_name: string;
  tg_username: string | null;
  tg_name: string | null;
  ticket: { ticket_number: number } | null;
  score: number | null;
  max_score: number | null;
  /** Не используется: срок общий для класса (см. sessionEndOf) */
  deadline_at?: string | null;
}
export interface AttemptRowView {
  id: string;
  name: string;
  account: string;
  variant: string;
  score: string;
  status: AttemptState;
  /** Для идущих и просроченных — пояснение вместо баллов */
  note: string;
  finishedAt: string | null;
}

export function mapAttemptRow(a: AttemptInput, now: number, link: SessionLinkTimes): AttemptRowView {
  const end = sessionEndOf(link);
  const status = attemptState(a, now, end);
  // Не сдана, но время вышло: сервер засчитывает такую попытку по сохранённым ответам при ближайшем обращении
  const note = status === 'running' ? (end ? `идёт, осталось ${remainingMinutes(end, now)} мин` : 'ждёт начала')
    : status === 'timeout' ? 'время вышло, баллы появятся после подсчёта' : '';
  return {
    id: a.id,
    name: a.student_name,
    account: a.tg_username ? `@${a.tg_username}` : (a.tg_name ?? ''),
    variant: a.ticket ? String(a.ticket.ticket_number) : '',
    score: formatScore(a.score, a.max_score),
    status,
    note,
    finishedAt: a.finished_at,
  };
}

/** Запустить набор может его автор или главный админ */
export function canLaunchByUser(b: { created_by?: string | null; generation_params?: any }, userId: string | undefined, isOwner: boolean): boolean {
  return canLaunchBatch(b) && (isOwner || (!!userId && b.created_by === userId));
}

/** Кластерные наборы классу запускать нельзя */
export function canLaunchBatch(b: { generation_params?: any }): boolean {
  return b?.generation_params?.source !== 'cluster';
}

export const REVIEW_OPEN_HINT = 'Сначала закройте запуск — разбор отправляется после закрытия';

/** Разбор можно слать только после закрытия запуска (иначе ответы увидят те, кто ещё пишет) и если есть сданные */
export function reviewSendState(
  l: { closed_at: string | null; closes_at: string; session_start_at: string | null; review_sent_at: string | null },
  finished: number,
  now: number,
): { enabled: boolean; again: boolean; hint: string } {
  const again = !!l.review_sent_at;
  if (['open', 'waiting'].includes(linkState(l, now))) return { enabled: false, again, hint: REVIEW_OPEN_HINT };
  if (finished <= 0) return { enabled: false, again, hint: 'Пока никто не сдал билет' };
  return { enabled: true, again, hint: '' };
}

export function reviewConfirmText(finished: number, again: boolean): string {
  return again
    ? 'Разбор уже отправляли. Отправить ещё раз?'
    : `Ученики увидят свои ошибки и верные ответы. Отправить ${finished} ученикам?`;
}

export function reviewResultText(sent: number, failed: number): string {
  return `Отправлено: ${sent}, не доставлено: ${failed}`;
}

export type ExamLang = 'ru' | 'tg';

export const langName = (lang: string | null | undefined): string => (lang === 'tg' ? 'Тоҷикӣ' : 'Русский');

export const RELAUNCH_WARNING = 'Ответы этого набора уже отправлены другому классу. Запустить всё равно?';

/** У набора уже есть запуск, которому разослали разбор (верные ответы у прежнего класса): перед новым запуском нужно подтверждение */
export function needsRelaunchConfirm(links: Array<{ batch_id: string; review_sent_at: string | null }> | null | undefined, batchId: string | null | undefined): boolean {
  if (!batchId) return false;
  return (links ?? []).some((l) => l.batch_id === batchId && !!l.review_sent_at);
}

/** Понятный текст ошибки рассылки разбора; status — код ответа функции (если был) */
export function friendlyReviewError(msg: string, status?: number): string {
  if (/только что отправлен/.test(msg)) return 'Разбор только что отправлен — повторно не отправляем. Подождите несколько секунд.';
  if (status === 403 || /доступ|Нет прав|forbidden/i.test(msg)) return 'Нет доступа: разбор может отправить автор запуска или главный админ.';
  if (status === 409 || /Сначала закройте/.test(msg)) return 'Сначала закройте запуск — разбор отправляется после закрытия.';
  if (/Failed to send|fetch|network/i.test(msg)) return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  return msg;
}
