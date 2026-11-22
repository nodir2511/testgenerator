import { describe, it, expect } from 'vitest';
import {
  EXAM_MINUTES, EXAM_LINK_HOURS, publicSnapshot, parseOpen, scoreAttempt, pickVariant, examCode,
  parseStartPayload, deadlineOf, attemptState, tgPlain, reviewLines, chunkLines,
} from '../supabase/functions/_shared/exam';

const test = (id = 'q1', right = 'o2') => ({
  id, type: 'test', content: 'Формула воды', content_ru: 'Формула воды', content_tg: 'Формулаи об', image_url: null, order_index: 1,
  passage: { id: 'ps1', kind: 'text', title: 'Заголовок', content: 'Текст' }, passage_id: 'ps1', passage_order: 1, chapter_name: 'Гл', correct_numeric_answer: null,
  options: ['o1', 'o2', 'o3'].map((o, i) => ({ id: o, text: o.toUpperCase(), text_ru: `R${o}`, text_tg: `T${o}`, image_url: null, is_correct: o === right, order_index: i + 1 })),
});
const matching = () => ({
  id: 'm1', type: 'matching', content: 'Соотнесите', content_ru: 'Соотнесите', content_tg: 'Мувофиқ', image_url: null,
  matching_items: [
    ...[1, 2, 3, 4].map((n) => ({ id: `l${n}`, side: 'left', text: `L${n}`, text_ru: `Л${n}`, text_tg: `Ч${n}`, correct_match_id: `r${n}`, order_index: n })),
    ...[1, 2, 3, 4, 5].map((n) => ({ id: `r${n}`, side: 'right', text: `R${n}`, text_ru: `П${n}`, text_tg: `Р${n}`, correct_match_id: null, order_index: n })),
  ],
});
const open = (v: number | null = 16) => ({ id: 'p1', type: 'open', content: 'Сколько?', content_ru: 'Сколько?', content_tg: 'Чанд?', image_url: null, correct_numeric_answer: v });

describe('publicSnapshot', () => {
  it('убирает ключи ответов и оставляет остальное', () => {
    for (const s of [test(), matching(), open()]) {
      const copy = JSON.stringify(s);
      const out = publicSnapshot(s);
      const j = JSON.stringify(out);
      expect(j).not.toContain('is_correct');
      expect(j).not.toContain('correct_match_id');
      expect(j).not.toContain('correct_numeric_answer');
      expect(JSON.stringify(s)).toBe(copy);
      expect(out.id).toBe(s.id);
      expect(out.type).toBe(s.type);
    }
    const t = publicSnapshot(test());
    expect(t.passage).toEqual({ id: 'ps1', kind: 'text', title: 'Заголовок', content: 'Текст' });
    expect(t.passage_order).toBe(1);
    expect(t.order_index).toBe(1);
    expect(t.options[1]).toMatchObject({ id: 'o2', text: 'O2', text_ru: 'Ro2', text_tg: 'To2', image_url: null, order_index: 2 });
    expect(publicSnapshot(matching()).matching_items[0]).toMatchObject({ id: 'l1', side: 'left', text_ru: 'Л1' });
  });
  it('неизвестные поля не попадают к ученику (список разрешённых)', () => {
    const s: any = test();
    s.explanation = 'секрет'; s.correct_foo = 1; s.options[0].correct_bar = true; s.options[0].hint = 'x';
    s.passage.correct_baz = 1;
    const j = JSON.stringify(publicSnapshot(s));
    for (const bad of ['explanation', 'correct_foo', 'correct_bar', 'hint', 'correct_baz', 'секрет']) expect(j).not.toContain(bad);
  });
  it('в реальном снимке нет ни одного ключа со словом correct', () => {
    for (const s of [test(), matching(), open()]) expect(JSON.stringify(publicSnapshot(s))).not.toMatch(/correct/);
  });
  it('пустое место возвращается как есть', () => {
    const e = { empty: true, type: 'test' };
    expect(publicSnapshot(e)).toEqual(e);
  });
});

describe('scoreAttempt', () => {
  const q = (snapshot: any, tqId = snapshot.id) => ({ tqId, snapshot });
  it('тест', () => {
    const r = scoreAttempt([q(test('a')), q(test('b')), q(test('c'))], { a: 'o2', b: 'o1', c: null });
    expect(r.score).toBe(1);
    expect(r.max).toBe(3);
    expect(r.items.map((i) => [i.points, i.max, i.answered])).toEqual([[1, 1, true], [0, 1, true], [0, 1, false]]);
  });
  it('соответствие: по баллу за пункт', () => {
    const r = scoreAttempt([q(matching())], { m1: { l1: 'r1', l2: 'r2', l3: 'r3', l4: 'r5' } });
    expect(r.score).toBe(3);
    expect(r.max).toBe(4);
    expect(scoreAttempt([q(matching())], {}).score).toBe(0);
  });
  it('открытый: 2 балла, запятая как точка', () => {
    expect(scoreAttempt([q(open(16))], { p1: '16' }).score).toBe(2);
    expect(scoreAttempt([q(open(16))], { p1: '16,0' }).score).toBe(2);
    expect(scoreAttempt([q(open(12.5))], { p1: '12,5' }).score).toBe(2);
    expect(scoreAttempt([q(open(16))], { p1: '17' }).score).toBe(0);
    const n = scoreAttempt([q(open(null))], { p1: '16' });
    expect([n.score, n.max]).toEqual([0, 2]);
  });
  it('пустое место — 0 из 0; сумма билета 18+2+7 = 40', () => {
    const e = scoreAttempt([q({ empty: true, type: 'test' }, 'e')], {});
    expect([e.score, e.max]).toEqual([0, 0]);
    const qs = [
      ...Array.from({ length: 18 }, (_, i) => q(test(`t${i}`))),
      ...Array.from({ length: 2 }, (_, i) => q({ ...matching(), id: `m${i}` })),
      ...Array.from({ length: 7 }, (_, i) => q({ ...open(), id: `p${i}` })),
    ];
    expect(scoreAttempt(qs, {}).max).toBe(40);
  });
});

