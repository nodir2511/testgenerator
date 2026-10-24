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

describe('ключи ответов: состав не по шаблону', () => {
  const docXml = async (bytes: Uint8Array) => (await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string'));

  it('лишние вопросы не теряются: ключ собирается универсальной таблицей', async () => {
    const qs = Array.from({ length: 80 }, (_, i) => test(`q${i}`, (i % 4) + 1));
    const { bytes, stats } = await buildAnswerKeyDocx(template, [{ ticket_number: 7, questions: qs }]);
    expect(stats.overflow).toBe(0);
    expect(stats.universal).toBe(true);
    const xml = await docXml(bytes);
    expect(xml).toContain('Вариант 7');
    expect((xml.match(/<w:tr>/g) || []).length).toBe(81); // шапка + 80 вопросов
  });

  it('универсальный ключ: пропуски красятся, соответствия и открытые читаются', async () => {
    const qs: any[] = Array.from({ length: 80 }, (_, i) => test(`q${i}`, i === 0 ? null : 2));
    qs.push({ question_snapshot: { id: 'o', type: 'open', correct_numeric_answer: 12 } });
    qs.push({ question_snapshot: { id: 'm', type: 'matching', matching_items: [
      { id: 'l1', side: 'left', order_index: 1, correct_match_id: 'r2' },
      { id: 'l2', side: 'left', order_index: 2, correct_match_id: 'r1' },
      { id: 'r1', side: 'right', order_index: 1 }, { id: 'r2', side: 'right', order_index: 2 },
    ] } });
    const { bytes, stats } = await buildAnswerKeyDocx(template, [{ ticket_number: 1, questions: qs }]);
    expect(stats.universal).toBe(true);
    expect(stats.missing).toBe(1);
    expect(await fills(bytes)).toBe(1);
    const xml = await docXml(bytes);
    expect(xml).toContain('>12<');
    expect(xml).toContain('A–2');
  });

  it('стандартный состав остаётся в шаблоне', async () => {
    const { stats } = await buildAnswerKeyDocx(template, [{ ticket_number: 1, questions: [test('a', 1)] }]);
    expect(stats.universal).toBeUndefined();
  });
});
