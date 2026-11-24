// Чистая логика экрана для показа классу («Билеты классу», /exam/screen/КОД): что показывать в каждый момент. Без обращений к базе.
import { countdownDigit, EXAM_COUNTDOWN_SEC } from '../../supabase/functions/_shared/exam';
import { countAttempts, formatClock, sessionEndOf, type AwayFields, type SessionLinkTimes } from './examView';

/**
 * Что на экране: waiting — ждём учеников (QR и список вошедших); soon — старт назначен, до него больше 3 с;
 * countdown — цифры 3, 2, 1; running — идёт билет (leftMs до общего конца); ended — приём окончен
 * (time — время вышло, closed — запуск закрыт преподавателем или ссылка истекла).
 */
export type ScreenPhase =
  | { kind: 'waiting' }
  | { kind: 'soon' }
  | { kind: 'countdown'; digit: number }
  | { kind: 'running'; leftMs: number }
  | { kind: 'ended'; reason: 'time' | 'closed' };

/** now — «сейчас» по часам сервера (мс): те же моменты, что видят ученики на своих страницах */
export function screenPhase(link: SessionLinkTimes, now: number): ScreenPhase {
  const start = link.session_start_at ? Date.parse(link.session_start_at) : NaN;
  const closed = !!link.closed_at || Date.parse(link.closes_at) <= now;
  if (Number.isNaN(start)) return closed ? { kind: 'ended', reason: 'closed' } : { kind: 'waiting' };
  const end = Date.parse(sessionEndOf(link) as string);
  if (now >= end) return { kind: 'ended', reason: link.closed_at ? 'closed' : 'time' };
  if (now < start) {
    if (start - now > EXAM_COUNTDOWN_SEC * 1000) return { kind: 'soon' };
    return { kind: 'countdown', digit: countdownDigit(start, now) };
  }
  return { kind: 'running', leftMs: end - now };
}

export interface ScreenCounts {
  /** Сколько учеников вошло */
  joined: number;
  /** Сдали сами */
  finished: number;
  /** Работы приняты: сдали сами или время вышло (сервер засчитает сохранённые ответы) */
  accepted: number;
}

export function screenCounts(attempts: Array<{ finished_at: string | null }>, link: SessionLinkTimes, now: number): ScreenCounts {
  const c = countAttempts(attempts, now, link);
  return { joined: attempts.length, finished: c.finished, accepted: c.finished + c.timeout };
}

export interface AwayNow { id: string; name: string; clock: string }

/** Кто прямо сейчас не на странице билета: не сдавшие с открытым уходом; сверху — кто ушёл раньше всех */
export function awayNowList(
  attempts: Array<{ id: string; student_name: string; finished_at: string | null } & AwayFields>,
  now: number,
): AwayNow[] {
  return attempts
    .filter((a) => !a.finished_at && !!a.away_since && !Number.isNaN(Date.parse(a.away_since)))
    .map((a) => ({ a, since: Date.parse(a.away_since as string) }))
    .sort((x, y) => x.since - y.since)
    .map(({ a, since }) => ({ id: a.id, name: a.student_name, clock: formatClock(now - since) }));
}

/** Адрес экрана для показа классу */
export const examScreenPath = (code: string): string => `/exam/screen/${encodeURIComponent(code)}`;

/** Код запуска из адреса страницы; null — это не адрес экрана */
export function examScreenCode(pathname: string): string | null {
  const m = pathname.match(/^\/exam\/screen\/([A-Za-z0-9]+)\/?$/);
  return m ? m[1].toUpperCase() : null;
}
