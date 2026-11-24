import { describe, it, expect } from 'vitest';
import {
  canLaunchByUser, sessionEndOf, canStartSession, finishedInSession, startedMinutesNotice, buildExamUrl, linkState, attemptState, remainingMinutes, countAttempts, sortLinks, mapAttemptRow, timesRu, formatAwayMs, awayView, newAwayNames, awayToastText, canLaunchBatch, formatScore, summaryText, reviewSendState, reviewConfirmText, reviewResultText,
} from '../src/lib/examView';

const NOW = Date.parse('2026-11-22T10:00:00.000Z');
const iso = (min: number) => new Date(NOW + min * 60_000).toISOString();

describe('buildExamUrl', () => {
  it('собирает ссылку на бота', () => expect(buildExamUrl('mybot', 'AB23CD')).toBe('https://t.me/mybot?start=exam_AB23CD'));
  it('без имени бота — пустая строка', () => expect(buildExamUrl(undefined, 'AB23CD')).toBe(''));
});

const L = (over: Partial<{ closed_at: string | null; closes_at: string; session_start_at: string | null; duration_min: number }> = {}) =>
  ({ closed_at: null, closes_at: iso(600), session_start_at: null, duration_min: 30, ...over });

describe('linkState', () => {
  it('без старта — ждёт учеников', () => expect(linkState(L(), NOW)).toBe('waiting'));
  it('со стартом — идёт', () => expect(linkState(L({ session_start_at: iso(-5) }), NOW)).toBe('open'));
  it('закрыт вручную', () => expect(linkState(L({ closed_at: iso(-1) }), NOW)).toBe('closed'));
  it('срок ссылки вышел', () => expect(linkState(L({ closes_at: iso(-1) }), NOW)).toBe('expired'));
});

describe('sessionEndOf', () => {
  it('нет старта — нет конца', () => expect(sessionEndOf(L())).toBeNull());
  it('старт + минуты', () => expect(sessionEndOf(L({ session_start_at: iso(-5), duration_min: 30 }))).toBe(iso(25)));
  it('закрыт раньше конца — конец по закрытию', () => expect(sessionEndOf(L({ session_start_at: iso(-5), closed_at: iso(-1) }))).toBe(iso(-1)));
  it('закрыт позже конца — конец по времени', () => expect(sessionEndOf(L({ session_start_at: iso(-5), closed_at: iso(40) }))).toBe(iso(25)));
  it('срок ссылки кончается раньше конца сессии — конец по сроку ссылки', () => {
    expect(sessionEndOf(L({ session_start_at: iso(-5), duration_min: 30, closes_at: iso(10) }))).toBe(iso(10));
  });
  it('минимум из трёх', () => {
    expect(sessionEndOf(L({ session_start_at: iso(-5), duration_min: 30, closes_at: iso(10), closed_at: iso(3) }))).toBe(iso(3));
  });
});

describe('finishedInSession: закрытые в ожидании не считаются начавшими', () => {
  it('сдал после старта', () => expect(finishedInSession(iso(-1), iso(-5))).toBe(true));
  it('закрыта до старта', () => expect(finishedInSession(iso(-10), iso(-5))).toBe(false));
  it('ровно в момент старта — не в сессии (как на сервере)', () => expect(finishedInSession(iso(-5), iso(-5))).toBe(false));
  it('сессия не начиналась', () => expect(finishedInSession(iso(-1), null)).toBe(false));
  it('не закончена', () => expect(finishedInSession(null, iso(-5))).toBe(false));
});

describe('startedMinutesNotice', () => {
  it('сервер вернул другую длительность — сообщение', () => expect(startedMinutesNotice(30, 20)).toBe('Сессия уже запущена на 20 мин'));
  it('та же — ничего', () => expect(startedMinutesNotice(30, 30)).toBeNull());
  it('нет числа — ничего', () => expect(startedMinutesNotice(30, undefined)).toBeNull());
});

describe('canStartSession', () => {
  it('ждёт и есть ученики', () => expect(canStartSession(L(), 1, NOW)).toBe(true));
  it('без учеников нельзя', () => expect(canStartSession(L(), 0, NOW)).toBe(false));
  it('уже начат', () => expect(canStartSession(L({ session_start_at: iso(-1) }), 5, NOW)).toBe(false));
  it('закрыт', () => expect(canStartSession(L({ closed_at: iso(-1) }), 5, NOW)).toBe(false));
});

