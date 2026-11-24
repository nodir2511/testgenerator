import { describe, expect, it } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { omrRead } from '../src/lib/omr/recognize';
import { BLANKS, scoreAnswers } from '../supabase/functions/_shared/omrScore';
import {
  answersOfKey, compText, count, dayLabel, doubtRows, emptyAnswers, filterChecks, groupByDay, missingCount, nextReady, parseDetails,
  parseLastSource, percent, plural, questionNumbers, queueNote, queueStatus, setMatch, setOpen, setTest, tone, wrongList, type Ok, type SavedCheck,
} from '../src/tg/check/logic';
import { render } from './omrRender';

const read = (id: string, seed = 11) => {
  const r = omrRead(render(OMR_LAYOUTS[id], seed, 3).img, OMR_LAYOUTS[id]);
  if (!r.ok) throw new Error('не прочитан');
  return r as Ok;
};

describe('слова, проценты, номера', () => {
  it('склонения', () => {
    expect([1, 2, 5, 11, 12, 14, 21, 22, 101, 111].map((n) => plural(n, 'ответ', 'ответа', 'ответов'))).toEqual(
      ['ответ', 'ответа', 'ответов', 'ответов', 'ответов', 'ответов', 'ответ', 'ответа', 'ответ', 'ответов']);
    expect(count(3, 'ответ', 'ответа', 'ответов')).toBe('3 ответа');
    expect(compText({ test: 18, matching: 2, open: 7 })).toBe('18 тестов, 2 соответствия, 7 открытых');
    expect(compText({ test: 1, matching: 0, open: 0 })).toBe('1 тест');
  });

  it('процент и цвет — по порогам ведомости', () => {
    expect(percent(31, 40)).toBe(78);
    expect(percent(0, 0)).toBe(0);
    expect([28, 27, 20, 19].map((s) => tone(s, 40))).toEqual(['good', 'mid', 'mid', 'low']);
  });

  it('номера заданий совпадают с напечатанными на всех бланках', () => {
    for (const b of BLANKS) for (const id of b.layouts) {
      const l = OMR_LAYOUTS[id], n = questionNumbers(b.comp);
      expect(l.tests.map((t) => t.q), id).toEqual(n.tests);
      expect(l.matching.map((t) => t.q), id).toEqual(n.matching);
      expect(l.open.map((t) => t.q), id).toEqual(n.open);
    }
  });
});

describe('ответы и ключ', () => {
  const comp = { test: 2, matching: 1, open: 2 };
  it('пустой ключ: не заполнено всё; правка одного места не трогает остальное', () => {
    const e = emptyAnswers(comp);
    expect(missingCount(e)).toBe(2 + 4 + 2);
    const a = setOpen(setMatch(setTest(e, 1, 'C'), 0, 2, '5'), 0, '12a345', 4);
    expect(a).toEqual({ tests: [null, 'C'], matching: [[null, null, '5', null]], open: ['1234', ''] });
    expect(e.tests).toEqual([null, null]); // исходное не изменилось
    expect(missingCount(a)).toBe(8 - 3);
  });

  it('ключ → ответы для сетки', () => {
    expect(answersOfKey({ tests: ['A', null], matching: [['1', null, '3', '4']], open: ['7', null] })).toEqual({ tests: ['A', null], matching: [['1', null, '3', '4']], open: ['7', ''] });
  });

  it('список ошибок — номерами бланка', () => {
    const key = { tests: ['A', 'B'], matching: [['1', '2', '3', '4']], open: ['5', '6'] };
    const s = scoreAnswers(key, { tests: ['A', 'C'], matching: [['1', '3', '3', '4']], open: ['5', ''] });
    expect(wrongList(s)).toEqual(['2', '3B', '5']);
    expect(wrongList(scoreAnswers(key, answersOfKey(key)))).toEqual([]);
  });
});

