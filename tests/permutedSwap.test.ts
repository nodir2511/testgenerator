import { describe, expect, it } from 'vitest';
import { CHEM_CONFIG, pickNct } from '../supabase/functions/_shared/nct';
import { CHEM_RELATED } from '../supabase/functions/_shared/nctRelated';
import { NCT_TYPES } from '../src/lib/nctTypes';
import { isPermutedBatch, mirrorChanges, nctCandidatesFor, nctTieredCandidates, planTopicRemoval, sameTypeElsewhere, scopeTopicIds, sectionOfPoolQ, twinSlots, withoutTwins, type PoolQ, type QType, type Slot } from '../src/lib/questionSwap';

describe('замена в билете НЦТ по типу задания', () => {
  // химия: тема 1.1 — раздел «Основные понятия», тема 5.1 — «Органика»
  const q = (id: string, ch: number, tp: number, nct: string | null, isNct = false): PoolQ =>
    ({ ...pq(id, `t${ch}.${tp}`), chapter: { order_index: ch }, topic: { order_index: tp }, nct_type: nct, isNct });
  const pool = [q('a', 1, 1, 'X'), q('b', 5, 1, 'X'), q('c', 5, 1, 'Y'), q('d', 1, 1, 'X', true)];
  const info = { section: sectionOfPoolQ(pool[0]), nctType: 'X', isNct: false };
  const ids = (l: PoolQ[]) => l.map((x) => x.id).sort();

  it('без byType — только раздел места', () => {
    expect(ids(nctCandidatesFor(pool, 'test', new Set(), [], new Map(), info, new Set()))).toEqual(['a']);
  });
  it('byType — вопрос с той же меткой из любой темы, источник тот же', () => {
    expect(ids(nctCandidatesFor(pool, 'test', new Set(), [], new Map(), info, new Set(), false, undefined, true))).toEqual(['a', 'b']);
  });
  it('byType + любой источник — добавляется сборник НЦТ', () => {
    expect(ids(nctCandidatesFor(pool, 'test', new Set(), [], new Map(), info, new Set(), true, undefined, true))).toEqual(['a', 'b', 'd']);
  });
});

describe('близкие типы химии', () => {
  it('все коды семей есть в справочнике типов, связи симметричны', () => {
    const known = new Set(NCT_TYPES.map((t) => t.code));
    for (const [a, list] of Object.entries(CHEM_RELATED)) {
      expect(known.has(a), a).toBe(true);
      for (const b of list) expect(CHEM_RELATED[b]).toContain(a);
    }
  });
  it('вывод формулы органики ↔ неорганический вывод формулы и нахождение вещества', () => {
    expect(CHEM_RELATED.ORG_FORMULA).toEqual(expect.arrayContaining(['FORMULA_CALC', 'EL_IDENT_CALC', 'EQUIV_AR']));
  });
  it('генератор: нужного типа нет — берёт близкий и пишет об этом', () => {
    // раздел «основные понятия» (глава 1, тема 1): на месте ждут тип A, в пуле только близкий B
    const cfg = { ...CHEM_CONFIG, slotTypes: { 'basic:test': { A: 1 } }, related: { A: ['B'], B: ['A'] }, banned: new Set<string>(), quota: { test: 0, matching: 0, open: 0 } };
    const pool = Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, type: 'test', topic_id: `t${i % 5}`, chapter: { order_index: 1 }, topic: { order_index: 1 }, nct_type: 'B', nct_difficulty: 1 }));
    const got = pickNct(pool, 1, () => 0.3, undefined, undefined, cfg);
    expect(got.kinds[0][0].some((x: any) => x.nct_type === 'B')).toBe(true);
    expect(got.notes.join(' ')).toMatch(/близкие типы/);
  });
});

