import { describe, expect, it } from 'vitest';
import { nctCandidatesFor, buildLinks, planNctTopicRemoval } from '../src/lib/questionSwap';
import { difficultyTargets, expandPermuted, pickNct, planNct, sectionOfQuestion, sectionOfTopic, sectionOfTopicNumber, sectionPoints, topicNumber } from '../supabase/functions/_shared/nct';

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
    expect(topicNumber(8, 1)).toBeNull();
    expect([1, 33, 42, 43].map(sectionOfTopicNumber)).toEqual(['basic', 'basic', 'basic', 'basic']);
    expect([34, 41].map(sectionOfTopicNumber)).toEqual(['atom', 'atom']);
    expect([44, 49].map(sectionOfTopicNumber)).toEqual(['solutions', 'solutions']);
    expect(sectionOfTopicNumber(50)).toBeNull();
    // глава 7: темы 7.4–7.12 — в раздел «Растворы», остальные темы главы 7 не берутся
    expect(topicNumber(7, 4)).toBe(204);
    expect(sectionOfTopicNumber(topicNumber(7, 12)!)).toBe('solutions');
    expect(topicNumber(7, 3)).toBeNull();
    expect(topicNumber(7, 13)).toBeNull();
    // главы 4–6: химия элементов, органика, расчёты
    expect(sectionOfTopicNumber(topicNumber(4, 1)!)).toBe('elements');
    expect(sectionOfTopicNumber(topicNumber(5, 17)!)).toBe('organic');
    expect([8, 9, 10, 11, 13, 16, 18].map((t) => sectionOfTopicNumber(topicNumber(6, t)!))).toEqual(['elements', 'basic', 'elements', 'basic', 'elements', 'basic', 'elements']);
    expect([4, 5, 6, 10, 15].map((t) => sectionOfTopicNumber(topicNumber(4, t)!))).toEqual(['elements', 'basic', 'elements', 'basic', 'basic']);
    expect(topicNumber(6, 19)).toBeNull();
  });

  it('задание с органической меткой — всегда раздел «Органика», даже в общей теме; вне режима остаётся вне', () => {
    expect(sectionOfTopic('basic', 'ORG_FORMULA')).toBe('organic');
    expect(sectionOfTopic('elements', 'OM_CLASS')).toBe('organic');
    expect(sectionOfTopic('basic', 'DENS_CALC')).toBe('basic');
    expect(sectionOfTopic('basic', null)).toBe('basic');
    expect(sectionOfTopic(null, 'ORG_FORMULA')).toBeNull();
    // вопрос из темы 2.10 (сквозной номер 31, «Основные понятия») с меткой ORG_FORMULA попадает в раздел органики
    const q = { chapter: { order_index: 2 }, topic: { order_index: 10 }, nct_type: 'ORG_FORMULA' };
    expect(sectionOfQuestion(q)).toBe('organic');
    expect(sectionOfQuestion({ ...q, nct_type: 'DENS_CALC' })).toBe('basic');
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

  it('темы в билете максимально разнообразны: тема повторяется лишь когда тем в разделе не хватает', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const picked = pickNct(pool(all49, { test: 12, matching: 6, open: 8 }), 3, rng(seed));
      for (let t = 0; t < 3; t++) {
        const rows = picked.kinds.flatMap((k) => k[t]);
        const slots: Record<string, number> = {};
        const topics: Record<string, Record<string, number>> = {};
        for (const q of rows) {
          const n = +q.topic_id.slice(1);
          const sec = sectionOfTopicNumber(n)!;
          slots[sec] = (slots[sec] ?? 0) + 1;
          topics[sec] = topics[sec] ?? {};
          topics[sec][q.topic_id] = (topics[sec][q.topic_id] ?? 0) + 1;
        }
        const size: Record<string, number> = { basic: 33 + 2, atom: 8, solutions: 6 };
        for (const sec of Object.keys(slots)) {
          // тема может встретиться дважды только если мест в разделе больше, чем тем
          const maxRepeat = Math.max(...Object.values(topics[sec]));
          expect(maxRepeat).toBeLessThanOrEqual(Math.ceil(slots[sec] / size[sec]));
        }
      }
    }
  });

  it('если раздел не пройден, его баллы делятся между остальными', () => {
    const picked = pickNct(pool(all49.filter((n) => n <= 33), { test: 12, matching: 6, open: 8 }), 1, rng(3));
    expect(picked.sections).toEqual(['basic']);
    expect([picked.kinds[0][0].length, picked.kinds[1][0].length, picked.kinds[2][0].length]).toEqual([18, 2, 7]);
  });

  it('темы вне режима (глава 8 и выше) пропускаются с пояснением', () => {
    const p = pool([1, 2, 3], { test: 12, matching: 2, open: 4 });
    p.push({ id: 'x', type: 'test', topic_id: 'tx', chapter_id: 'c8', num: 1, chapter: { order_index: 8 }, topic: { order_index: 1 } });
    const picked = pickNct(p, 1, rng(1));
    expect(picked.notes.some((n) => n.includes('главы 7–10'))).toBe(true);
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

  it('замена в билете НЦТ: сначала та же сложность, нет таких — любая', () => {
    const mk = (id: string, d: number | null) => ({
      id, type: 'test', topic_id: `1-${id}`, chapter: { order_index: 1 }, topic: { order_index: 3 }, nct_type: 'MOL', isNct: false, nct_difficulty: d,
    }) as any;
    const pool = [mk('e1', 1), mk('m1', 2), mk('m2', 2), mk('h1', 3)];
    const links = buildLinks([]);
    const ids = (r: any[]) => r.map((q) => q.id).sort();
    const base = { section: 'basic' as const, nctType: 'MOL', isNct: false };
    expect(ids(nctCandidatesFor(pool, 'test', new Set(), [], links, { ...base, difficulty: 2 }, new Set()))).toEqual(['m1', 'm2']);
    expect(ids(nctCandidatesFor(pool, 'test', new Set(['m1', 'm2']), [], links, { ...base, difficulty: 2 }, new Set()))).toEqual(['e1', 'h1']);
    expect(ids(nctCandidatesFor(pool, 'test', new Set(), [], links, base, new Set()))).toEqual(['e1', 'h1', 'm1', 'm2']);
  });

  it('убрать тему в билете НЦТ: замены по месту, тип не повторяется, нет подходящего — пустое место', () => {
    const q = (id: string, topic: string, ch: number, ord: number, nct: string | null, type = 'test') => ({
      id, type, topic_id: topic, chapter: { order_index: ch }, topic: { order_index: ord }, nct_type: nct,
    }) as any;
    // билет 1: вопрос MOL из темы A (убираем), вопрос RTYPE из темы B, вопрос BOND из темы C (раздел «атом»)
    const slots = [
      { tqId: 't1', ticketId: 'T1', ticketNumber: 1, orderIndex: 1, questionId: 'sA', type: 'test', topicId: 'A', nctType: 'MOL', sourceId: null },
      { tqId: 't2', ticketId: 'T1', ticketNumber: 1, orderIndex: 2, questionId: 'sB', type: 'test', topicId: 'B', nctType: 'RTYPE', sourceId: null },
      { tqId: 't3', ticketId: 'T1', ticketNumber: 1, orderIndex: 3, questionId: 'sC', type: 'test', topicId: 'C', nctType: 'BOND', sourceId: null },
      { tqId: 't4', ticketId: 'T1', ticketNumber: 1, orderIndex: 4, questionId: 'sA2', type: 'open', topicId: 'A', nctType: 'MOL', sourceId: null },
    ] as any[];
    const pool = [
      q('b1', 'B', 1, 2, 'MOL'),    // подходит месту 1 (тот же тип MOL, раздел «основные понятия»)
      q('b2', 'B', 1, 2, 'RTYPE'),  // другой тип
      q('c1', 'C', 3, 2, 'MOL'),    // раздел «атом» — не подходит
    ];
    const sectionOf = (t: string) => (t === 'C' ? 'atom' : 'basic') as any;
    const plan = planNctTopicRemoval(slots, 'A', pool, sectionOf, () => false, ['A', 'B', 'C']);
    const bySlot = new Map(plan.changes.map((c) => [c.slot.tqId, c.question?.id ?? null]));
    expect(bySlot.get('t1')).toBe('b1');
    expect(bySlot.get('t4')).toBeNull(); // открытого MOL в пуле нет
    expect(plan.missing.open).toBe(1);
    expect(plan.fromTopic).toEqual({ B: 1 });
  });
});

