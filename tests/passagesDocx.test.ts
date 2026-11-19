import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildSingleTicketBlob, buildTicketsFile, isEnglishSubject, openBoxesFor, passageRuns, passageText } from '../src/lib/docxExport';
import { toSnapshot } from '../supabase/functions/_shared/ticketing';

const NO_SHUFFLE = { shuffleOptions: false, shuffleMatching: false };
const READING = { id: 'R', kind: 'reading', title: 'Space Tourism', content: 'UNIQUEREAD Tourists can see he/she and 24/7 views.\nSecond paragraph.' };
const CLOZE = { id: 'C', kind: 'cloze', title: 'Biggest Dog', content: 'UNIQUECLOZE a {{1}} b {{2}} c {{3}} d {{4}} e {{5}} f {{6}} g {{7}} h {{8}} end' };

function test(id: string, content: string, passage?: any, order?: number) {
  return toSnapshot({
    id, type: 'test', content,
    options: [0, 1, 2, 3].map((i) => ({ id: `${id}-o${i}`, text: `opt${i}`, order_index: i + 1, is_correct: i === 0 })),
    passage_id: passage?.id, passage_order: order, passage,
  }, NO_SHUFFLE);
}

/** 8 вопросов к чтению, 8 пропусков, 4 одиночных теста */
function englishTicket(number = 1) {
  const snaps = [
    ...Array.from({ length: 8 }, (_, i) => test(`r${i}`, `Reading question ${i + 1}`, READING, i + 1)),
    ...Array.from({ length: 8 }, (_, i) => test(`c${i}`, '', CLOZE, i + 1)),
    ...Array.from({ length: 4 }, (_, i) => test(`s${i}`, `Single ${i + 1}`)),
  ];
  return { ticket_number: number, questions: snaps.map((s) => ({ question_snapshot: s })) };
}