describe('генератор: тип на позиции один во всех вариантах', () => {
  it('нет ни нужного, ни близкого типа — берётся один другой тип на все варианты, а не смесь', () => {
    const cfg = { ...CHEM_CONFIG, slotTypes: { 'basic:test': { A: 1 } }, related: {}, banned: new Set<string>(), quota: { test: 0, matching: 0, open: 0 } };
    // по 8 вопросов типов C, D, E (каждого хватает ровно на 2 позиции в 4 вариантах) и 2 неразмеченных
    const pool = [...['C', 'D', 'E'].flatMap((c) => Array.from({ length: 8 }, (_, i) => ({ id: `${c}${i}`, nct_type: c }))), { id: 'u1', nct_type: null }, { id: 'u2', nct_type: null }]
      .map((q, i) => ({ ...q, type: 'test', topic_id: `t${i % 7}`, chapter: { order_index: 1 }, topic: { order_index: 1 }, nct_difficulty: 1 }));
    const got = pickNct(pool, 4, () => 0.42, undefined, undefined, cfg);
    const T = got.kinds[0];
    // первые 6 позиций (на них хватает однотипных вопросов) — у всех вариантов один тип
    for (let pos = 0; pos < 6; pos++) {
      const types = new Set(T.map((v: any[]) => v[pos]?.nct_type ?? null));
      expect(types.size, `позиция ${pos + 1}`).toBe(1);
    }
  });
});

describe('замена в билете НЦТ по ступеням', () => {
  const q = (id: string, topic: string, nct: string): PoolQ =>
    ({ ...pq(id, topic, 'open'), chapter: { order_index: 5 }, topic: { order_index: 3 }, nct_type: nct });
  const cfg = { ...CHEM_CONFIG, related: { ORG_FORMULA: ['FORMULA_CALC'], FORMULA_CALC: ['ORG_FORMULA'] } };
  const info = { section: 'organic' as const, nctType: 'ORG_FORMULA', isNct: false };
  const run = (pool: PoolQ[], scope: Set<string> | null) => nctTieredCandidates(pool, 'open', new Set(), [], new Map(), info, new Set(), false, cfg, scope);

  it('1) та же метка в выбранных темах', () => {
    const r = run([q('a', 'T1', 'ORG_FORMULA'), q('b', 'T2', 'ORG_FORMULA')], new Set(['T1']));
    expect(r.tier).toBe('same'); expect(r.cands.map((x) => x.id)).toEqual(['a']);
  });
  it('2) нет — близкий тип из выбранных тем раньше той же метки вне выбора', () => {
    const r = run([q('b', 'T2', 'ORG_FORMULA'), q('c', 'T1', 'FORMULA_CALC')], new Set(['T1']));
    expect(r.tier).toBe('related'); expect(r.cands.map((x) => x.id)).toEqual(['c']);
  });
  it('3) в выборе ничего — та же метка из других тем', () => {
    const r = run([q('b', 'T2', 'ORG_FORMULA'), q('d', 'T2', 'FORMULA_CALC')], new Set(['T1']));
    expect(r.tier).toBe('same-wide'); expect(r.cands.map((x) => x.id)).toEqual(['b']);
  });
  it('4) затем близкие из других тем', () => {
    const r = run([q('d', 'T2', 'FORMULA_CALC')], new Set(['T1']));
    expect(r.tier).toBe('related-wide');
  });
});

