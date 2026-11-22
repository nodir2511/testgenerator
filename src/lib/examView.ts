// Чистые функции раздела «Билеты классу»: состояние запуска, сводка, строки таблицы. Без обращений к базе.

type Dated = { finished_at: string | null; deadline_at: string };
export type LinkState = 'open' | 'closed' | 'expired';
export type AttemptState = 'finished' | 'running' | 'timeout';

export function buildExamUrl(bot: string | undefined, code: string): string {
  return bot ? `https://t.me/${bot}?start=exam_${code}` : '';
}

export function linkState(l: { closed_at: string | null; closes_at: string }, now: number): LinkState {
  if (l.closed_at) return 'closed';
  return Date.parse(l.closes_at) > now ? 'open' : 'expired';
}

export function attemptState(a: Dated, now: number): AttemptState {
  if (a.finished_at) return 'finished';
  return Date.parse(a.deadline_at) > now ? 'running' : 'timeout';
}

export function remainingMinutes(deadline: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 60_000));
}

export interface AttemptCounts { finished: number; running: number; timeout: number }

export function countAttempts(attempts: Dated[], now: number): AttemptCounts {
  const c: AttemptCounts = { finished: 0, running: 0, timeout: 0 };
  for (const a of attempts) c[attemptState(a, now)]++;
  return c;
}

export function summaryText(c: AttemptCounts): string {
  if (c.finished + c.running + c.timeout === 0) return 'пока никто не начал';
  return `сдали ${c.finished}, идут ${c.running}`;
}

/** Открытые запуски сверху, внутри групп — новые сверху */
export function sortLinks<T extends { closed_at: string | null; closes_at: string; created_at: string }>(rows: T[], now: number): T[] {
  const rank = (r: T) => (linkState(r, now) === 'open' ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function formatScore(score: number | null, max: number | null): string {
  return score == null || max == null ? '' : `${score} / ${max}`;
}

export interface AttemptInput extends Dated {
  id: string;
  student_name: string;
  tg_username: string | null;
  tg_name: string | null;
  ticket: { ticket_number: number } | null;
  score: number | null;
  max_score: number | null;
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

/** Раньший из срока попытки и конца запуска (закрытие или срок ссылки): позже работа уже не идёт */
export function effectiveDeadline(deadline: string, linkEnd?: string | null): string {
  return linkEnd && Date.parse(linkEnd) < Date.parse(deadline) ? linkEnd : deadline;
}

export function mapAttemptRow(a: AttemptInput, now: number, linkEnd?: string | null): AttemptRowView {
  const eff = effectiveDeadline(a.deadline_at, linkEnd);
  const status = attemptState({ finished_at: a.finished_at, deadline_at: eff }, now);
  // Не сдана, но время вышло: сервер засчитывает такую попытку по сохранённым ответам при ближайшем обращении
  const note = status === 'running' ? `идёт, осталось ${remainingMinutes(eff, now)} мин`
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
  l: { closed_at: string | null; closes_at: string; review_sent_at: string | null },
  finished: number,
  now: number,
): { enabled: boolean; again: boolean; hint: string } {
  const again = !!l.review_sent_at;
  if (linkState(l, now) === 'open') return { enabled: false, again, hint: REVIEW_OPEN_HINT };
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
