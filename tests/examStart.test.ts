import { describe, it, expect } from 'vitest';
import {
  createMissLimiter, examStartText, examLinkClosed, EXAM_CLOSED_TEXT, EXAM_TOO_MANY_TEXT,
} from '../supabase/functions/_shared/examStart';

describe('createMissLimiter', () => {
  it('пускает 10 промахов за окно, одиннадцатая попытка блокируется', () => {
    const lim = createMissLimiter(10, 10 * 60_000);
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(lim.blocked(7, t + i)).toBe(false);
      lim.miss(7, t + i);
    }
    expect(lim.blocked(7, t + 20)).toBe(true);
  });
  it('счёт у каждого пользователя свой', () => {
    const lim = createMissLimiter(2, 60_000);
    lim.miss(1, 0); lim.miss(1, 1);
    expect(lim.blocked(1, 2)).toBe(true);
    expect(lim.blocked(2, 2)).toBe(false);
  });
  it('старые промахи выходят из окна', () => {
    const lim = createMissLimiter(2, 60_000);
    lim.miss(1, 0); lim.miss(1, 10);
    expect(lim.blocked(1, 30_000)).toBe(true);
    expect(lim.blocked(1, 60_011)).toBe(false);
  });
  it('память не растёт: пустые записи вычищаются', () => {
    const lim = createMissLimiter(2, 1000);
    for (let i = 0; i < 500; i++) lim.miss(i, 0);
    lim.blocked(999999, 5000);
    expect(lim.size()).toBeLessThan(500);
  });
});

describe('examLinkClosed', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  it('нет запуска — закрыт', () => expect(examLinkClosed(null, now)).toBe(true));
  it('closed_at — закрыт', () => expect(examLinkClosed({ closed_at: '2026-11-22T11:00:00Z', closes_at: '2026-11-23T11:00:00Z' }, now)).toBe(true));
  it('closes_at в прошлом — закрыт', () => expect(examLinkClosed({ closed_at: null, closes_at: '2026-11-22T11:59:59Z' }, now)).toBe(true));
  it('открыт', () => expect(examLinkClosed({ closed_at: null, closes_at: '2026-11-23T00:00:00Z' }, now)).toBe(false));
});

describe('examStartText', () => {
  it('формулировка и 30 минут', () => {
    expect(examStartText('Алгебра, 9 класс')).toBe('📝 Билет: Алгебра, 9 класс. На прохождение 30 минут, попытка одна.');
  });
  it('название экранируется для HTML и очищается от разметки', () => {
    expect(examStartText('A <b>x</b> & <i')).not.toMatch(/<b>|<i/);
    expect(examStartText('a < b & c')).toContain('a &lt; b &amp; c');
  });
  it('пустое название — без «: .»', () => {
    expect(examStartText('')).toBe('📝 Билет. На прохождение 30 минут, попытка одна.');
  });
});

describe('тексты', () => {
  it('закрыто и лимит', () => {
    expect(EXAM_CLOSED_TEXT).toBe('Экзамен по этой ссылке закрыт. Спросите новую ссылку у преподавателя.');
    expect(EXAM_TOO_MANY_TEXT).toBe('Слишком много попыток. Подождите несколько минут.');
  });
});