describe('attemptState и остаток', () => {
  const S = iso(-20);
  it('сдана', () => expect(attemptState({ finished_at: iso(-5) }, NOW, iso(10), S)).toBe('finished'));
  it('идёт', () => expect(attemptState({ finished_at: null }, NOW, iso(10), S)).toBe('running'));
  it('время вышло, не сдана', () => expect(attemptState({ finished_at: null }, NOW, iso(-1), S)).toBe('timeout'));
  it('сессия не начата — не «вышло»', () => expect(attemptState({ finished_at: null }, NOW, null, null)).toBe('running'));
  it('закрыта в ожидании (до старта) — «не начал», не «сдал»', () => {
    expect(attemptState({ finished_at: iso(-30) }, NOW, iso(10), S)).toBe('not_started');
    expect(attemptState({ finished_at: iso(-30) }, NOW, null, null)).toBe('not_started');
  });
  it('остаток округляется вверх и не уходит в минус', () => {
    expect(remainingMinutes(iso(10.2), NOW)).toBe(11);
    expect(remainingMinutes(iso(-3), NOW)).toBe(0);
  });
});

describe('сводка', () => {
  const attempts = [{ finished_at: iso(-1) }, { finished_at: null }, { finished_at: null }];
  it('идущая сессия: сдали и идут', () => {
    expect(countAttempts(attempts, NOW, L({ session_start_at: iso(-5) }))).toEqual({ finished: 1, running: 2, timeout: 0, notStarted: 0 });
  });
  it('сессия закончилась: несданные — «вышло», не «идут»', () => {
    expect(countAttempts(attempts, NOW, L({ session_start_at: iso(-40) }))).toEqual({ finished: 1, running: 0, timeout: 2, notStarted: 0 });
  });
  it('закрытые до старта не считаются «сдали»', () => {
    expect(countAttempts([{ finished_at: iso(-10) }, { finished_at: iso(-1) }], NOW, L({ session_start_at: iso(-5) })))
      .toEqual({ finished: 1, running: 0, timeout: 0, notStarted: 1 });
  });
  it('текст', () => {
    expect(summaryText({ finished: 3, running: 2, timeout: 0, notStarted: 0 })).toBe('сдали 3, идут 2');
    expect(summaryText({ finished: 0, running: 0, timeout: 0, notStarted: 0 })).toBe('пока никто не начал');
    expect(summaryText({ finished: 0, running: 4, timeout: 0, notStarted: 0 }, 'waiting')).toBe('ждут: 4');
    expect(summaryText({ finished: 0, running: 0, timeout: 0, notStarted: 0 }, 'waiting')).toBe('ждут: 0');
  });
});

describe('sortLinks', () => {
  it('открытые сверху, затем новые', () => {
    const rows = [
      { code: 'A', closed_at: iso(-1), closes_at: iso(60), created_at: iso(-10) },
      { code: 'B', closed_at: null, closes_at: iso(60), created_at: iso(-20) },
      { code: 'C', closed_at: null, closes_at: iso(60), created_at: iso(-5) },
      { code: 'D', closed_at: null, closes_at: iso(-60), created_at: iso(-1) },
    ].map((r) => ({ session_start_at: iso(-1), duration_min: 30, ...r }));
    expect(sortLinks(rows, NOW).map((r) => r.code)).toEqual(['C', 'B', 'D', 'A']);
  });
});

