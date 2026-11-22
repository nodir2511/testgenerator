import { describe, it, expect } from 'vitest';
import { chunkLines, digestText, duePeriods, summarize } from '../supabase/functions/_shared/errorDigest';

const iso = (d: Date) => d.toISOString();
const keys = (now: string) => duePeriods(new Date(now)).map((p) => p.key);

describe('сводка ошибок сайта: какие периоды пора отправить', () => {
  it('в обычный день — только сутки', () => {
    // 2026-11-25 — среда
    const due = duePeriods(new Date('2026-11-25T03:00:00Z'));
    expect(due.map((p) => p.period)).toEqual(['day']);
    expect(due[0].key).toBe('day:2026-11-24');
    expect(iso(due[0].from)).toBe('2026-11-23T19:00:00.000Z');
    expect(iso(due[0].to)).toBe('2026-11-24T19:00:00.000Z');
  });

  it('сутки считаются по Душанбе (UTC+5)', () => {
    // 20:30 UTC 21 ноября — в Душанбе уже 01:30 22 ноября, вчера там — 21-е
    const [day] = duePeriods(new Date('2026-11-21T20:30:00Z'));
    expect(day.key).toBe('day:2026-11-21');
    expect(iso(day.from)).toBe('2026-11-20T19:00:00.000Z');
    expect(iso(day.to)).toBe('2026-11-21T19:00:00.000Z');
    // а за полтора часа до полуночи по Душанбе вчера — ещё 20-е
    expect(keys('2026-11-21T17:30:00Z')).toEqual(['day:2026-11-20']);
  });

  it('в понедельник — сутки и прошлая неделя (пн–вс)', () => {
    const due = duePeriods(new Date('2026-11-23T03:00:00Z'));
    expect(due.map((p) => p.key)).toEqual(['day:2026-11-22', 'week:2026-11-16']);
    expect(iso(due[1].from)).toBe('2026-11-15T19:00:00.000Z');
    expect(iso(due[1].to)).toBe('2026-11-22T19:00:00.000Z');
  });

  it('1-го числа — сутки и прошлый месяц', () => {
    // 2026-11-01 — воскресенье
    const due = duePeriods(new Date('2026-11-01T03:00:00Z'));
    expect(due.map((p) => p.key)).toEqual(['day:2026-10-31', 'month:2026-10']);
    expect(iso(due[1].from)).toBe('2026-09-30T19:00:00.000Z');
    expect(iso(due[1].to)).toBe('2026-10-31T19:00:00.000Z');
  });

  it('1 января — сутки, месяц и год', () => {
    // 2026-01-01 — четверг
    const due = duePeriods(new Date('2026-01-01T03:00:00Z'));
    expect(due.map((p) => p.key)).toEqual(['day:2025-12-31', 'month:2025-12', 'year:2025']);
    expect(iso(due[2].from)).toBe('2024-12-31T19:00:00.000Z');
    expect(iso(due[2].to)).toBe('2025-12-31T19:00:00.000Z');
  });

  it('1 января в понедельник — ещё и неделя', () => {
    expect(keys('2024-01-01T03:00:00Z')).toEqual(['day:2023-12-31', 'week:2023-12-25', 'month:2023-12', 'year:2023']);
  });
});

describe('сводка ошибок сайта: группировка', () => {
  const rows = [
    { created_at: '2026-11-21T05:00:00Z', message: 'Не удалось загрузить вопрос 15', url: '/a', app_version: '1.1.0', user_id: 'u1' },
    { created_at: '2026-11-21T07:00:00Z', message: 'Не удалось загрузить вопрос 2048', url: '/b', app_version: '1.1.0', user_id: 'u2' },
    { created_at: '2026-11-21T06:00:00Z', message: 'Не удалось загрузить вопрос 7', url: '/c', app_version: '1.1.0', user_id: 'u1' },
    { created_at: '2026-11-21T08:00:00Z', message: 'Набор 3f2b8c1e-9a4d-4e7b-8c2a-1b2c3d4e5f60 не найден', url: '/d', app_version: '1.1.0', user_id: null },
    { created_at: '2026-11-21T09:00:00Z', message: 'Набор 11111111-2222-4333-8444-555555555555 не найден', url: '/e', app_version: '1.1.0', user_id: 'u3' },
    { created_at: '2026-11-21T10:00:00Z', message: '[игра priem] Cannot read properties of undefined', url: '/games/priem', app_version: 'game', user_id: 'u3' },
  ];

  it('склеивает одинаковые ошибки с разными числами и uuid, сортирует по числу', () => {
    const s = summarize(rows);
    expect(s.groups.map((g) => g.count)).toEqual([3, 2, 1]);
    expect(s.groups[0].message).toBe('Не удалось загрузить вопрос …');
    expect(s.groups[0].lastAt).toBe('2026-11-21T07:00:00Z');
    expect(s.groups[0].url).toBe('/b');
    expect(s.groups[1].message).toBe('Набор … не найден');
  });

  it('отделяет игру и считает пользователей', () => {
    const s = summarize(rows);
    expect(s).toMatchObject({ total: 6, site: 5, game: 1, users: 3 });
    expect(s.groups[2].game).toBe(true);
    expect(s.groups[0].game).toBe(false);
  });

  it('склеивает хэши и имена файлов сборки, обрезает длинное', () => {
    const s = summarize([
      { created_at: '2026-11-21T05:00:00Z', message: 'Failed to fetch dynamically imported module: /assets/Bank-BxY3kQ2a.js' },
      { created_at: '2026-11-21T06:00:00Z', message: 'Failed to fetch dynamically imported module: /assets/Bank-Dq81ZmP0.js' },
      { created_at: '2026-11-21T07:00:00Z', message: 'x'.repeat(500) },
    ]);
    expect(s.groups[0].count).toBe(2);
    expect(s.groups[1].message.length).toBeLessThanOrEqual(121);
    expect(s.users).toBe(0);
  });

  it('пустой список', () => {
    expect(summarize([])).toEqual({ total: 0, site: 0, game: 0, users: 0, groups: [] });
  });
});

