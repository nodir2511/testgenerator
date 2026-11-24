import { describe, it, expect } from 'vitest';
import { attemptsSheet, questionStats } from '../src/lib/examStats';

const testSnap = (correct: string, text = 'Вопрос') => ({
  id: 'q', type: 'test', content: text, content_ru: text,
  options: [
    { id: 'a', text: 'Альфа', text_ru: 'Альфа', is_correct: correct === 'a' },
    { id: 'b', text: 'Бета', text_ru: 'Бета', is_correct: correct === 'b' },
    { id: 'c', text: 'Гамма', text_ru: 'Гамма', is_correct: correct === 'c' },
  ],
});
const T = '2026-11-22T10:00:00Z';
const S = '2026-11-22T09:30:00Z'; // старт сессии
const BEFORE = '2026-11-22T09:00:00Z'; // попытка закрыта в ожидании, до старта
const mk = (id: string, qs: Array<[string, string | null, any]>, n = 1) => ({
  id, ticket_number: n, questions: qs.map(([qid, question_id, question_snapshot]) => ({ id: qid, question_id, question_snapshot })),
});
const att = (ticket_id: string, answers: Record<string, any>, finished_at: string | null = T, extra: any = {}) => ({ ticket_id, answers, finished_at, ...extra });

describe('questionStats', () => {
  it('один вопрос в двух вариантах суммируется по question_id', () => {
    const tickets = [
      mk('t1', [['tq1', 'Q1', testSnap('a')]], 1),
      mk('t2', [['tq2', 'Q1', testSnap('a')]], 2),
    ];
    const r = questionStats(tickets, [att('t1', { tq1: 'a' }), att('t2', { tq2: 'b' }), att('t2', { tq2: 'a' })], S);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ questionId: 'Q1', total: 3, answered: 3, type: 'test' });
    expect(r[0].avgShare).toBeCloseTo(2 / 3);
  });

  it('несданные попытки не считаются', () => {
    const tickets = [mk('t1', [['tq1', 'Q1', testSnap('a')]])];
    const r = questionStats(tickets, [att('t1', { tq1: 'a' }, null), att('t1', { tq1: 'b' })], S);
    expect(r[0].total).toBe(1);
    expect(r[0].avgShare).toBe(0);
  });

  it('закрытые в ожидании (до старта) и при несостоявшейся сессии не считаются', () => {
    const tickets = [mk('t1', [['tq1', 'Q1', testSnap('a')]])];
    const r = questionStats(tickets, [att('t1', { tq1: 'b' }, BEFORE), att('t1', { tq1: 'a' })], S);
    expect(r[0].total).toBe(1);
    expect(r[0].avgShare).toBe(1);
    expect(questionStats(tickets, [att('t1', { tq1: 'a' })], null)).toEqual([]);
  });

  it('wrongTop — самый частый неверный вариант теста (по тексту)', () => {
    const tickets = [mk('t1', [['tq1', 'Q1', testSnap('a')]])];
    const r = questionStats(tickets, [
      att('t1', { tq1: 'b' }), att('t1', { tq1: 'c' }), att('t1', { tq1: 'c' }), att('t1', { tq1: 'a' }), att('t1', {}),
    ], S);
    expect(r[0].wrongTop).toEqual({ text: 'Гамма', count: 2 });
    expect(r[0].answered).toBe(4);
  });

  it('пустое место пропускается', () => {
    const tickets = [mk('t1', [['tq1', 'Q1', testSnap('a')], ['tq2', null, { empty: true, type: 'test' }]])];
    const r = questionStats(tickets, [att('t1', { tq1: 'a' })], S);
    expect(r).toHaveLength(1);
  });

  it('сортирует от самых проваленных', () => {
    const tickets = [mk('t1', [['tq1', 'Q1', testSnap('a', 'Лёгкий')], ['tq2', 'Q2', testSnap('a', 'Трудный')]])];
    const r = questionStats(tickets, [att('t1', { tq1: 'a', tq2: 'b' }), att('t1', { tq1: 'a', tq2: 'c' })], S);
    expect(r.map((x) => x.label)).toEqual(['Трудный', 'Лёгкий']);
  });

  it('ответы с неизвестным tqId не ломают подсчёт; нет билета — попытка пропускается', () => {
    const tickets = [mk('t1', [['tq1', 'Q1', testSnap('a')]])];
    const r = questionStats(tickets, [att('t1', { ghost: 'a', tq1: 'a' }), att('missing', { tq1: 'a' })], S);
    expect(r).toHaveLength(1);
    expect(r[0].total).toBe(1);
  });

  it('нет сданных попыток — пустой список', () => {
    const tickets = [mk('t1', [['tq1', 'Q1', testSnap('a')]])];
    expect(questionStats(tickets, [], S)).toEqual([]);
    expect(questionStats(tickets, [att('t1', {}, null)], S)).toEqual([]);
  });

  it('соответствие и открытый вопрос: доля баллов', () => {
    const matching = {
      type: 'matching', content: 'Сопоставьте',
      matching_items: [
        { id: 'l1', side: 'left', text: 'Л1', order_index: 0, correct_match_id: 'r1' },
        { id: 'l2', side: 'left', text: 'Л2', order_index: 1, correct_match_id: 'r2' },
        { id: 'r1', side: 'right', text: 'П1', order_index: 0 },
        { id: 'r2', side: 'right', text: 'П2', order_index: 1 },
      ],
    };
    const open = { type: 'open', content: 'Число', correct_numeric_answer: 5 };
    const tickets = [mk('t1', [['tq1', 'M', matching], ['tq2', 'O', open]])];
    const r = questionStats(tickets, [att('t1', { tq1: { l1: 'r1', l2: 'r1' }, tq2: '5' })], S);
    const m = r.find((x) => x.questionId === 'M')!;
    expect(m.avgShare).toBeCloseTo(0.5);
    expect(m.wrongTop).toBeUndefined();
    expect(r.find((x) => x.questionId === 'O')!.avgShare).toBe(1);
  });
});