describe('строка таблицы', () => {
  const link = L({ session_start_at: iso(-18), duration_min: 30 }); // конец через 12 минут
  const base = { id: '1', student_name: 'Алиев Тимур', tg_username: 'timur', tg_name: 'Timur A', ticket: { ticket_number: 7 }, ticket_id: 't7', finished_at: iso(-2), deadline_at: null, score: 31 as number | null, max_score: 40 as number | null };
  const run = { ...base, finished_at: null, score: null, max_score: null };
  it('сданная', () => {
    const r = mapAttemptRow(base, NOW, link);
    expect(r).toMatchObject({ name: 'Алиев Тимур', account: '@timur', variant: '7', score: '31 / 40', status: 'finished' });
  });
  it('без username — имя в Telegram', () => expect(mapAttemptRow({ ...base, tg_username: null }, NOW, link).account).toBe('Timur A'));
  it('идущая: остаток от конца сессии, deadline_at пуст', () => {
    const r = mapAttemptRow(run, NOW, link);
    expect(r.status).toBe('running');
    expect(r.score).toBe('');
    expect(r.note).toBe('идёт, осталось 12 мин');
  });
  it('остаток не берётся из deadline_at попытки', () => {
    expect(mapAttemptRow({ ...run, deadline_at: iso(1) }, NOW, link).note).toBe('идёт, осталось 12 мин');
  });
  it('время вышло', () => expect(mapAttemptRow(run, NOW, L({ session_start_at: iso(-40) })).note).toBe('время вышло, баллы появятся после подсчёта'));
  it('запуск закрыт раньше конца: не «идёт»', () => {
    expect(mapAttemptRow(run, NOW, L({ session_start_at: iso(-18), closed_at: iso(-1) })).status).toBe('timeout');
  });
  it('закрыта в ожидании — «не начал», без баллов', () => {
    const r = mapAttemptRow({ ...base, finished_at: iso(-25), score: 0, max_score: 40 }, NOW, link);
    expect(r.status).toBe('not_started');
    expect(r.note).toBe('не начал');
    expect(r.score).toBe('');
  });
  it('до старта: ждёт, не «вышло»', () => {
    const r = mapAttemptRow(run, NOW, L());
    expect(r.status).toBe('running');
    expect(r.note).toBe('ждёт начала');
  });
  it('столбец «Уходил»: не уходил — пусто; уходил — сколько раз и на сколько; сейчас не на странице — отдельно', () => {
    expect(mapAttemptRow(run, NOW, link)).toMatchObject({ away: '', awayNow: false });
    expect(mapAttemptRow({ ...run, away_count: 2, away_ms: 48_000, away_since: null }, NOW, link)).toMatchObject({ away: '2 раза · всего 48 с', awayNow: false });
    expect(mapAttemptRow({ ...run, away_count: 1, away_ms: 0, away_since: new Date(NOW - 14_000).toISOString() }, NOW, link)).toMatchObject({ away: 'сейчас не на странице · 0:14', awayNow: true });
  });
});

describe('уходы со страницы билета', () => {
  const since = (sec: number) => new Date(NOW - sec * 1000).toISOString();
  it('число раз по-русски', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111, 112].map(timesRu)).toEqual(
      ['1 раз', '2 раза', '4 раза', '5 раз', '11 раз', '12 раз', '14 раз', '21 раз', '22 раза', '25 раз', '111 раз', '112 раз'],
    );
  });
  it('длительность словами', () => {
    expect([0, 400, 48_000, 60_000, 80_000, 125_400].map(formatAwayMs)).toEqual(['1 с', '1 с', '48 с', '1 мин', '1 мин 20 с', '2 мин 5 с']);
  });
  it('сейчас не на странице: счёт времени, со второго раза — сколько уже раз', () => {
    expect(awayView({ away_count: 1, away_ms: 0, away_since: since(75) }, 'running', NOW)).toEqual({ text: 'сейчас не на странице · 1:15', now: true, count: 1 });
    expect(awayView({ away_count: 3, away_ms: 20_000, away_since: since(5) }, 'running', NOW).text).toBe('сейчас не на странице · 0:05 · уже 3 раза');
  });
  it('часы преподавателя отстают от сервера — счёт не уходит в минус', () => {
    expect(awayView({ away_count: 1, away_since: since(-30) }, 'running', NOW).text).toBe('сейчас не на странице · 0:00');
  });
  it('билет уже не идёт — «сейчас не на странице» не показываем, даже если уход не закрыт', () => {
    expect(awayView({ away_count: 2, away_ms: 30_000, away_since: since(600) }, 'timeout', NOW)).toEqual({ text: '2 раза · всего 30 с', now: false, count: 2 });
    expect(awayView({ away_count: 1, away_ms: 90_000, away_since: null }, 'finished', NOW).text).toBe('1 раз · всего 1 мин 30 с');
  });
  it('старая база без этих полей — как «не уходил»', () => {
    expect(awayView({}, 'running', NOW)).toEqual({ text: '', now: false, count: 0 });
  });
  it('предупреждение — только о новых уходах: первый опрос запоминает, дальше — у кого вырос счётчик', () => {
    const rows = [
      { id: 'a', student_name: 'Алиев Али', away_count: 2 },
      { id: 'b', student_name: 'Каримова Зарина', away_count: 0 },
      { id: 'c', student_name: 'Назаров Фаррух' },
    ];
    expect(newAwayNames(null, rows)).toEqual([]);
    const prev = new Map([['a', 2], ['b', 0]]);
    expect(newAwayNames(prev, rows)).toEqual([]);
    expect(newAwayNames(prev, [{ ...rows[0], away_count: 3 }, { ...rows[1], away_count: 1 }, rows[2]])).toEqual(['Алиев Али', 'Каримова Зарина']);
    // опоздавший, которого в прошлом опросе не было
    expect(newAwayNames(prev, [...rows, { id: 'd', student_name: 'Новый', away_count: 1 }])).toEqual(['Новый']);
    expect(awayToastText(['Алиев Али', 'Каримова Зарина'])).toBe('Уход со страницы билета: Алиев Али, Каримова Зарина');
  });
});