describe('parseOpen', () => {
  it('разбор числа', () => {
    expect(parseOpen('12,5')).toBe(12.5);
    expect(parseOpen(' -3 ')).toBe(-3);
    expect(parseOpen('abc')).toBeNull();
    expect(parseOpen('')).toBeNull();
    expect(parseOpen(null)).toBeNull();
  });
});

describe('pickVariant, examCode, parseStartPayload', () => {
  it('pickVariant', () => {
    expect(pickVariant(['a', 'b', 'c'], () => 0)).toBe('a');
    expect(pickVariant(['a', 'b', 'c'], () => 0.99)).toBe('c');
    expect(() => pickVariant([])).toThrow('В наборе нет билетов');
  });
  it('examCode', () => {
    expect(examCode(() => 0)).toBe('AAAAAA');
    for (let i = 0; i < 50; i++) expect(examCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });
  it('parseStartPayload', () => {
    expect(parseStartPayload('/start exam_K7M2QX')).toBe('K7M2QX');
    expect(parseStartPayload('/start K7M2QX')).toBeNull();
    expect(parseStartPayload('/start exam_k7m2qx')).toBe('K7M2QX');
    expect(parseStartPayload('/start exam_<script>')).toBeNull();
  });
});

describe('время', () => {
  it('константы', () => { expect(EXAM_MINUTES).toBe(30); expect(EXAM_LINK_HOURS).toBe(24); });
  it('deadlineOf', () => {
    expect(deadlineOf(new Date('2026-01-01T12:00:00Z'), new Date('2026-01-01T18:00:00Z')).toISOString()).toBe('2026-01-01T12:30:00.000Z');
    expect(deadlineOf(new Date('2026-01-01T17:50:00Z'), new Date('2026-01-01T18:00:00Z')).toISOString()).toBe('2026-01-01T18:00:00.000Z');
  });
  it('attemptState', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    expect(attemptState({ finished_at: '2026-01-01T11:00:00Z', deadline_at: '2026-01-01T13:00:00Z' }, now)).toBe('finished');
    expect(attemptState({ finished_at: null, deadline_at: '2026-01-01T11:59:00Z' }, now)).toBe('expired');
    expect(attemptState({ finished_at: null, deadline_at: '2026-01-01T12:30:00Z' }, now)).toBe('running');
  });
});

describe('tgPlain', () => {
  it('индексы, степени, теги, экранирование', () => {
    expect(tgPlain('H<sub>2</sub>SO<sub>4</sub>')).toBe('H₂SO₄');
    expect(tgPlain('x<sup>2</sup>')).toBe('x²');
    expect(tgPlain('<b>да</b> &lt;')).toBe('да &lt;');
    expect(tgPlain('a < b')).toBe('a &lt; b');
    expect(tgPlain('a<sub>n</sub>')).toBe('a_n');
    expect(tgPlain('x<sup>n</sup>')).toBe('x^n');
    expect(tgPlain('<frac>1/2</frac>')).toBe('1/2');
    expect(tgPlain('A & B > C')).toBe('A &amp; B &gt; C');
    expect(tgPlain('&amp;lt;')).toBe('&amp;lt;');
    expect(tgPlain('&amp;')).toBe('&amp;');
  });
});

describe('reviewLines', () => {
  const qs = [
    { tqId: 'a', snapshot: test('a') },
    { tqId: 'b', snapshot: { ...test('b'), image_url: 'http://x/y.png' } },
    { tqId: 'm', snapshot: matching() },
    { tqId: 'p', snapshot: open(16) },
  ];
  it('только вопросы с ошибкой', () => {
    const lines = reviewLines(qs, { a: 'o2', b: 'o1', m: { l1: 'r1', l2: 'r2', l3: 'r3', l4: 'r5' }, p: '17' }, 'ru');
    const all = lines.join('\n');
    expect(all).toContain('[рисунок]');
    expect(all).toContain('Ваш ответ: Ro1');
    expect(all).toContain('Верный ответ: Ro2');
    expect(all).toContain('Ваш ответ: 17');
    expect(all).toContain('Верный ответ: 16');
    expect(all).toMatch(/2\. .*Формула воды/);
    expect(all).not.toMatch(/1\. .*Формула/);
    expect(all).toMatch(/3\. .*Соотнесите/);
    expect(all).toMatch(/4\. .*Сколько/);
  });
  it('верные пропускаются', () => {
    const all = reviewLines(qs, { a: 'o2', b: 'o2', m: { l1: 'r1', l2: 'r2', l3: 'r3', l4: 'r5' }, p: '16' }, 'ru').join('\n');
    expect(all).not.toMatch(/Формула/);
    expect(all).not.toMatch(/Сколько/);
    expect(all).toMatch(/3\. .*Соотнесите/);
  });
  it('таджикские тексты', () => {
    expect(reviewLines([qs[0]], { a: 'o1' }, 'tg').join('\n')).toContain('Формулаи об');
  });
  it('без ошибок', () => {
    expect(reviewLines([qs[0]], { a: 'o2' }, 'ru')).toEqual(['Ошибок нет']);
  });
});

describe('chunkLines', () => {
  it('режет по лимиту', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${i}. ${'я'.repeat(200)}`);
    const parts = chunkLines(lines);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(3800);
    expect(parts.join('\n').split('\n').length).toBe(100);
    expect(chunkLines(['a', 'b'])).toEqual(['a\nb']);
  });
});