describe('сложность в режиме НЦТ', () => {
  it('доли раскладываются на места: 18 → 9/7/2, 2 → по одному', () => {
    const cnt = (a: number[]) => [1, 2, 3].map((d) => a.filter((x) => x === d).length);
    expect(cnt(difficultyTargets(18, { easy: 50, medium: 40, hard: 10 }, rng(1)))).toEqual([9, 7, 2]);
    expect(difficultyTargets(7, { easy: 0, medium: 0, hard: 100 }, rng(1)).length).toBe(7);
    expect(cnt(difficultyTargets(18, { easy: 34, medium: 33, hard: 33 }, rng(1))).reduce((a, b) => a + b, 0)).toBe(18);
  });

  it('билет: открытые 2/3/2, тесты по долям, когда вопросов каждой сложности хватает', () => {
    const p = pool(all49, { test: 6, matching: 6, open: 6 }).map((q, i) => ({ ...q, nct_difficulty: (i % 3) + 1 }));
    for (let seed = 1; seed <= 5; seed++) {
      const r = pickNct(p, 1, rng(seed), undefined, { easy: 50, medium: 30, hard: 20 });
      const cnt = (rows: any[]) => [1, 2, 3].map((d) => rows.filter((q) => q.nct_difficulty === d).length);
      expect(cnt(r.kinds[2][0])).toEqual([2, 3, 2]);
      expect(cnt(r.kinds[0][0])).toEqual([9, 5, 4]);
    }
  });

  it('нужной сложности нет — берутся ближайшие, билет всё равно полный', () => {
    const p = pool(all49, { test: 4, matching: 4, open: 4 }).map((q) => ({ ...q, nct_difficulty: 1 }));
    const r = pickNct(p, 1, rng(3), undefined, { easy: 50, medium: 40, hard: 10 });
    expect(r.kinds[0][0].length + r.kinds[1][0].length + r.kinds[2][0].length).toBe(27);
  });

  it('выбор сложности выключен (null): билет полный, без заметки «взята ближайшая»', () => {
    const p = pool(all49, { test: 4, matching: 4, open: 4 }).map((q) => ({ ...q, nct_difficulty: 1 }));
    const r = pickNct(p, 1, rng(3), undefined, null);
    expect(r.kinds[0][0].length + r.kinds[1][0].length + r.kinds[2][0].length).toBe(27);
    expect(r.notes.some((n) => n.includes('сложности'))).toBe(false);
  });
});

