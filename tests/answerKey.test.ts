import { describe, it, expect } from 'vitest';
import fs from 'fs';
import JSZip from 'jszip';
import { buildAnswerKeyDocx, keyKindOf } from '../src/lib/answerKey';

// Ключ по шаблону химии: вопросы без верного ответа должны попасть в stats.missing
// и быть видны в файле (красная заливка клетки), а вопросы с ответом — нет.
const template = fs.readFileSync('templates/key/chem.docx');
const opt = (i: number, ok: boolean) => ({ id: `o${i}`, text: `v${i}`, order_index: i, is_correct: ok });
const test = (id: string, correct: number | null) => ({
  question_snapshot: { id, type: 'test', options: [1, 2, 3, 4].map((i) => opt(i, i === correct)) },
});
const fills = async (bytes: Uint8Array) => {
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
  return (xml.match(/w:fill="FF9999"/g) || []).length;
};

describe('ключи ответов: пропуски', () => {
  it('без пропусков красных клеток нет', async () => {
    const { bytes, stats } = await buildAnswerKeyDocx(template, [{ ticket_number: 1, questions: [test('a', 1), test('b', 3)] }]);
    expect(stats.missing).toBe(0);
    expect(await fills(bytes)).toBe(0);
  });

  it('вопрос без верного ответа: считается и красится', async () => {
    const { bytes, stats } = await buildAnswerKeyDocx(template, [{ ticket_number: 1, questions: [test('a', 1), test('b', null), test('c', null)] }]);
    expect(stats.missing).toBe(2);
    expect(await fills(bytes)).toBe(2);
  });

  it('открытый вопрос без ответа красит все клетки ответа', async () => {
    const open = { question_snapshot: { id: 'o', type: 'open', correct_numeric_answer: null } };
    const { bytes, stats } = await buildAnswerKeyDocx(template, [{ ticket_number: 1, questions: [open] }]);
    expect(stats.missing).toBe(1);
    expect(await fills(bytes)).toBeGreaterThanOrEqual(1);
  });
});

describe('hasKeyTemplate (ленивый фасад)', () => {
  it('совпадает с keyKindOf', async () => {
    const { hasKeyTemplate } = await import('../src/lib/exportLazy');
    for (const n of ['Химия', 'химия', 'Физика', 'Биология', 'Таджикский язык', 'Забони тоҷикӣ', 'Тоҷикӣ', 'Математика', 'История', 'English', '', 'ХИМИЯ 11']) {
      expect(hasKeyTemplate(n)).toBe(keyKindOf(n) !== null);
    }
  });
});
