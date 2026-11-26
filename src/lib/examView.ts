// Чистые функции раздела «Билеты классу»: состояние запуска, сводка, строки таблицы. Без обращений к базе.

type Finishable = { finished_at: string | null };
/** Поля запуска, от которых зависит время: старт и длительность задаёт преподаватель, конец общий для класса */
export interface SessionLinkTimes { session_start_at: string | null; duration_min: number; closed_at: string | null; closes_at: string }
export type LinkState = 'waiting' | 'open' | 'closed' | 'expired';
/** not_started — попытку закрыли в ожидании (до старта сессии): ученик не писал билет */
export type AttemptState = 'finished' | 'running' | 'timeout' | 'not_started';

/** Попытка закончена внутри сессии (как inSession на сервере): закрытые до старта «сдали» не считаются */
export function finishedInSession(finishedAt: string | null | undefined, sessionStartAt: string | null | undefined): boolean {
  if (!finishedAt || !sessionStartAt) return false;
  return Date.parse(finishedAt) > Date.parse(sessionStartAt);
}

/** «Начать» вернуло другую длительность (сессию уже запустили, например из другой вкладки) */
export function startedMinutesNotice(chosen: number, returned: number | null | undefined): string | null {
  return typeof returned === 'number' && returned !== chosen ? `Сессия уже запущена на ${returned} мин` : null;
}

export function buildExamUrl(bot: string | undefined, code: string): string {
  return bot ? `https://t.me/${bot}?start=exam_${code}` : '';
}

/** waiting — преподаватель ещё не нажал «Начать»; open — сессия начата; closed/expired — приём окончен */
export function linkState(l: { closed_at: string | null; closes_at: string; session_start_at: string | null }, now: number): LinkState {
  if (l.closed_at) return 'closed';
  if (Date.parse(l.closes_at) <= now) return 'expired';
  return l.session_start_at ? 'open' : 'waiting';
}

/** Конец сессии класса: старт + минуты, но не позже закрытия и срока ссылки; null, пока сессия не начата */
export function sessionEndOf(l: SessionLinkTimes): string | null {
  if (!l.session_start_at) return null;
  const start = Date.parse(l.session_start_at);
  if (Number.isNaN(start)) return null;
  const end = start + l.duration_min * 60_000;
  const at = (v: string | null | undefined) => {
    const t = v ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? Infinity : t;
  };
  return new Date(Math.min(end, at(l.closed_at), at(l.closes_at))).toISOString();
}

/** Начать можно, пока запуск ждёт старта и в зале есть хотя бы один ученик */
export function canStartSession(l: { closed_at: string | null; closes_at: string; session_start_at: string | null }, attemptsCount: number, now: number): boolean {
  return linkState(l, now) === 'waiting' && attemptsCount >= 1;
}

/** end — конец сессии (sessionEndOf); null — сессия не начата, работа ещё не «вышла». start — session_start_at запуска */
export function attemptState(a: Finishable, now: number, end: string | null, start: string | null): AttemptState {
  if (a.finished_at) return finishedInSession(a.finished_at, start) ? 'finished' : 'not_started';
  if (end === null) return 'running';
  return Date.parse(end) > now ? 'running' : 'timeout';
}

export function remainingMinutes(deadline: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 60_000));
}

export interface AttemptCounts { finished: number; running: number; timeout: number; notStarted: number }

export function countAttempts(attempts: Finishable[], now: number, link: SessionLinkTimes): AttemptCounts {
  const c: AttemptCounts = { finished: 0, running: 0, timeout: 0, notStarted: 0 };
  const end = sessionEndOf(link);
  for (const a of attempts) {
    const s = attemptState(a, now, end, link.session_start_at);
    if (s === 'not_started') c.notStarted++; else c[s]++;
  }
  return c;
}

