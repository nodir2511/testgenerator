import { describe, expect, it } from 'vitest';
import {
  applyToSlots, blockCandidates, blocksWithoutLinkClash, blockSlots, blockSwapChanges, buildLinks, buildRowChanges, candidatesFor, emptySnapshot, planTopicRemoval,
  type PoolQ, type Slot,
} from '../src/lib/questionSwap';

const SH = { shuffleOptions: false, shuffleMatching: false };

/** Вопрос лёгкого пула; passage — {id, kind, order} */
function pq(id: string, topic: string, o: { type?: 'test' | 'matching' | 'open'; passage?: { id: string; kind: 'reading' | 'cloze'; order: number }; num?: number; usage?: number } = {}): PoolQ {
  return {
    id, type: o.type ?? 'test', topic_id: topic, chapter_id: 'c1', num: o.num ?? 1,
    chapter: { order_index: 1 }, topic: { order_index: 1 },
    ...(o.passage ? { passage_id: o.passage.id, passage_order: o.passage.order, passage: { kind: o.passage.kind } } : {}),
    ...(o.usage ? { usage: [{ times_used: o.usage }] } : {}),
  } as any;
}

/** Текст из 8 вопросов в пуле */
const textPool = (pid: string, kind: 'reading' | 'cloze', topic: string, usage = 0) =>
  Array.from({ length: 8 }, (_, i) => pq(`${pid}-q${i + 1}`, topic, { passage: { id: pid, kind, order: i + 1 }, usage }));

let tq = 0;
function slot(ticket: number, order: number, qid: string | null, topic: string | null, passage?: { id: string; kind: 'reading' | 'cloze' }): Slot {
  return {
    tqId: `tq${++tq}`, ticketId: `T${ticket}`, ticketNumber: ticket, orderIndex: order, questionId: qid, type: 'test', topicId: topic, chapterId: 'c1',
    linked: [], passageId: passage?.id ?? null, passageKind: passage?.kind ?? null,
  } as Slot;
}

/** Билет: 8 мест текста чтения (из темы tA), затем n одиночных тестов */
function ticketSlots(ticket: number, pid: string, topic: string, singles = 4): Slot[] {
  return [
    ...Array.from({ length: 8 }, (_, i) => slot(ticket, i + 1, `${pid}-q${i + 1}`, topic, { id: pid, kind: 'reading' })),
    ...Array.from({ length: singles }, (_, i) => slot(ticket, 9 + i, `s${ticket}-${i}`, topic)),
  ];
}

