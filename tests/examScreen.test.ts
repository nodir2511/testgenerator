import { describe, it, expect } from 'vitest';
import { awayNowList, examScreenCode, examScreenPath, screenCounts, screenPhase } from '../src/lib/examScreen';

const NOW = Date.parse('2026-11-24T10:00:00Z');
const iso = (sec: number) => new Date(NOW + sec * 1000).toISOString();
const L = (o: Partial<{ session_start_at: string | null; duration_min: number; closed_at: string | null; closes_at: string }> = {}) =>
  ({ session_start_at: null, duration_min: 30, closed_at: null, closes_at: iso(3600), ...o });

describe('экран классу: что показывать', () => {
  it('до «Начать» — ожидание', () => expect(screenPhase(L(), NOW)).toEqual({ kind: 'waiting' }));
  it('старт назначен, до него больше 3 секунд — «скоро начнём»', () => {
    expect(screenPhase(L({ session_start_at: iso(5) }), NOW)).toEqual({ kind: 'soon' });
  });
  it('последние секунды — цифры 3, 2, 1', () => {
    expect(screenPhase(L({ session_start_at: iso(3) }), NOW)).toEqual({ kind: 'countdown', digit: 3 });
    expect(screenPhase(L({ session_start_at: iso(1.2) }), NOW)).toEqual({ kind: 'countdown', digit: 2 });
    expect(screenPhase(L({ session_start_at: iso(0.3) }), NOW)).toEqual({ kind: 'countdown', digit: 1 });
  });
  it('идёт билет: остаток до общего конца', () => {
    expect(screenPhase(L({ session_start_at: iso(0) }), NOW)).toEqual({ kind: 'running', leftMs: 30 * 60_000 });
    expect(screenPhase(L({ session_start_at: iso(-600), duration_min: 15 }), NOW)).toEqual({ kind: 'running', leftMs: 5 * 60_000 });
  });
  it('время вышло', () => {
    expect(screenPhase(L({ session_start_at: iso(-1800) }), NOW)).toEqual({ kind: 'ended', reason: 'time' });
  });
  it('запуск закрыт: в ожидании, во время отсчёта и посреди билета', () => {
    expect(screenPhase(L({ closed_at: iso(-5) }), NOW)).toEqual({ kind: 'ended', reason: 'closed' });
    expect(screenPhase(L({ session_start_at: iso(4), closed_at: iso(-1) }), NOW)).toEqual({ kind: 'ended', reason: 'closed' });
    expect(screenPhase(L({ session_start_at: iso(-600), closed_at: iso(-1) }), NOW)).toEqual({ kind: 'ended', reason: 'closed' });
  });
  it('ссылка истекла без старта — закрыт', () => {
    expect(screenPhase(L({ closes_at: iso(-1) }), NOW)).toEqual({ kind: 'ended', reason: 'closed' });
  });
});

describe('экран классу: счётчики и ушедшие', () => {
  const link = L({ session_start_at: iso(-600) });
  it('вошли, сдали, работы приняты', () => {
    const attempts = [{ finished_at: iso(-60) }, { finished_at: null }, { finished_at: null }];
    expect(screenCounts(attempts, link, NOW)).toEqual({ joined: 3, finished: 1, accepted: 1 });
    // время вышло: несданные работы тоже приняты (сервер засчитает сохранённые ответы)
    expect(screenCounts(attempts, link, NOW + 30 * 60_000)).toEqual({ joined: 3, finished: 1, accepted: 3 });
    expect(screenCounts([], link, NOW)).toEqual({ joined: 0, finished: 0, accepted: 0 });
  });
  it('не на странице сейчас: только не сдавшие с открытым уходом, сверху — кто ушёл раньше', () => {
    const rows = [
      { id: 'a', student_name: 'Алиев Али', finished_at: null, away_count: 1, away_since: iso(-14) },
      { id: 'b', student_name: 'Каримова Зарина', finished_at: null, away_count: 2, away_since: null },
      { id: 'c', student_name: 'Назаров Фаррух', finished_at: null, away_count: 1, away_since: iso(-75) },
      { id: 'd', student_name: 'Сдавший', finished_at: iso(-5), away_count: 1, away_since: iso(-100) },
      { id: 'e', student_name: 'Без полей', finished_at: null },
    ];
    expect(awayNowList(rows, NOW)).toEqual([
      { id: 'c', name: 'Назаров Фаррух', clock: '1:15' },
      { id: 'a', name: 'Алиев Али', clock: '0:14' },
    ]);
  });
});

describe('экран классу: адрес', () => {
  it('адрес по коду и код из адреса', () => {
    expect(examScreenPath('K7M2PQ')).toBe('/exam/screen/K7M2PQ');
    expect(examScreenCode('/exam/screen/K7M2PQ')).toBe('K7M2PQ');
    expect(examScreenCode('/exam/screen/k7m2pq/')).toBe('K7M2PQ');
  });
  it('другие адреса — не экран', () => {
    for (const p of ['/', '/exam/screen/', '/exam/screen', '/tg/exam', '/game/screen/ABC', '/exam/screen/AB-C']) expect(examScreenCode(p)).toBeNull();
  });
});