describe('сводка ошибок сайта: текст сообщения', () => {
  const range = (from: string, to: string) => ({ from: new Date(from), to: new Date(to) });
  const empty = summarize([]);

  it('заголовки четырёх периодов', () => {
    expect(digestText('day', range('2026-11-20T19:00:00Z', '2026-11-21T19:00:00Z'), empty)[0])
      .toBe('<b>Ошибки сайта за сутки · 21.11.2026</b>');
    expect(digestText('week', range('2026-11-15T19:00:00Z', '2026-11-22T19:00:00Z'), empty)[0])
      .toBe('<b>Ошибки сайта за неделю · 16–22.11.2026</b>');
    expect(digestText('month', range('2026-09-30T19:00:00Z', '2026-10-31T19:00:00Z'), empty)[0])
      .toBe('<b>Ошибки сайта за месяц · октябрь 2026</b>');
    expect(digestText('year', range('2024-12-31T19:00:00Z', '2025-12-31T19:00:00Z'), empty)[0])
      .toBe('<b>Ошибки сайта за 2025 год</b>');
  });

  it('неделя на стыке месяцев и годов', () => {
    expect(digestText('week', range('2026-11-29T19:00:00Z', '2026-12-06T19:00:00Z'), empty)[0])
      .toBe('<b>Ошибки сайта за неделю · 30.11–06.12.2026</b>');
    expect(digestText('week', range('2025-12-28T19:00:00Z', '2026-01-04T19:00:00Z'), empty)[0])
      .toBe('<b>Ошибки сайта за неделю · 29.12.2025–04.01.2026</b>');
  });

  it('при нуле ошибок — «Ошибок не было»', () => {
    const lines = digestText('week', range('2026-11-15T19:00:00Z', '2026-11-22T19:00:00Z'), empty);
    expect(lines).toEqual(['<b>Ошибки сайта за неделю · 16–22.11.2026</b>', 'Ошибок не было']);
  });

  it('счётчики, пометка игры и экранирование HTML', () => {
    const s = summarize([
      { created_at: '2026-11-21T05:00:00Z', message: 'a < b && c > d', user_id: 'u1' },
      { created_at: '2026-11-21T06:00:00Z', message: 'a < b && c > d', user_id: 'u2' },
      { created_at: '2026-11-21T07:00:00Z', message: '[игра priem] <canvas> пропал', app_version: 'game', user_id: 'u2' },
    ]);
    const lines = digestText('day', range('2026-11-20T19:00:00Z', '2026-11-21T19:00:00Z'), s);
    expect(lines).toEqual([
      '<b>Ошибки сайта за сутки · 21.11.2026</b>',
      'Всего: 3 · сайт: 2 · игра: 1',
      'Затронуто пользователей: 2',
      '',
      '×2 · a &lt; b &amp;&amp; c &gt; d',
      '×1 · игра · [игра priem] &lt;canvas&gt; пропал',
    ]);
  });

  it('показывает топ-10 и «и ещё N видов»', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      created_at: '2026-11-21T05:00:00Z', message: `ошибка ${'абвгдежзиклмноп'[i]}`,
    }));
    const lines = digestText('day', range('2026-11-20T19:00:00Z', '2026-11-21T19:00:00Z'), summarize(many));
    expect(lines.filter((l) => l.startsWith('×')).length).toBe(10);
    expect(lines[lines.length - 1]).toBe('и ещё 5 видов');

    const top3 = digestText('day', range('2026-11-20T19:00:00Z', '2026-11-21T19:00:00Z'), summarize(many.slice(0, 5)), { top: 3 });
    expect(top3.filter((l) => l.startsWith('×')).length).toBe(3);
    expect(top3[top3.length - 1]).toBe('и ещё 2 вида');
  });

  it('примечание добавляется последней строкой', () => {
    const lines = digestText('year', range('2024-12-31T19:00:00Z', '2025-12-31T19:00:00Z'), empty, { note: 'Журнал <хранит> 30 дней' });
    expect(lines[lines.length - 1]).toBe('<i>Журнал &lt;хранит&gt; 30 дней</i>');
  });
});

describe('сводка ошибок сайта: деление на сообщения', () => {
  it('режет длинное', () => {
    const chunks = chunkLines(['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)], 100);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunkLines(['x'.repeat(500)], 100)[0].length).toBe(100);
    expect(chunkLines(['a', 'b'])).toEqual(['a\nb']);
  });
});