describe('expandPermuted', () => {
  const mk = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }));
  const base = (): any => ({
    kinds: [[mk(6, 'a'), mk(6, 'b')], [mk(2, 'c'), mk(2, 'd')], [mk(1, 'e'), mk(1, 'f')]],
    ticketCount: 2,
  });
  it('вариант 3 — перестановка 1, вариант 4 — перестановка 2, внутри вида', () => {
    const r = expandPermuted(base(), 4, rng(5));
    expect(r.ticketCount).toBe(4);
    r.kinds.forEach((byTicket: any[][], k: number) => {
      expect(byTicket.length).toBe(4);
      for (const [t, b] of [[2, 0], [3, 1]]) {
        const ids = byTicket[t].map((q) => q.id);
        expect([...ids].sort()).toEqual(byTicket[b].map((q) => q.id).sort());
        if (byTicket[b].length > 1) byTicket[t].forEach((q, i) => expect(q.id).not.toBe(byTicket[b][i].id));
      }
    });
    expect(r.kinds[2][2][0].id).toBe('e0');
  });
  it('6 вариантов: перестановки одного исходного различаются', () => {
    const r = expandPermuted(base(), 6, rng(9));
    expect(r.kinds[0][2].map((q: any) => q.id).join()).not.toBe(r.kinds[0][4].map((q: any) => q.id).join());
  });
  it('пять разделов: главы 1–6 дают 27 заданий и все разделы в плане', () => {
    const q: any[] = [];
    const add = (ch: number, topics: number, per: number) => {
      for (let o = 1; o <= topics; o++) {
        for (const type of ['test', 'matching', 'open'] as const) {
          for (let i = 1; i <= per; i++) q.push({ id: `${type}-${ch}-${o}-${i}`, type, topic_id: `t${ch}-${o}`, chapter_id: `c${ch}`, num: i, chapter: { order_index: ch }, topic: { order_index: o } });
        }
      }
    };
    add(1, 21, 3); add(2, 12, 3); add(3, 16, 3); add(4, 15, 3); add(5, 17, 3); add(6, 18, 3);
    const picked = pickNct(q, 2, rng(11));
    expect(picked.sections.sort()).toEqual(['atom', 'basic', 'elements', 'organic', 'solutions']);
    expect(picked.kinds[0][0].length).toBe(18);
    expect(picked.kinds[1][0].length).toBe(2);
    expect(picked.kinds[2][0].length).toBe(7);
  });
});