describe('blockSlots', () => {
  it('вопрос текста → все 8 мест текста; обычный вопрос → только он сам', () => {
    const s = ticketSlots(1, 'RA', 'A');
    expect(blockSlots(s, 2)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(blockSlots(s, 9)).toEqual([9]);
  });

  it('Review Focus 4: «пустое место» внутри блока входит в блок и не роняет поиск', () => {
    const s = ticketSlots(1, 'RA', 'A');
    s[3] = slot(1, 4, null, null); // пустое место на месте 4-го вопроса текста
    expect(blockSlots(s, 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(blockSlots(s, 3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('пустое место вне блока — само по себе', () => {
    const s = ticketSlots(1, 'RA', 'A');
    s[10] = slot(1, 11, null, null);
    expect(blockSlots(s, 10)).toEqual([10]);
  });
});

describe('blockCandidates', () => {
  it('тот же вид, без занятых текстов, реже использованные первыми, неполные тексты не берутся', () => {
    const pool = [
      ...textPool('R1', 'A', 'tA', 5),
      ...textPool('R2', 'A', 'tA', 3),
      ...textPool('R3', 'A', 'tA', 1),
      ...textPool('C1', 'cloze', 'tA'),
      ...textPool('R4', 'reading', 'tA').slice(0, 7), // всего 7 вопросов
    ].map((q: any) => (q.passage_id === 'R1' || q.passage_id === 'R2' || q.passage_id === 'R3' ? { ...q, passage: { kind: 'reading' } } : q));
    const c = blockCandidates(pool, 'reading', new Set(['R1']));
    expect(c.map((b) => b.id)).toEqual(['R3', 'R2']);
    expect(c[0].questions.map((q: any) => q.passage_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(blockCandidates(pool, 'cloze', new Set()).map((b) => b.id)).toEqual(['C1']);
  });
});

describe('замена текста блоком', () => {
  it('8 мест получают вопросы нового текста в порядке passage_order', () => {
    const s = ticketSlots(1, 'RA', 'A');
    const block = blockCandidates(textPool('RB', 'reading', 'B'), 'reading', new Set(['RA']))[0];
    const changes = blockSwapChanges(blockSlots(s, 4).map((i) => s[i]), block);
    expect(changes).toHaveLength(8);
    expect(changes.map((c) => c.question?.id)).toEqual(Array.from({ length: 8 }, (_, i) => `RB-q${i + 1}`));
    expect(changes.map((c) => c.slot.orderIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('нет кандидатов → 8 пустых мест', () => {
    const s = ticketSlots(1, 'RA', 'A');
    const changes = blockSwapChanges(blockSlots(s, 0).map((i) => s[i]), null);
    expect(changes).toHaveLength(8);
    expect(changes.every((c) => c.question === null)).toBe(true);
    const rows = buildRowChanges(changes, new Map(), SH, () => 'Тема');
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.question_id === null && r.question_snapshot.empty === true)).toBe(true);
    const after = applyToSlots(s, rows, new Map());
    expect(after.slice(0, 8).every((x) => x.questionId === null && x.passageId == null)).toBe(true);
  });

  it('снимок нового вопроса несёт текст, а applyToSlots обновляет passageId', () => {
    const s = ticketSlots(1, 'RA', 'A');
    const block = blockCandidates(textPool('RB', 'reading', 'B'), 'reading', new Set(['RA']))[0];
    const changes = blockSwapChanges(blockSlots(s, 0).map((i) => s[i]), block);
    const full = new Map(block.questions.map((q: any) => [q.id, {
      ...q, content: 'Q', options: [], matching_items: [], passage: { id: 'RB', kind: 'reading', title: 'T', content: 'Text B' },
    }]));
    const rows = buildRowChanges(changes, full, SH, () => 'Тема');
    expect(rows[0].question_snapshot.passage).toEqual({ id: 'RB', kind: 'reading', title: 'T', content: 'Text B' });
    expect(rows[7].question_snapshot.passage_order).toBe(8);
    const meta = new Map(block.questions.map((q: any) => [q.id, { topicId: q.topic_id, chapterId: q.chapter_id, linked: [], passageId: 'RB', passageKind: 'reading' as const }]));
    const after = applyToSlots(s, rows, meta);
    expect(after.slice(0, 8).every((x) => x.passageId === 'RB' && x.topicId === 'B')).toBe(true);
    expect(after[8].passageId).toBeNull(); // одиночный тест не затронут
  });
});

describe('обычные замены не трогают вопросы текстов', () => {
  it('candidatesFor не предлагает вопросы к тексту как одиночные', () => {
    const pool = [pq('a', 'A'), pq('b', 'A'), ...textPool('RB', 'reading', 'A')];
    const c = candidatesFor(pool, 'test', new Set(), [], buildLinks(pool));
    expect(c.map((q) => q.id).sort()).toEqual(['a', 'b']);
  });
});

describe('убрать тему из набора с текстами', () => {
  it('текст убираемой темы заменяется целиком текстом другой темы, одиночные — одиночными', () => {
    const slots = [...ticketSlots(1, 'RA', 'A', 2), ...ticketSlots(2, 'RA2', 'A', 2)];
    // в билетах есть и тема B (одиночный тест), чтобы убирать A было куда
    slots.push(slot(1, 13, 'bx1', 'B'), slot(2, 13, 'bx2', 'B'));
    const pool = [
      ...textPool('RB', 'reading', 'B'), ...textPool('RB2', 'reading', 'B'),
      pq('b1', 'B'), pq('b2', 'B'), pq('b3', 'B'), pq('b4', 'B'), pq('b5', 'B'), pq('b6', 'B'),
    ];
    const plan = planTopicRemoval(slots, 'A', pool, ['A', 'B']);
    const blockChanges = plan.changes.filter((c) => c.slot.passageId);
    expect(blockChanges).toHaveLength(16);
    for (const t of [1, 2]) {
      const mine = blockChanges.filter((c) => c.slot.ticketNumber === t).sort((a, b) => a.slot.orderIndex - b.slot.orderIndex);
      expect(new Set(mine.map((c) => (c.question as any).passage_id)).size).toBe(1);
      expect(mine.map((c) => (c.question as any).passage_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    }
    const t1 = (blockChanges.find((c) => c.slot.ticketNumber === 1)!.question as any).passage_id;
    const t2 = (blockChanges.find((c) => c.slot.ticketNumber === 2)!.question as any).passage_id;
    expect(t1).not.toBe(t2);
    // одиночные тесты темы A заменены на обычные тесты, не на вопросы текстов
    const singles = plan.changes.filter((c) => !c.slot.passageId);
    expect(singles).toHaveLength(4);
    expect(singles.every((c) => c.question && !(c.question as any).passage_id)).toBe(true);
    expect(plan.missing.test).toBe(0);
  });

  it('нет подходящих текстов в остальных темах — пустые места, считаются в missing', () => {
    const slots = [...ticketSlots(1, 'RA', 'A', 0), slot(1, 9, 'bx', 'B')];
    const plan = planTopicRemoval(slots, 'A', [pq('b1', 'B')], ['A', 'B']);
    const changes = plan.changes.filter((c) => c.slot.passageId);
    expect(changes).toHaveLength(8);
    expect(changes.every((c) => c.question === null)).toBe(true);
    expect(plan.missing.test).toBe(8);
  });

  it('Review Focus 4: пустое место внутри блока убираемой темы не мешает замене блока', () => {
    const s = ticketSlots(1, 'RA', 'A', 0);
    s[2] = slot(1, 3, null, null);
    s.push(slot(1, 9, 'bx', 'B'));
    const plan = planTopicRemoval(s, 'A', [...textPool('RB', 'reading', 'B'), pq('b1', 'B')], ['A', 'B']);
    const ch = plan.changes.filter((c) => c.slot.orderIndex <= 8);
    expect(ch).toHaveLength(8); // пустое место внутри блока заполняется вместе со всем текстом
    expect(ch.every((c) => c.question !== null)).toBe(true);
    expect(ch.map((c) => (c.question as any).passage_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('пустое сообщение: набор без текстов планируется как раньше', () => {
    const slots = [slot(1, 1, 'a1', 'A'), slot(1, 2, 'a2', 'A'), slot(1, 3, 'b1', 'B')];
    const plan = planTopicRemoval(slots, 'A', [pq('b2', 'B'), pq('b3', 'B')], ['A', 'B']);
    expect(plan.changes.map((c) => c.question?.id).sort()).toEqual(['b2', 'b3']);
    expect(emptySnapshot('test').empty).toBe(true);
  });
});

describe('blocksWithoutLinkClash', () => {
  it('текст, вопрос которого связан с вопросом того же билета, не предлагается; чужие связи не мешают', () => {
    const pool = [...textPool('P-ok', 'reading', 'tA'), ...textPool('P-bad', 'reading', 'tA')];
    // вопрос P-bad-q3 связан с одиночным тестом s1-0, который остаётся в билете 1
    (pool.find((q: any) => q.id === 'P-bad-q3') as any).linked_ids = ['s1-0'];
    const slots = ticketSlots(1, 'P-old', 'tA');
    const members = slots.slice(0, 8);
    const blocks = blockCandidates(pool, 'reading', new Set(['P-old']));
    expect(blocks.map((b) => b.id).sort()).toEqual(['P-bad', 'P-ok']);
    expect(blocksWithoutLinkClash(blocks, slots, members).map((b) => b.id)).toEqual(['P-ok']);
  });
  it('связь с вопросом самого заменяемого текста не считается конфликтом (он уходит из билета)', () => {
    const pool = textPool('P-new', 'reading', 'tA');
    (pool.find((q: any) => q.id === 'P-new-q1') as any).linked_ids = ['P-old-q2'];
    const slots = ticketSlots(1, 'P-old', 'tA');
    const blocks = blockCandidates(pool, 'reading', new Set(['P-old']));
    expect(blocksWithoutLinkClash(blocks, slots, slots.slice(0, 8)).map((b) => b.id)).toEqual(['P-new']);
  });
});
