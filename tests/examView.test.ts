import { describe, it, expect } from 'vitest';
import {
  buildExamUrl, linkState, attemptState, remainingMinutes, countAttempts, sortLinks, mapAttemptRow, canLaunchBatch, formatScore, summaryText,
} from '../src/lib/examView';

const NOW = Date.parse('2026-11-22T10:00:00.000Z');
const iso = (min: number) => new Date(NOW + min * 60_000).toISOString();

describe('buildExamUrl', () => {
  it('собирает ссылку на бота', () => expect(buildExamUrl('mybot', 'AB23CD')).toBe('https://t.me/mybot?start=exam_AB23CD'));
  it('без имени бота — пустая строка', () => expect(buildExamUrl(undefined, 'AB23CD')).toBe(''));
});

describe('linkState', () => {
  it('открыт, пока не закрыт и срок не вышел', () => expect(linkState({ closed_at: null, closes_at: iso(60) }, NOW)).toBe('open'));
  it('закрыт вручную', () => expect(linkState({ closed_at: iso(-1), closes_at: iso(60) }, NOW)).toBe('closed'));
  it('срок вышел', () => expect(linkState({ closed_at: null, closes_at: iso(-1) }, NOW)).toBe('expired'));
});

describe('attemptState и остаток', () => {
  it('сдана', () => expect(attemptState({ finished_at: iso(-5), deadline_at: iso(10) }, NOW)).toBe('finished'));
  it('идёт', () => expect(attemptState({ finished_at: null, deadline_at: iso(10) }, NOW)).toBe('running'));
  it('время вышло, не сдана', () => expect(attemptState({ finished_at: null, deadline_at: iso(-1) }, NOW)).toBe('timeout'));
  it('остаток округляется вверх и не уходит в минус', () => {
    expect(remainingMinutes(iso(10.2), NOW)).toBe(11);
    expect(remainingMinutes(iso(-3), NOW)).toBe(0);
  });
});

describe('сводка', () => {
  const attempts = [
    { finished_at: iso(-1), deadline_at: iso(5) },
    { finished_at: null, deadline_at: iso(5) },
    { finished_at: null, deadline_at: iso(-5) },
  ];
  it('считает сдавших и идущих; вышедшее время не считается «идёт»', () => {
    expect(countAttempts(attempts, NOW)).toEqual({ finished: 1, running: 1, timeout: 1 });
  });
  it('текст', () => {
    expect(summaryText({ finished: 3, running: 2, timeout: 0 })).toBe('сдали 3, идут 2');
    expect(summaryText({ finished: 0, running: 0, timeout: 0 })).toBe('пока никто не начал');
  });
});

describe('sortLinks', () => {
  it('открытые сверху, затем новые', () => {
    const rows = [
      { code: 'A', closed_at: iso(-1), closes_at: iso(60), created_at: iso(-10) },
      { code: 'B', closed_at: null, closes_at: iso(60), created_at: iso(-20) },
      { code: 'C', closed_at: null, closes_at: iso(60), created_at: iso(-5) },
      { code: 'D', closed_at: null, closes_at: iso(-60), created_at: iso(-1) },
    ];
    expect(sortLinks(rows, NOW).map((r) => r.code)).toEqual(['C', 'B', 'D', 'A']);
  });
});

describe('строка таблицы', () => {
  const base = { id: '1', student_name: 'Алиев Тимур', tg_username: 'timur', tg_name: 'Timur A', ticket: { ticket_number: 7 }, finished_at: iso(-2), deadline_at: iso(10), score: 31, max_score: 40 };
  it('сданная', () => {
    const r = mapAttemptRow(base, NOW);
    expect(r).toMatchObject({ name: 'Алиев Тимур', account: '@timur', variant: '7', score: '31 / 40', status: 'finished' });
  });
  it('без username — имя в Telegram', () => expect(mapAttemptRow({ ...base, tg_username: null }, NOW).account).toBe('Timur A'));
  it('идущая', () => {
    const r = mapAttemptRow({ ...base, finished_at: null, score: null, max_score: null, deadline_at: iso(12) }, NOW);
    expect(r.status).toBe('running');
    expect(r.score).toBe('');
    expect(r.note).toBe('идёт, осталось 12 мин');
  });
  it('время вышло', () => expect(mapAttemptRow({ ...base, finished_at: null, score: null, max_score: null, deadline_at: iso(-3) }, NOW).note).toBe('время вышло, не сдал'));
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