describe('сомнения и стопка', () => {
  it('у ученика пустой ответ не сомнение, в эталоне — да; порядок и подписи как на бланке', () => {
    const res = read('chem');
    const all = doubtRows(res, true), noEmpty = doubtRows(res, false);
    const empties = res.tests.filter((t) => t.answer === null).length + res.matching.flatMap((m) => m.rows).filter((r) => r.answer === null).length;
    expect(empties).toBeGreaterThan(0);
    expect(all.length - noEmpty.length).toBe(empties);
    expect(noEmpty.every((d) => d.why !== 'empty')).toBe(true);
    for (const d of all) {
      expect(d.index).toBeGreaterThanOrEqual(0);
      const expected = d.kind === 'test' ? `${res.tests[d.index].q}` : `${res.matching[d.index].q}${'ABCD'[d.row]}`;
      expect(d.label).toBe(expected);
    }
    expect(new Set(all.map((d) => d.id)).size).toBe(all.length);
  });

  it('несколько отметок — сомнение с причиной', () => {
    const res = read('chem');
    const m: Ok = { ...res, tests: res.tests.map((t, i) => (i === 4 ? { ...t, answer: 'multi', unsure: true } : t)) };
    expect(doubtRows(m, false).find((d) => d.id === 't4')).toMatchObject({ label: '5', why: 'multi', kind: 'test' });
  });

  it('состояние снимка: прочитан, ненадёжно, не прочитан', () => {
    const res = read('chem');
    expect(queueStatus({ res })).toBe('ok');
    expect(queueNote({ res })).toMatch(/^Вариант \d/);
    const far: Ok = { ...res, quality: { ...res.quality, pxPerMm: 2 } };
    expect(queueStatus({ res: far })).toBe('warn');
    expect(queueNote({ res: far })).toMatch(/ненадёжно/);
    expect(queueStatus({ error: 'Не видно метки' })).toBe('error');
    expect(queueNote({ error: 'Не видно метки' })).toBe('Не видно метки');
    const noVar: Ok = { ...res, variant: { ...res.variant, answer: null } };
    expect(queueNote({ res: noVar })).toMatch(/^Вариант не отмечен/);
  });

  it('следующий снимок: дальше по стопке, потом с начала, нечитаемые пропускаются', () => {
    const res = read('chem');
    const q = [{ id: 1, name: '', res }, { id: 2, name: '', error: 'x' }, { id: 3, name: '', res }];
    expect(nextReady(q, 1)?.id).toBe(3);
    expect(nextReady(q, 3)?.id).toBe(1);
    expect(nextReady([q[0], q[1]], 1)).toBeNull();
    expect(nextReady([], 1)).toBeNull();
  });
});

describe('результаты', () => {
  const row = (id: string, iso: string, student = '', v: number | null = 1): SavedCheck => ({ id, created_at: iso, student, ticket_number: v, score: 1, max_score: 2 });
  const now = new Date(2026, 10, 24, 15, 0);
  const at = (y: number, m: number, d: number, h = 10) => new Date(y, m, d, h).toISOString();

  it('дни: сегодня, вчера, число, число с годом', () => {
    expect(dayLabel(new Date(2026, 10, 24, 0, 1), now)).toBe('Сегодня');
    expect(dayLabel(new Date(2026, 10, 23, 23, 59), now)).toBe('Вчера');
    expect(dayLabel(new Date(2026, 10, 20), now)).toBe('20 ноября');
    expect(dayLabel(new Date(2025, 11, 31), now)).toBe('31 декабря 2025');
    expect(dayLabel(new Date(2025, 11, 31), new Date(2026, 0, 1))).toBe('Вчера');
  });

  it('группы по дням сохраняют порядок', () => {
    const g = groupByDay([row('a', at(2026, 10, 24)), row('b', at(2026, 10, 24, 9)), row('c', at(2026, 10, 20))], now);
    expect(g.map((x) => [x.label, x.rows.map((r) => r.id)])).toEqual([['Сегодня', ['a', 'b']], ['20 ноября', ['c']]]);
  });

  it('поиск по имени, варианту и «без имени»', () => {
    const rows = [row('a', at(2026, 10, 24), 'Алиев Рустам', 2), row('b', at(2026, 10, 24), '', 3)];
    expect(filterChecks(rows, ' алиев ').map((r) => r.id)).toEqual(['a']);
    expect(filterChecks(rows, 'без имени').map((r) => r.id)).toEqual(['b']);
    expect(filterChecks(rows, 'вариант 3').map((r) => r.id)).toEqual(['b']);
    expect(filterChecks(rows, '').length).toBe(2);
  });

  it('подробности из базы: целые принимаются, испорченные — нет', () => {
    const key = { tests: ['A'], matching: [['1', '2', '3', '4']], open: ['5'] };
    const answers = { tests: ['B'], matching: [['1', null, '3', '4']], open: [''] };
    expect(parseDetails({ answers, key, ok: {} })).toEqual({ answers, key });
    for (const bad of [null, {}, { answers }, { key }, { answers: { ...answers, tests: [] }, key }, { answers, key: { ...key, matching: [['1']] } }, { answers: { tests: 'A' }, key }]) expect(parseDetails(bad)).toBeNull();
  });

  it('«Продолжить»: испорченная запись не ломает экран', () => {
    expect(parseLastSource('{"kind":"set","id":"b1","title":"Химия"}')).toEqual({ kind: 'set', id: 'b1', title: 'Химия' });
    for (const bad of [null, '', '{', '{"kind":"x","id":"1","title":""}', '{"kind":"set","id":"","title":"a"}', '[]']) expect(parseLastSource(bad)).toBeNull();
  });
});