describe('тот же тип на позиции во всех вариантах', () => {
  const s = (n: number, i: number, qid: string, nct: string | null, type: QType = 'open'): Slot => ({ ...slot(n, i, qid, 'T1', type), nctType: nct });
  const p = (id: string, nct: string, topic = 'T1', type: QType = 'open'): PoolQ => ({ ...pq(id, topic, type), nct_type: nct });

  it('в других вариантах на том же месте ставится вопрос нового типа, реже бравшийся первым', () => {
    const slots = [s(1, 27, 'a1', 'ORG_FORMULA'), s(2, 27, 'a2', 'ORG_FORMULA'), s(3, 27, 'a3', 'ORG_FORMULA'), s(1, 26, 'b1', 'X')];
    const pool = [p('n1', 'FORMULA_CALC'), { ...p('n2', 'FORMULA_CALC'), usage: [{ times_used: 5 }] }, p('n3', 'FORMULA_CALC'), p('z', 'OTHER')];
    const r = sameTypeElsewhere(slots, slots[0], pool[0], pool, null, new Map());
    expect(r.changes.map((c) => [c.slot.tqId, c.question!.id])).toEqual([['tq2-27', 'n3'], ['tq3-27', 'n2']]);
    expect(r.missing).toEqual([]);
  });
  it('тип не изменился и в других вариантах тот же — остальные не трогаются', () => {
    const slots = [s(1, 27, 'a1', 'ORG_FORMULA'), s(2, 27, 'a2', 'ORG_FORMULA')];
    expect(sameTypeElsewhere(slots, slots[0], p('n1', 'ORG_FORMULA'), [p('n2', 'ORG_FORMULA')], null, new Map()).changes).toEqual([]);
  });
  it('выбран тот же тип, но в варианте 2 на этом месте другой — вариант 2 выравнивается', () => {
    const slots = [s(1, 27, 'a1', 'A'), s(2, 27, 'a2', 'B')];
    const r = sameTypeElsewhere(slots, slots[0], p('n1', 'A'), [p('n1', 'A'), p('n2', 'A')], null, new Map());
    expect(r.changes.map((c) => [c.slot.tqId, c.question!.id])).toEqual([['tq2-27', 'n2']]);
  });
  it('переставленные: замена в варианте 3 выравнивает вариант 2 на месте-двойнике варианта 1', () => {
    // вариант 3 = вариант 1 с перестановкой: a1 стоит на месте 5, в варианте 1 — на месте 27
    const slots = [s(1, 27, 'a1', 'A'), s(1, 5, 'x1', 'A'), s(2, 27, 'a2', 'C'), s(2, 5, 'x2', 'A'), s(3, 5, 'a1', 'A'), s(3, 27, 'x1', 'A'), s(4, 9, 'a2', 'C'), s(4, 5, 'x2', 'A')];
    const r = sameTypeElsewhere(slots, slots[4], p('n1', 'B'), [p('n1', 'B'), p('n2', 'B')], null, new Map(), true);
    expect(r.changes.map((c) => c.slot.tqId)).toEqual(['tq2-27']);
  });
  it('сначала темы выбора набора; не хватило — вариант в списке нехватки', () => {
    const slots = [s(1, 27, 'a1', 'A'), s(2, 27, 'a2', 'A'), s(3, 27, 'a3', 'A')];
    const pool = [p('n1', 'B'), p('far', 'B', 'T9'), p('near', 'B', 'T1')];
    const r = sameTypeElsewhere(slots, slots[0], pool[0], pool, new Set(['T1']), new Map());
    expect(r.changes.map((c) => c.question!.id)).toEqual(['near', 'far']);
    const r2 = sameTypeElsewhere(slots, slots[0], pool[0], [pool[0], pool[2]], null, new Map());
    expect(r2.missing).toEqual([3]);
  });
  it('переставленные варианты: пара выбранного варианта не трогается (её заменит mirrorChanges)', () => {
    const slots = [s(1, 27, 'a1', 'A'), s(2, 27, 'a2', 'A'), s(3, 5, 'a1', 'A'), s(4, 9, 'a2', 'A')];
    const r = sameTypeElsewhere(slots, slots[0], p('n1', 'B'), [p('n1', 'B'), p('n2', 'B')], null, new Map(), true);
    expect(r.changes.map((c) => c.slot.tqId)).toEqual(['tq2-27']);
  });
});

describe('темы, выбранные при создании набора', () => {
  const topics = [{ id: 'a', chapterId: 'c1' }, { id: 'b', chapterId: 'c1' }, { id: 'c', chapterId: 'c2' }];
  it('заданы темы — только они', () => {
    expect([...scopeTopicIds({ topic_ids: ['b'], chapter_ids: ['c1', 'c2'] }, topics)!]).toEqual(['b']);
  });
  it('заданы главы — все темы этих глав', () => {
    expect([...scopeTopicIds({ chapter_ids: ['c1'] }, topics)!].sort()).toEqual(['a', 'b']);
  });
  it('весь предмет — без ограничения', () => {
    expect(scopeTopicIds({ topic_ids: [], chapter_ids: [] }, topics)).toBeNull();
    expect(scopeTopicIds(null, topics)).toBeNull();
  });
});

