import { describe, expect, it } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { processGray, probeGray } from '../src/lib/omr/process';
import { coverMap, liveMarks, markPolygon } from '../src/tg/check/liveMarks';
import { answersFromResult } from '../src/lib/omr/answers';
import { scoreAnswers, type TicketKey } from '../supabase/functions/_shared/omrScore';
import type { Ok } from '../src/tg/check/logic';
import { render } from './omrRender';

const L = OMR_LAYOUTS.chem;
const { img, truth } = render(L, 11, 3, { glyphs: true });
const res: Ok = processGray(img, ['chem']).res!;
const variant = truth.variant!;
/** Ключ, с которым все отмеченные ответы верны */
const rightKey = (): TicketKey => ({
  tests: truth.tests.map((t) => t ?? 'A'),
  matching: truth.matching.map((r) => r.map((x) => String(x ?? 1))),
  open: truth.openText.map((t) => t || '1'),
});
const copy = (r: Ok): Ok => ({ ...r, tests: r.tests.map((t) => ({ ...t })), matching: r.matching.map((m) => ({ ...m, rows: m.rows.map((x) => ({ ...x })) })), variant: { ...r.variant } });
const marked = truth.tests.findIndex((t) => t !== null);
const at = (marks: ReturnType<typeof liveMarks>['marks'], id: string) => marks.filter((m) => m.id === id);

describe('кружочки ответов поверх живой камеры', () => {
  it('все отмеченные ответы верны — все зелёные, пустые ответы без кружочков', () => {
    const r = liveMarks(res, L, { [variant]: rightKey() }, []);
    const picked = truth.tests.filter((t) => t !== null).length + truth.matching.flat().filter((x) => x !== null).length;
    expect(r.counts).toEqual({ ok: picked, warn: 0, bad: 0, read: 0 });
    expect(r.variant).toBe(variant);
    expect(r.problem).toBeNull();
    truth.tests.forEach((t, i) => expect(at(r.marks, `t${i}`)).toHaveLength(t === null ? 0 : 1));
  });

  it('кружочек стоит на отмеченном ответе, а не на правильном', () => {
    const key = rightKey();
    const mine = truth.tests[marked]!;
    key.tests[marked] = mine === 'A' ? 'B' : 'A';
    const [m] = at(liveMarks(res, L, { [variant]: key }, []).marks, `t${marked}`);
    const o = L.tests[marked].options.find((x) => x.value === mine)!;
    expect(m).toMatchObject({ tone: 'bad', round: true, x: o.x - o.d / 2, y: o.y - o.d / 2, w: o.d, h: o.d });
  });

  it('несколько отметок и бледная отметка — оранжевые, даже если бледная совпала с ключом', () => {
    const x = copy(res);
    x.tests[marked] = { ...x.tests[marked], answer: 'multi', candidates: ['A', 'C'] };
    const pale = truth.tests.findIndex((t, i) => t !== null && i !== marked);
    x.tests[pale].unsure = true;
    const r = liveMarks(x, L, { [variant]: rightKey() }, []);
    expect(at(r.marks, `t${marked}`).map((m) => m.tone)).toEqual(['warn', 'warn']);
    expect(at(r.marks, `t${pale}`).map((m) => m.tone)).toEqual(['warn']);
    expect(r.counts.warn).toBe(2); // ответов, а не кружочков
  });

  it('соответствия считаются построчно', () => {
    const key = rightKey();
    const i = truth.matching.findIndex((m) => m.some((x) => x !== null)), row = truth.matching[i].findIndex((x) => x !== null);
    key.matching[i][row] = key.matching[i][row] === '1' ? '2' : '1';
    const r = liveMarks(res, L, { [variant]: key }, []);
    expect(at(r.marks, `m${i}.${row}`)[0].tone).toBe('bad');
    expect(r.counts.bad).toBe(1);
  });

  it('открытый вопрос: совпал — зелёный, другое число — красный, неуверенно — оранжевый, пусто — ничего', () => {
    const key = rightKey();
    const hint = (text: string, unsure = false) => ({ text, unsure, digits: [] });
    key.open[0] = '7'; key.open[1] = '12'; key.open[2] = '5';
    const hints = [hint('07'), hint('13'), hint('5', true)];
    const { marks } = liveMarks(res, L, { [variant]: key }, hints);
    expect([0, 1, 2, 3].map((i) => at(marks, `o${i}`)[0]?.tone)).toEqual(['ok', 'bad', 'warn', undefined]);
    expect(at(marks, 'o0')[0].round).toBe(false);
  });

  it('вариант не отмечен или без ключа — сверять не с чем: только «прочитано» и «сомнения», ничего красного', () => {
    const none = copy(res);
    none.variant = { ...none.variant, answer: null };
    const a = liveMarks(none, L, { [variant]: rightKey() }, []);
    expect(a.counts.bad + a.counts.ok).toBe(0);
    expect(a.counts.read).toBeGreaterThan(0);
    expect(a.problem).toBe('Вариант не отмечен');
    expect(liveMarks(res, L, { [variant === 1 ? 2 : 1]: rightKey() }, []).problem).toBe(`Для варианта ${variant} нет ключа`);
    expect(liveMarks(none, L, undefined, []).problem).toBeNull(); // эталон: ключа ещё нет
    const two = copy(res);
    two.variant = { ...two.variant, answer: 'multi', candidates: [1, 2] };
    const b = liveMarks(two, L, { 1: rightKey() }, []);
    expect(b.problem).toBe('Отмечено несколько вариантов');
    expect(at(b.marks, 'v').map((m) => m.tone)).toEqual(['warn', 'warn']);
  });

  it('незаполненный ответ в ключе — не «неверно», а просто прочитано', () => {
    const key = rightKey();
    key.tests[marked] = null;
    expect(at(liveMarks(res, L, { [variant]: key }, []).marks, `t${marked}`)[0].tone).toBe('read');
  });

  it('цвета совпадают с тем, что засчитает проверка', () => {
    const key = rightKey();
    key.tests = key.tests.map((t, i) => (i % 3 ? t : 'D'));
    const s = scoreAnswers(key, answersFromResult(res));
    const { marks } = liveMarks(res, L, { [variant]: key }, []);
    truth.tests.forEach((t, i) => { if (t !== null) expect(at(marks, `t${i}`)[0].tone).toBe(s.tests[i] ? 'ok' : 'bad'); });
  });
});

describe('место кружочка на экране', () => {
  it('проба кадра отдаёт прочитанное и раскладку, кружочек ложится на отметку', () => {
    const p = probeGray(img, ['chem', 'phys'])!;
    expect(p.layout).toBe('chem');
    expect(p.corners).toHaveLength(4);
    const m = at(liveMarks(p.res, L, { [variant]: rightKey() }, []).marks, `t${marked}`)[0];
    const poly = markPolygon(m, p.res.toPhoto, { k: 1, dx: 0, dy: 0 });
    const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length, cy = poly.reduce((s, q) => s + q[1], 0) / poly.length;
    expect(img.data[Math.round(cy) * img.w + Math.round(cx)]).toBeLessThan(120); // внутри закрашенного кружка
  });

  it('кадр заполняет экран с обрезкой (object-fit: cover)', () => {
    // кадр 1000×500 на экране 400×400: видна середина
    expect(coverMap(1000, 500, 400, 400)).toEqual({ k: 0.8, dx: -200, dy: 0 });
    expect(coverMap(500, 1000, 400, 400)).toEqual({ k: 0.8, dx: 0, dy: -200 });
  });
});
