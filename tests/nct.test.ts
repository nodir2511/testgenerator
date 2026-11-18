import { describe, expect, it } from 'vitest';
import { nctCandidatesFor, buildLinks } from '../src/lib/questionSwap';
import { pickNct, planNct, sectionOfTopicNumber, sectionPoints, topicNumber } from '../supabase/functions/_shared/nct';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// вопросы по сквозным темам центра 1..49 (уровни 21 + 12 + 16)
function pool(topicsNums: number[], per: { test: number; matching: number; open: number }) {
  const out: any[] = [];
  for (const n of topicsNums) {
    const ch = n <= 21 ? 1 : n <= 33 ? 2 : 3;
    const ord = ch === 1 ? n : ch === 2 ? n - 21 : n - 33;
    for (const type of ['test', 'matching', 'open'] as const) {
      for (let i = 1; i <= per[type]; i++) {
        out.push({ id: `${type}-${n}-${i}`, type, topic_id: `t${n}`, chapter_id: `c${ch}`, num: i, chapter: { order_index: ch }, topic: { order_index: ord } });
      }
    }
  }
  return out;
}
const all49 = Array.from({ length: 49 }, (_, i) => i + 1);

describe('режим НЦТ', () => {
  it('сквозной номер и раздел темы', () => {
    expect(topicNumber(1, 21)).toBe(21);
    expect(topicNumber(2, 1)).toBe(22);
    expect(topicNumber(3, 16)).toBe(49);
    expect(topicNumber(4, 1)).toBeNull();
    expect([1, 33, 42, 43].map(sectionOfTopicNumber)).toEqual(['basic', 'basic', 'basic', 'basic']);
    expect([34, 41].map(sectionOfTopicNumber)).toEqual(['atom', 'atom']);
    expect([44, 49].map(sectionOfTopicNumber)).toEqual(['solutions', 'solutions']);
    expect(sectionOfTopicNumber(50)).toBeNull();
  });

  it('баллы для тем 1–49: 18 + 11 + 11', () => {
    const p = sectionPoints(['basic', 'atom', 'solutions']);
    expect(p).toEqual({ basic: 18, atom: 11, solutions: 11 });
    expect(Object.values(sectionPoints(['basic', 'atom'])).reduce((a, b) => a + b, 0)).toBe(40);
  });

  it('раскладка даёт 18 + 2 + 7 и баллы раздела в пределах ±1', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const have = { basic: { test: 60, matching: 8, open: 40 }, atom: { test: 40, matching: 5, open: 20 }, solutions: { test: 30, matching: 4, open: 20 } };
      const plan = planNct(['basic', 'atom', 'solutions'], have, 3, rng(seed))!;
      const sum = (k: 'test' | 'matching' | 'open') => Object.values(plan).reduce((s, p) => s + p[k], 0);
      expect([sum('test'), sum('matching'), sum('open')]).toEqual([18, 2, 7]);
      const target: Record<string, number> = { basic: 18, atom: 11, solutions: 11 };
      for (const [k, p] of Object.entries(plan)) expect(Math.abs(p.test + 4 * p.matching + 2 * p.open - target[k])).toBeLessThanOrEqual(1);
    }
  });

  it('билеты: 27 заданий, блоки разделов по порядку, без повторов между билетами', () => {
    const picked = pickNct(pool(all49, { test: 12, matching: 6, open: 8 }), 3, rng(7));
    const [tests, matching, open] = picked.kinds;
    expect(picked.notes.some((n) => n.includes('не хватило'))).toBe(false);
    for (let t = 0; t < 3; t++) {
      expect([tests[t].length, matching[t].length, open[t].length]).toEqual([18, 2, 7]);
      const rank = (q: any) => ['basic', 'atom', 'solutions'].indexOf(q.chapter.order_index === 1 ? 'basic' : q.chapter.order_index === 2 ? 'basic' : (q.topic.order_index <= 8 ? 'atom' : q.topic.order_index <= 10 ? 'basic' : 'solutions'));
      const ranks = tests[t].map(rank);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }
    const ids = [...tests, ...matching, ...open].flat().map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('если раздел не пройден, его баллы делятся между остальными', () => {
    const picked = pickNct(pool(all49.filter((n) => n <= 33), { test: 12, matching: 6, open: 8 }), 1, rng(3));
    expect(picked.sections).toEqual(['basic']);
    expect([picked.kinds[0][0].length, picked.kinds[1][0].length, picked.kinds[2][0].length]).toEqual([18, 2, 7]);
  });

  it('темы уровней 4+ пропускаются с пояснением', () => {
    const p = pool([1, 2, 3], { test: 12, matching: 2, open: 4 });
    p.push({ id: 'x', type: 'test', topic_id: 'tx', chapter_id: 'c4', num: 1, chapter: { order_index: 4 }, topic: { order_index: 1 } });
    const picked = pickNct(p, 1, rng(1));
    expect(picked.notes.some((n) => n.includes('уровни 4'))).toBe(true);
  });

  it('метки: типы не повторяются в билете, во всех вариантах тип обычно один, есть задания из сборника НЦТ', () => {
    const types = ['MOL', 'RTYPE', 'MIX', 'VAL', 'EQ', 'MASSRATIO', 'RATE', 'DENS', 'GASMASS', 'OXCLASS', 'NPART', 'SO', 'BOND', 'LATTICE', 'CONFIG', 'PERIODIC', 'UNPAIRED', 'ELECTROLYTE', 'IONEQ', 'HYDRO_TYPE', 'HYDRO_MEDIUM', 'DISS', 'PH_ROW', 'IONEX'];
    const p = pool(all49, { test: 24, matching: 6, open: 12 });
    p.forEach((q, i) => { q.nct_type = types[Math.floor(i / 6) % types.length]; q.isNct = i % 5 === 0; });
    const picked = pickNct(p, 2, rng(11));
    const [tests] = picked.kinds;
    for (let t = 0; t < 2; t++) {
      const codes = tests[t].map((q: any) => q.nct_type);
      expect(new Set(codes).size).toBe(codes.length);
    }
    // во всех вариантах место, как правило, имеет один тип (метки соседних вопросов на стыке групп могут отличаться)
    const same = tests[0].filter((q: any, i: number) => tests[1][i].nct_type === q.nct_type).length;
    expect(same).toBeGreaterThanOrEqual(14);
    const nct = picked.kinds.flat(2).filter((q: any) => q.isNct).length;
    expect(nct).toBeGreaterThan(0);
  });

  it('запрещённые типы 1-го круга не берутся, пока есть другие', () => {
    const p = pool(all49, { test: 10, matching: 2, open: 4 });
    p.forEach((q, i) => { q.nct_type = i % 2 ? 'REACT_WITH' : null; });
    const picked = pickNct(p, 1, rng(5));
    expect(picked.kinds[0][0].every((q: any) => q.nct_type !== 'REACT_WITH')).toBe(true);
  });

  it('замена в билете НЦТ: раздел, вид и тип места, источник', () => {
    const mk = (id: string, ch: number, topic: number, nct: string | null, isNct = false, type = 'test') => ({
      id, type, topic_id: `${ch}-${topic}`, chapter: { order_index: ch }, topic: { order_index: topic }, nct_type: nct, isNct,
    }) as any;
    const pool = [
      mk('a1', 1, 3, 'MOL'), mk('a2', 1, 4, 'MOL'),         // основные понятия, тип MOL
      mk('a3', 1, 3, 'MOL', true),                                      // из сборника НЦТ
      mk('a4', 1, 3, 'RTYPE'),                                          // другой тип
      mk('a5', 1, 3, null),                                             // без метки
      mk('b1', 3, 2, 'MOL'),                                            // раздел «атом» (тема 35)
      mk('a6', 1, 4, 'MOL', false, 'open'),                             // другой вид
      mk('a7', 1, 5, 'REACT_WITH'),                                     // запрещённый тип
      mk('x1', 4, 1, 'MOL'),                                            // тема вне уровней 1–3
    ];
    const links = buildLinks([]);
    const ids = (r: any[]) => r.map((q) => q.id).sort();
    // место с меткой MOL, обычный источник: только вопросы MOL раздела «основные понятия», не из сборника НЦТ
    const info = { section: 'basic' as const, nctType: 'MOL', isNct: false };
    expect(ids(nctCandidatesFor(pool, 'test', new Set(), [], links, info, new Set()))).toEqual(['a1', 'a2']);
    // «любой источник» добавляет вопрос из сборника НЦТ
    expect(ids(nctCandidatesFor(pool, 'test', new Set(), [], links, info, new Set(), true))).toEqual(['a1', 'a2', 'a3']);
    // уже стоящий в наборе не берётся
    expect(ids(nctCandidatesFor(pool, 'test', new Set(['a1']), [], links, info, new Set()))).toEqual(['a2']);
    // место без метки: неразмеченные и разрешённые типы, которых нет в билете; запрещённые и стоящие в билете — нет
    const loose = { section: 'basic' as const, nctType: null, isNct: false };
    expect(ids(nctCandidatesFor(pool, 'test', new Set(), [], links, loose, new Set(['MOL'])))).toEqual(['a4', 'a5']);
    // место из сборника НЦТ меняется на вопрос из сборника НЦТ
    expect(ids(nctCandidatesFor(pool, 'test', new Set(), [], links, { section: 'basic', nctType: 'MOL', isNct: true }, new Set()))).toEqual(['a3']);
    // раздел не определён — кандидатов нет
    expect(nctCandidatesFor(pool, 'test', new Set(), [], links, { section: null, nctType: 'MOL', isNct: false }, new Set())).toEqual([]);
  });
});