const xmlOf = async (blob: Blob) => (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe('passageRuns / passageText', () => {
  it('два отрезка: 1–8 (чтение) и 9–16 (пропуски)', () => {
    const runs = passageRuns(englishTicket().questions);
    expect(runs.map((r) => [r.start, r.end, r.passage.kind])).toEqual([[1, 8, 'reading'], [9, 16, 'cloze']]);
  });
  it('Review Focus 4: старый билет без passage — пусто', () => {
    const old = { ticket_number: 1, questions: [{ question_snapshot: test('a', 'Q') }, { question_snapshot: test('b', 'Q') }] };
    expect(passageRuns(old.questions)).toEqual([]);
  });
  it('Review Focus 4: «пустое место» внутри блока не разрывает его', () => {
    const t = englishTicket();
    t.questions[3] = { question_snapshot: { empty: true, type: 'test' } as any };
    expect(passageRuns(t.questions).map((r) => [r.start, r.end])).toEqual([[1, 8], [9, 16]]);
  });
  it('метки {{n}} → __номер__ с отсчётом от первого задания; чужие метки остаются', () => {
    expect(passageText('A {{1}} B {{2}}', 9)).toBe('A __9__ B __10__');
    expect(passageText('A {{9}} B {{0}}', 9)).toBe('A {{9}} B {{0}}'); // Review Focus 5: метка без пары остаётся
    expect(passageText('no labels', 9)).toBe('no labels');
    expect(passageText('A {{3}}', 1, 2)).toBe('A {{3}}');
  });
});

describe('Word: английский', () => {
  it('предмет определяется раньше таджикского, клетки: 5 у английского и таджикского, 4 у химии', () => {
    expect(isEnglishSubject('Забони англисӣ')).toBe(true);
    expect(isEnglishSubject('Английский язык')).toBe(true);
    expect(isEnglishSubject('Забони тоҷикӣ')).toBe(false);
    expect([openBoxesFor('Забони англисӣ'), openBoxesFor('Забони тоҷикӣ'), openBoxesFor('Химия')]).toEqual([5, 5, 4]);
  });

  it('текст печатается один раз перед блоком; шапка и задание на английском; пропуски пронумерованы', async () => {
    const xml = await xmlOf(await buildSingleTicketBlob('Exam', englishTicket(1), 'Английский язык', false));
    expect(xml).toContain('Variant 1');
    expect(xml).not.toContain('Вариант');
    expect(count(xml, 'UNIQUEREAD')).toBe(1);
    expect(count(xml, 'UNIQUECLOZE')).toBe(1);
    expect(xml).toContain('Read the text and choose the correct answer 1 – 8.');
    expect(xml).toContain('Read the text and choose the correct answer 9 – 16.');
    expect(xml).toContain('__9__');
    expect(xml).toContain('__16__');
    expect(xml).not.toContain('{{');
    expect(xml).toContain('Space Tourism');
  });

  it('he/she, 24/7 остаются словами, а не формулой Word', async () => {
    const xml = await xmlOf(await buildSingleTicketBlob('Exam', englishTicket(1), 'Английский язык', false));
    expect(xml).toContain('he/she');
    expect(xml).toContain('24/7');
    expect(xml).not.toContain('<m:f>');
  });

  it('Review Focus 4: «пустое место» внутри блока — текст один раз, пометка на английском', async () => {
    const t = englishTicket(2);
    t.questions[3] = { question_snapshot: { empty: true, type: 'test' } as any };
    const xml = await xmlOf(await buildSingleTicketBlob('Exam', t, 'Английский язык', false));
    expect(count(xml, 'UNIQUEREAD')).toBe(1);
    expect(xml).toContain('EMPTY PLACE');
  });

  it('Review Focus 5: текст пропусков с лишней меткой не роняет сборку', async () => {
    const t = englishTicket(3);
    for (const q of t.questions.slice(8, 16)) q.question_snapshot.passage = { ...CLOZE, content: 'x {{1}} y {{12}}' };
    const xml = await xmlOf(await buildSingleTicketBlob('Exam', t, 'Английский язык', false));
    expect(xml).toContain('{{12}}');
    expect(xml).toContain('__9__');
  });

  it('открытый вопрос: подпись Answer:, без «Ответ»', async () => {
    const open = toSnapshot({ id: 'o1', type: 'open', content: 'Write the numbers in the correct order.', correct_numeric_answer: 3142 }, NO_SHUFFLE);
    const xml = await xmlOf(await buildSingleTicketBlob('Exam', { ticket_number: 1, questions: [{ question_snapshot: open }] }, 'Английский язык', false));
    expect(xml).toContain('Answer:');
    expect(xml).not.toContain('Ответ');
  });

  it('английский — один язык: файл Variant N.docx, архив без папок RU/TJ, суффикс EN', async () => {
    const one = await buildTicketsFile('Exam', [englishTicket(1)], 'Английский язык', 'both');
    expect(one!.fileName).toBe('Variant 1.docx');
    const two = await buildTicketsFile('Exam', [englishTicket(1), englishTicket(2)], 'Английский язык', 'both');
    expect(two!.fileName).toBe('Exam_EN.zip');
    const names = Object.keys((await JSZip.loadAsync(await two!.blob.arrayBuffer())).files);
    expect(names.sort()).toEqual(['Variant 1.docx', 'Variant 2.docx']);
  });
});

describe('Word: другие предметы не изменились (Review Focus 1)', () => {
  it('химия: «Вариант», нет заданий на английском', async () => {
    const t = { ticket_number: 1, questions: [{ question_snapshot: test('a', 'Вопрос про he/she') }] };
    const xml = await xmlOf(await buildSingleTicketBlob('Экзамен', t, 'Химия', false));
    expect(xml).toContain('Вариант 1');
    expect(xml).not.toContain('Read the text');
    expect(xml).not.toContain('Variant');
  });
  it('таджикский: «Варианти», файл по-прежнему RU/TJ в архиве', async () => {
    const t = { ticket_number: 1, questions: [{ question_snapshot: test('a', 'Савол') }] };
    const f = await buildTicketsFile('Имтиҳон', [t, { ...t, ticket_number: 2 }], 'Забони тоҷикӣ', 'both');
    expect(f!.fileName).toBe('Имтиҳон_RU_TJ.zip');
  });
});