const pq = (id: string, topic: string, type: QType = 'test'): PoolQ => ({ id, topic_id: topic, type, chapter_id: 'c1', num: Number(id.replace(/\D/g, '')) || 0 });
const slot = (n: number, i: number, qid: string | null, topic: string | null, type: QType = 'test'): Slot => ({
  tqId: `tq${n}-${i}`, ticketId: `t${n}`, ticketNumber: n, orderIndex: i, questionId: qid, type, topicId: topic, chapterId: 'c1', linked: [],
});

// Набор «переставленные варианты» на 4 билета: 3 = 1 с перестановкой, 4 = 2 с перестановкой
function permBatch(): Slot[] {
  return [
    slot(1, 1, 'a1', 'A'), slot(1, 2, 'b1', 'B'), slot(1, 3, 'o1', 'B', 'open'),
    slot(2, 1, 'a2', 'A'), slot(2, 2, 'b2', 'B'), slot(2, 3, 'o2', 'B', 'open'),
    slot(3, 1, 'b1', 'B'), slot(3, 2, 'a1', 'A'), slot(3, 3, 'o1', 'B', 'open'),
    slot(4, 1, 'b2', 'B'), slot(4, 2, 'a2', 'A'), slot(4, 3, 'o2', 'B', 'open'),
  ];
}

describe('переставленные варианты НЦТ', () => {
  it('распознаёт набор по параметрам', () => {
    expect(isPermutedBatch({ nct: true, nct_perm: true })).toBe(true);
    expect(isPermutedBatch({ nct: true })).toBe(false);
    expect(isPermutedBatch(null)).toBe(false);
  });

  it('двойник вопроса — то же задание в варианте той же чётности', () => {
    const s = permBatch();
    expect(twinSlots(s, s[0]).map((x) => x.tqId)).toEqual(['tq3-2']);
    expect(twinSlots(s, s[6]).map((x) => x.tqId)).toEqual(['tq1-2']);
    expect(twinSlots(s, s[4]).map((x) => x.tqId)).toEqual(['tq4-1']);
  });

  it('при шести вариантах двойников два (1 ↔ 3 ↔ 5)', () => {
    const s = [...permBatch(), slot(5, 1, 'o1', 'B', 'open'), slot(5, 2, 'b1', 'B'), slot(5, 3, 'a1', 'A')];
    expect(twinSlots(s, s[0]).map((x) => x.tqId).sort()).toEqual(['tq3-2', 'tq5-3']);
  });

  it('пустое место: k-е пустое того же вида, если пустых поровну', () => {
    const s = permBatch();
    s[0] = slot(1, 1, null, null);
    s[7] = slot(3, 2, null, null);
    expect(twinSlots(s, s[0]).map((x) => x.tqId)).toEqual(['tq3-2']);
    // в варианте 3 пустого места нет — пары нет
    const t = permBatch();
    t[0] = slot(1, 1, null, null);
    expect(twinSlots(t, t[0])).toEqual([]);
  });

  it('замена в варианте 1 повторяется в варианте 3, но не в 2 и 4', () => {
    const s = permBatch();
    const q = pq('a9', 'A');
    const out = mirrorChanges(s, [{ slot: s[0], question: q }]);
    expect(out.map((c) => c.slot.tqId).sort()).toEqual(['tq1-1', 'tq3-2']);
    expect(out.every((c) => c.question === q)).toBe(true);
  });

  it('снятие темы: варианты 1 и 3 получают одни и те же вопросы', () => {
    const s = permBatch();
    const pool = Array.from({ length: 6 }, (_, i) => pq(`b${i + 10}`, 'B'));
    const plan = planTopicRemoval(withoutTwins(s, 'A'), 'A', pool);
    const changes = mirrorChanges(s, plan.changes);
    expect(changes).toHaveLength(4);
    const by = new Map(changes.map((c) => [c.slot.tqId, c.question!.id]));
    expect(by.get('tq1-1')).toBe(by.get('tq3-2'));
    expect(by.get('tq2-1')).toBe(by.get('tq4-2'));
    expect(by.get('tq1-1')).not.toBe(by.get('tq2-1'));
  });
});