/** Для запуска в ожидании — «ждут: N» (все, кто пришёл) */
export function summaryText(c: AttemptCounts, state?: LinkState): string {
  const all = c.finished + c.running + c.timeout + c.notStarted;
  if (state === 'waiting') return `ждут: ${all}`;
  if (all === 0) return 'пока никто не начал';
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

/** Уходы ученика со страницы билета (exam_attempts): сколько раз, сколько всего мс и с какого момента не на странице сейчас */
export interface AwayFields { away_count?: number | null; away_ms?: number | null; away_since?: string | null; away_closed_at?: string | null }

/** «1 раз», «2 раза», «5 раз», «21 раз», «22 раза» */
export function timesRu(n: number): string {
  const d = n % 10, h = n % 100;
  return `${n} ${d >= 2 && d <= 4 && !(h >= 12 && h <= 14) ? 'раза' : 'раз'}`;
}

/** Длительность словами: «48 с», «2 мин», «1 мин 20 с»; меньше секунды — «1 с» */
export function formatAwayMs(ms: number): string {
  const s = Math.max(1, Math.round(Math.max(0, ms) / 1000));
  const m = Math.floor(s / 60);
  if (m === 0) return `${s} с`;
  return s % 60 === 0 ? `${m} мин` : `${m} мин ${s % 60} с`;
}

/** «0:14», «12:05»: минуты и секунды, меньше нуля — «0:00» */
export const formatClock = (ms: number): string => {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface AwayView {
  /** Текст столбца «Уходил»; пусто — не уходил */
  text: string;
  /** Не на странице прямо сейчас (и билет ещё идёт) */
  now: boolean;
  count: number;
}

/** Столбец «Уходил»: кто не на странице сейчас и как давно, иначе — сколько раз уходил и на сколько всего */
export function awayView(a: AwayFields, status: AttemptState, now: number): AwayView {
  const count = Math.max(0, a.away_count ?? 0);
  const since = a.away_since ? Date.parse(a.away_since) : NaN;
  if (status === 'running' && !Number.isNaN(since)) {
    return { text: `сейчас не на странице · ${formatClock(now - since)}${count > 1 ? ` · уже ${timesRu(count)}` : ''}`, now: true, count };
  }
  if (count === 0) return { text: '', now: false, count };
  // Билет закрыло правило о выходах — это главное, что нужно знать преподавателю
  return { text: `${timesRu(count)} · всего ${formatAwayMs(a.away_ms ?? 0)}${a.away_closed_at ? ' · билет закрыт за выходы' : ''}`, now: false, count };
}

/**
 * Кто ушёл со страницы с прошлого опроса таблицы: имена тех, у кого вырос счётчик уходов.
 * prev — счётчики прошлого опроса по id попытки; null — первый опрос (о старых уходах не сообщаем).
 */
export function newAwayNames(
  prev: ReadonlyMap<string, number> | null,
  attempts: Array<{ id: string; student_name: string } & AwayFields>,
): string[] {
  if (!prev) return [];
  return attempts.filter((a) => (a.away_count ?? 0) > (prev.get(a.id) ?? 0)).map((a) => a.student_name);
}

export const awayToastText = (names: string[]): string => `Уход со страницы билета: ${names.join(', ')}`;

/** Кто пытался скопировать текст билета с прошлого опроса таблицы (как newAwayNames: первый опрос только запоминает) */
export function newCopyNames(
  prev: ReadonlyMap<string, number> | null,
  attempts: Array<{ id: string; student_name: string; copy_count?: number | null }>,
): string[] {
  if (!prev) return [];
  return attempts.filter((a) => (a.copy_count ?? 0) > (prev.get(a.id) ?? 0)).map((a) => a.student_name);
}

export const copyToastText = (names: string[]): string => `Попытка скопировать текст билета: ${names.join(', ')}`;

/** Текст галочки в зале ожидания и подсказка к ней (пороги — AWAY_LIMIT_COUNT и AWAY_LIMIT_MS) */
export const awayStrictLabel = (maxCount: number, maxMs: number): string =>
  `Закрывать билет за выходы: ${maxCount} выхода или ${Math.round(maxMs / 1000)} секунд вне страницы`;
export const NO_BACK_LABEL = 'Без возврата к вопросам';
export const NO_BACK_HINT = 'Ученик отвечает по порядку и не может вернуться к прошлому вопросу. Собрать ответы у соседей и расставить их потом не получится.';

/** Подпись прошлого запуска в списке «кого пригласить»: название набора и дата */
export function inviteSourceLabel(s: { code: string; created_at: string; batch: { title: string } | null }): string {
  const d = new Date(s.created_at);
  const date = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return `${s.batch?.title || s.code}${date ? ` · ${date}` : ''}`;
}
export const inviteResultText = (sent: number, failed: number): string =>
  failed > 0 ? `Приглашения отправлены: ${sent}, не доставлено: ${failed}` : `Приглашения отправлены: ${sent}`;

export const AWAY_STRICT_HINT = 'Ученик видит это правило и свой счётчик. Закрытый по ошибке билет можно вернуть кнопкой «Вернуть в билет», пока идёт сессия.';

export interface AttemptInput extends Finishable, AwayFields {
  id: string;
  student_name: string;
  tg_username: string | null;
  tg_name: string | null;
  ticket: { ticket_number: number } | null;
  score: number | null;
  max_score: number | null;
  /** Попытки скопировать текст билета */
  copy_count?: number | null;
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
  /** Столбец «Уходил» (пусто — не уходил) и признак «не на странице сейчас» */
  away: string;
  awayNow: boolean;
  /** Столбец «Копировал»: «2 раза»; пусто — не пытался */
  copy: string;
  /** Билет закрыло правило о выходах, и сессия ещё идёт: преподаватель может вернуть ученика в билет */
  canReopen: boolean;
}

export function mapAttemptRow(a: AttemptInput, now: number, link: SessionLinkTimes): AttemptRowView {
  const end = sessionEndOf(link);
  const status = attemptState(a, now, end, link.session_start_at);
  // Не сдана, но время вышло: сервер засчитывает такую попытку по сохранённым ответам при ближайшем обращении
  const note = status === 'running' ? (end ? `идёт, осталось ${remainingMinutes(end, now)} мин` : 'ждёт начала')
    : status === 'timeout' ? 'время вышло, баллы появятся после подсчёта'
    : status === 'not_started' ? 'не начал' : '';
  const away = awayView(a, status, now);
  return {
    away: away.text,
    awayNow: away.now,
    copy: (a.copy_count ?? 0) > 0 ? timesRu(a.copy_count ?? 0) : '',
    canReopen: !!a.away_closed_at && !!a.finished_at && end !== null && Date.parse(end) > now,
    id: a.id,
    name: a.student_name,
    account: a.tg_username ? `@${a.tg_username}` : (a.tg_name ?? ''),
    variant: a.ticket ? String(a.ticket.ticket_number) : '',
    score: status === 'finished' ? formatScore(a.score, a.max_score) : '',
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