describe('formatScore', () => {
  it('нет баллов — пусто', () => expect(formatScore(null, null)).toBe(''));
  it('есть', () => expect(formatScore(0, 40)).toBe('0 / 40'));
});

describe('canLaunchBatch', () => {
  it('кластерный нельзя', () => expect(canLaunchBatch({ generation_params: { source: 'cluster' } })).toBe(false));
  it('обычный можно', () => {
    expect(canLaunchBatch({ generation_params: { ticket_count: 5 } })).toBe(true);
    expect(canLaunchBatch({ generation_params: null })).toBe(true);
  });
});

describe('canLaunchByUser', () => {
  it('автор или главный админ', () => {
    expect(canLaunchByUser({ created_by: 'u1' }, 'u1', false)).toBe(true);
    expect(canLaunchByUser({ created_by: 'u2' }, 'u1', false)).toBe(false);
    expect(canLaunchByUser({ created_by: 'u2' }, 'u1', true)).toBe(true);
    expect(canLaunchByUser({ created_by: 'u1', generation_params: { source: 'cluster' } }, 'u1', true)).toBe(false);
    expect(canLaunchByUser({ created_by: 'u1' }, undefined, false)).toBe(false);
  });
});

describe('reviewSendState', () => {
  const closed = { closed_at: iso(-5), closes_at: iso(60), review_sent_at: null };
  it('открытый запуск — нельзя, с подсказкой', () => {
    const r = reviewSendState({ closed_at: null, closes_at: iso(60), review_sent_at: null }, 3, NOW);
    expect(r.enabled).toBe(false);
    expect(r.hint).toBe('Сначала закройте запуск — разбор отправляется после закрытия');
  });
  it('закрытый без сданных — нельзя', () => {
    expect(reviewSendState(closed, 0, NOW).enabled).toBe(false);
  });
  it('закрытый со сданными — можно, первый раз', () => {
    expect(reviewSendState(closed, 2, NOW)).toMatchObject({ enabled: true, again: false });
  });
  it('истёкший срок считается закрытым', () => {
    expect(reviewSendState({ closed_at: null, closes_at: iso(-1), review_sent_at: null }, 1, NOW).enabled).toBe(true);
  });
  it('повторная отправка помечается', () => {
    expect(reviewSendState({ ...closed, review_sent_at: iso(-1) }, 1, NOW)).toMatchObject({ enabled: true, again: true });
  });
});

describe('тексты разбора', () => {
  it('подтверждение', () => expect(reviewConfirmText(5, false)).toBe('Ученики увидят свои ошибки и верные ответы. Отправить 5 ученикам?'));
  it('повторное подтверждение', () => expect(reviewConfirmText(5, true)).toBe('Разбор уже отправляли. Отправить ещё раз?'));
  it('итог', () => expect(reviewResultText(4, 1)).toBe('Отправлено: 4, не доставлено: 1'));
});
