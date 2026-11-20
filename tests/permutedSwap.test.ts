import { describe, expect, it } from 'vitest';
import { isPermutedBatch, mirrorChanges, nctCandidatesFor, planTopicRemoval, scopeTopicIds, sectionOfPoolQ, twinSlots, withoutTwins, type PoolQ, type QType, type Slot } from '../src/lib/questionSwap';

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
