import { describe, expect, it } from 'vitest';
import { applyDraft, draftOf, draftProblem, rowsForEdit } from '../src/lib/snapshotEdit';

const mono = () => ({
  id: 'q1', type: 'test', content: 'Формула воды', content_ru: 'Формула воды', content_tg: 'Формула воды', image_url: null,
  options: [
    { id: 'o2', text: 'CO2', text_ru: 'CO2', text_tg: 'CO2', image_url: null, is_correct: false, order_index: 1 },
    { id: 'o1', text: 'H2O', text_ru: 'H2O', text_tg: 'H2O', image_url: null, is_correct: true, order_index: 2 },
  ],
});
const bilingual = () => ({
  id: 'q2', type: 'matching', content: 'Соотнесите', content_ru: 'Соотнесите', content_tg: 'Мувофиқ кунед',
  matching_items: [
    { id: 'l1', side: 'left', text: 'вода', text_ru: 'вода', text_tg: 'об', correct_match_id: 'r1', order_index: 1 },
    { id: 'r1', side: 'right', text: 'H2O', text_ru: 'H2O', text_tg: 'H2O', correct_match_id: null, order_index: 1 },
  ],
});

describe('правка снимка: черновик', () => {
  it('одноязычный вопрос — одно поле на текст', () => {
    const d = draftOf(mono())!;
    expect(d.bilingual).toBe(false);
    expect(d.content).toEqual({ ru: 'Формула воды', tg: null });
    expect(d.options.map((o) => [o.id, o.text.ru, o.text.tg])).toEqual([['o2', 'CO2', null], ['o1', 'H2O', null]]);
  });
  it('двуязычный вопрос — два поля, даже там, где тексты совпали', () => {
    const d = draftOf(bilingual())!;
    expect(d.bilingual).toBe(true);
    expect(d.content).toEqual({ ru: 'Соотнесите', tg: 'Мувофиқ кунед' });
    expect(d.items.map((m) => [m.id, m.side, m.text.ru, m.text.tg])).toEqual([['l1', 'left', 'вода', 'об'], ['r1', 'right', 'H2O', 'H2O']]);
  });
  it('пустое место править нельзя', () => {
    expect(draftOf({ empty: true, type: 'test' })).toBeNull();
    expect(draftOf(null)).toBeNull();
  });
});

describe('правка снимка: применение', () => {
  it('одноязычный: текст пишется во все языковые поля, ответы и порядок не трогаются', () => {
    const snap = mono();
    const d = draftOf(snap)!;
    d.content.ru = 'Формула воды?';
    d.options[1].text.ru = 'H₂O';
    const out = applyDraft(snap, d);
    expect(out.content).toBe('Формула воды?');
    expect(out.content_ru).toBe('Формула воды?');
    expect(out.content_tg).toBe('Формула воды?');
    expect(out.options[1]).toEqual({ id: 'o1', text: 'H₂O', text_ru: 'H₂O', text_tg: 'H₂O', image_url: null, is_correct: true, order_index: 2 });
    expect(out.options[0]).toEqual(snap.options[0]);
    expect(out.edited).toBe(true);
    expect(out.id).toBe('q1');
    // исходный снимок не изменён
    expect(snap.content).toBe('Формула воды');
    expect((snap as any).edited).toBeUndefined();
  });
  it('двуязычный: русский и таджикский меняются отдельно', () => {
    const snap = bilingual();
    const d = draftOf(snap)!;
    d.content.tg = 'Мувофиқат кунед';
    d.items[0].text.ru = 'Вода';
    const out = applyDraft(snap, d);
    expect([out.content, out.content_ru, out.content_tg]).toEqual(['Соотнесите', 'Соотнесите', 'Мувофиқат кунед']);
    expect(out.matching_items[0]).toMatchObject({ id: 'l1', text: 'Вода', text_ru: 'Вода', text_tg: 'об', correct_match_id: 'r1' });
  });
  it('без изменений возвращается тот же снимок без пометки', () => {
    const snap = mono();
    expect(applyDraft(snap, draftOf(snap)!)).toBe(snap);
  });
  it('варианты находятся по id, а не по месту', () => {
    const snap = mono();
    const d = draftOf(snap)!;
    d.options.reverse();
    d.options[0].text.ru = 'вода';
    const out = applyDraft(snap, d);
    expect(out.options.map((o: any) => [o.id, o.text])).toEqual([['o2', 'CO2'], ['o1', 'вода']]);
  });
});

describe('правка снимка: проверка', () => {
  it('условие нельзя стереть, если оно было', () => {
    const d = draftOf(mono())!;
    d.content.ru = '  ';
    expect(draftProblem(mono(), d)).toMatch(/услови/i);
  });
  it('пустое условие вопроса-пропуска остаётся допустимым', () => {
    const snap = { ...mono(), content: '', content_ru: '', content_tg: '' };
    expect(draftProblem(snap, draftOf(snap)!)).toBeNull();
  });
  it('вариант без текста допустим только с картинкой', () => {
    const snap = mono();
    const d = draftOf(snap)!;
    d.options[0].text.ru = '';
    expect(draftProblem(snap, d)).toMatch(/вариант/i);
    const withImage = mono();
    withImage.options[0].image_url = 'https://x/y.png' as any;
    const d2 = draftOf(withImage)!;
    d2.options[0].text.ru = '';
    expect(draftProblem(withImage, d2)).toBeNull();
  });
  it('в двуязычном вопросе таджикский текст тоже обязателен', () => {
    const d = draftOf(bilingual())!;
    d.items[0].text.tg = '';
    expect(draftProblem(bilingual(), d)).toMatch(/пункт/i);
  });
});

describe('правка снимка: строки для записи', () => {
  const tickets = () => [
    { id: 't1', ticket_number: 1, questions: [{ id: 'tq1', question_id: 'q1', question_snapshot: mono() }, { id: 'tq2', question_id: 'q2', question_snapshot: bilingual() }] },
    { id: 't3', ticket_number: 3, questions: [{ id: 'tq5', question_id: 'q1', question_snapshot: { ...mono(), options: [...mono().options].reverse() } }] },
  ];
  it('правка идёт во все места набора с тем же вопросом (переставленные варианты)', () => {
    const d = draftOf(mono())!;
    d.content.ru = 'Новая формулировка';
    const rows = rowsForEdit(tickets(), 'tq1', d);
    expect(rows.map((r) => [r.ticket_question_id, r.question_id, r.question_snapshot.content])).toEqual([
      ['tq1', 'q1', 'Новая формулировка'], ['tq5', 'q1', 'Новая формулировка'],
    ]);
    // у парного варианта свой порядок вариантов сохраняется
    expect(rows[1].question_snapshot.options.map((o: any) => o.id)).toEqual(['o1', 'o2']);
  });
  it('без изменений строк нет', () => {
    expect(rowsForEdit(tickets(), 'tq1', draftOf(mono())!)).toEqual([]);
  });
});