describe('attemptsSheet', () => {
  it('заголовок и по строке на попытку', () => {
    const tickets = [mk('t1', [['tq1', 'Q1', testSnap('a')]], 3)];
    const rows = attemptsSheet([
      att('t1', { tq1: 'a' }, T, { student_name: 'Алия', tg_username: 'aliya', tg_name: null, score: 1, max_score: 1, away_count: 2, away_ms: 47_600 }),
      att('t1', {}, null, { student_name: 'Борис', tg_username: null, tg_name: 'Boris', score: null, max_score: null }),
    ], tickets, S);
    expect(rows).toHaveLength(3);
    expect(rows[0].map((c) => c.value)).toEqual(['Имя', 'Аккаунт', 'Вариант', 'Баллы', 'Максимум', '%', 'Статус', 'Уходил, раз', 'Вне страницы, с']);
    expect(rows[1].map((c) => c.value)).toEqual(['Алия', '@aliya', 3, 1, 1, 100, 'сдал', 2, 48]);
    expect(rows[2].map((c) => c.value)).toEqual(['Борис', 'Boris', 3, '', '', '', 'не сдал', 0, 0]);
  });

  it('закрытая в ожидании — «не начал», без баллов', () => {
    const tickets = [mk('t1', [['tq1', 'Q1', testSnap('a')]], 3)];
    const rows = attemptsSheet([
      att('t1', {}, BEFORE, { student_name: 'Вера', tg_username: 'vera', score: 0, max_score: 1 }),
    ], tickets, S);
    expect(rows[1].map((c) => c.value)).toEqual(['Вера', '@vera', 3, '', '', '', 'не начал', 0, 0]);
  });

  it('без попыток — только заголовок', () => {
    expect(attemptsSheet([], [], S)).toHaveLength(1);
  });
});
