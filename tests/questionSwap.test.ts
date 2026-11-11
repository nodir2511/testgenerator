import { describe, expect, it } from 'vitest';
import { planTopicRemoval, candidatesFor, buildLinks, paramsAfterEdit, applyToSlots, emptySnapshot, type PoolQ, type Slot, type QType } from '../src/lib/questionSwap';

const pq = (id: string, topic: string, type: QType = 'test', extra: Partial<PoolQ> = {}): PoolQ => ({ id, topic_id: topic, type, chapter_id: 'c1', num: Number(id.replace(/\D/g, '')) || 0, ...extra });
const slot = (n: number, i: number, qid: string | null, topic: string | null, type: QType = 'test'): Slot => ({
  tqId: `tq${n}-${i}`, ticketId: `t${n}`, ticketNumber: n, orderIndex: i, questionId: qid, type, topicId: topic, chapterId: 'c1', linked: [],
});

describe('planTopicRemoval', () => {
  it('делит вопросы убранной темы поровну между остальными темами', () => {
    // 2 билета, по 3 теста темы A; в билетах ещё по 1 тесту тем B и C
    const slots: Slot[] = [];
    for (const n of [1, 2]) {
      [1, 2, 3].forEach((i) => slots.push(slot(n, i, `a${n}${i}`, 'A')));
      slots.push(slot(n, 4, `b${n}`, 'B'), slot(n, 5, `c${n}`, 'C'));
    }
    const pool = [...Array.from({ length: 10 }, (_, i) => pq(`b${i + 10}`, 'B')), ...Array.from({ length: 10 }, (_, i) => pq(`c${i + 10}`, 'C'))];
    const plan = planTopicRemoval(slots, 'A', pool);
    expect(plan.changes).toHaveLength(6);
    expect(plan.missing.test).toBe(0);
    // 3 позиции на 2 темы: в каждом билете 2+1 (одинаково во всех билетах), перекос не больше числа билетов
    expect(Math.abs(plan.fromTopic.B - plan.fromTopic.C)).toBeLessThanOrEqual(2);
    const perTicket = (t: string) => plan.changes.filter((c) => c.slot.ticketId === t).map((c) => c.question!.topic_id).sort().join('');
    expect(perTicket('t1')).toBe(perTicket('t2'));
    const ids = plan.changes.map((c) => c.question!.id);
    expect(new Set(ids).size).toBe(6); // без повторов
  });

  it('предпочитает тему, из которой в билетах меньше вопросов', () => {
    const slots = [slot(1, 1, 'a1', 'A'), slot(1, 2, 'b1', 'B'), slot(1, 3, 'b2', 'B'), slot(1, 4, 'c1', 'C')];
    const pool = [pq('b10', 'B'), pq('c10', 'C')];
    const plan = planTopicRemoval(slots, 'A', pool);
    expect(plan.changes[0].question!.topic_id).toBe('C');
  });

  it('заменяет тем же видом вопроса', () => {
    const slots = [slot(1, 1, 'a1', 'A', 'open'), slot(1, 2, 'b1', 'B')];
    const pool = [pq('b10', 'B', 'test'), pq('b11', 'B', 'open')];
    const plan = planTopicRemoval(slots, 'A', pool);
    expect(plan.changes[0].question!.id).toBe('b11');
  });

  it('если вопросов не хватает — оставляет пустое место и считает нехватку', () => {
    const slots = [slot(1, 1, 'a1', 'A'), slot(2, 1, 'a2', 'A'), slot(1, 2, 'b1', 'B'), slot(2, 2, 'b2', 'B')];
    const pool = [pq('b10', 'B')]; // свободный только один
    const plan = planTopicRemoval(slots, 'A', pool);
    expect(plan.changes.filter((c) => c.question)).toHaveLength(1);
    expect(plan.changes.filter((c) => !c.question)).toHaveLength(1);
    expect(plan.missing.test).toBe(1);
  });

  it('не берёт вопросы, уже стоящие в билетах набора, и связанные с вопросами билета', () => {
    const slots = [slot(1, 1, 'a1', 'A'), slot(1, 2, 'b1', 'B')];
    const pool = [pq('b1', 'B'), pq('b10', 'B', 'test', { linked_ids: ['b1'] }), pq('b11', 'B')];
    const plan = planTopicRemoval(slots, 'A', pool);
    expect(plan.changes[0].question!.id).toBe('b11');
  });

  it('берёт менее использованные вопросы раньше', () => {
    const slots = [slot(1, 1, 'a1', 'A'), slot(1, 2, 'b1', 'B')];
    const pool = [pq('b10', 'B', 'test', { usage: [{ times_used: 5 }] }), pq('b11', 'B', 'test', { usage: [{ times_used: 1 }] })];
    expect(planTopicRemoval(slots, 'A', pool).changes[0].question!.id).toBe('b11');
  });
});

describe('candidatesFor и параметры', () => {
  it('исключает использованные и тот же вид только', () => {
    const pool = [pq('x1', 'T'), pq('x2', 'T'), pq('x3', 'T', 'open')];
    const c = candidatesFor(pool, 'test', new Set(['x1']), [], buildLinks(pool));
    expect(c.map((q) => q.id)).toEqual(['x2']);
  });

  it('набор тем меняется — темы записываются явно; не меняется — выбор не трогается', () => {
    const before = [slot(1, 1, 'a1', 'A'), slot(1, 2, 'b1', 'B')];
    const same = applyToSlots(before, [{ ticket_question_id: 'tq1-1', question_id: 'a9', question_snapshot: {} }], new Map([['a9', { topicId: 'A', chapterId: 'c1' }]]));
    expect(paramsAfterEdit({ topic_ids: [], x: 1 }, before, same)).toEqual({ topic_ids: [], x: 1, edited: true });
    const changed = applyToSlots(before, [{ ticket_question_id: 'tq1-1', question_id: 'c1', question_snapshot: {} }], new Map([['c1', { topicId: 'C', chapterId: 'c2' }]]));
    const p = paramsAfterEdit({ topic_ids: [] }, before, changed);
    expect(p.topic_ids.sort()).toEqual(['B', 'C']);
  });

  it('пустое место: снимок помечен, тема сбрасывается', () => {
    expect(emptySnapshot('open').empty).toBe(true);
    const s = applyToSlots([slot(1, 1, 'a1', 'A')], [{ ticket_question_id: 'tq1-1', question_id: null, question_snapshot: {} }], new Map());
    expect(s[0].questionId).toBeNull();
    expect(s[0].topicId).toBeNull();
  });
});
