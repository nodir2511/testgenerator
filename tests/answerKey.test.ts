import { describe, it, expect } from 'vitest';
import fs from 'fs';
import JSZip from 'jszip';
import { buildAnswerKeyDocx, keyKindOf, keyTemplateName } from '../src/lib/answerKey';

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
    for (const n of ['Химия', 'химия', 'Физика', 'Биология', 'Таджикский язык', 'Забони тоҷикӣ', 'Тоҷикӣ', 'Математика', 'История', 'English', '', 'ХИМИЯ 11', 'Право', 'Основы права', 'Ҳуқуқ', 'Правописание']) {
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

describe('ключи таджикского языка: шаблон под состав', () => {
  const matching = (id: string) => ({ question_snapshot: { id, type: 'matching', matching_items: [
    ...[1, 2, 3, 4].map((i) => ({ id: `${id}l${i}`, side: 'left', order_index: i, correct_match_id: `${id}r${i}` })),
    ...[1, 2, 3, 4, 5].map((i) => ({ id: `${id}r${i}`, side: 'right', order_index: i })),
  ] } });
  const open = (id: string) => ({ question_snapshot: { id, type: 'open', correct_numeric_answer: 124 } });
  const ticket = (t: number, m: number, o: number) => ({ ticket_number: 1, questions: [
    ...Array.from({ length: t }, (_, i) => test(`t${i}`, 1)),
    ...Array.from({ length: m }, (_, i) => matching(`m${i}`)),
    ...Array.from({ length: o }, (_, i) => open(`o${i}`)),
  ] });
  const build = (tk: ReturnType<typeof ticket>) =>
    buildAnswerKeyDocx(fs.readFileSync(`templates/key/${keyTemplateName('taj', [tk])}.docx`), [tk]);

  it('20/4/2 собирается по шаблону, а не универсальной таблицей', async () => {
    const tk = ticket(20, 4, 2);
    expect(keyTemplateName('taj', [tk])).toBe('taj-cluster');
    const { stats } = await build(tk);
    expect(stats.universal).toBeUndefined();
    expect(stats.overflow).toBe(0);
  });

  it('все ответы написаны обычным шрифтом, жирные только номера', async () => {
    const xml = await (await JSZip.loadAsync((await build(ticket(20, 4, 2))).bytes)).file('word/document.xml')!.async('string');
    const tbl = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>'));
    // Ответы в таблице вставляет putText: у них, в отличие от номеров шаблона, есть xml:space
    const runs = tbl.match(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:t xml:space="preserve">[^<]*<\/w:t><\/w:r>/g) || [];
    expect(runs.length).toBe(20 + 4 * 4 + 2 * 3); // 20 букв, 4 соответствия по 4 цифры, 2 ответа по 3 цифры
    expect(runs.filter((r) => r.includes('<w:b/>'))).toHaveLength(0);
  });

  it('20/5/0 по-прежнему идёт в шаблон с пятью соответствиями', async () => {
    const tk = ticket(20, 5, 0);
    expect(keyTemplateName('taj', [tk])).toBe('taj');
    expect((await build(tk)).stats.universal).toBeUndefined();
  });

  it('право 20/5/0: свой шаблон, все ответы на месте', async () => {
    const tk = ticket(20, 5, 0);
    expect(keyTemplateName('law', [tk])).toBe('law');
    const { stats } = await buildAnswerKeyDocx(fs.readFileSync('templates/key/law.docx'), [tk]);
    expect(stats.universal).toBeUndefined();
    expect(stats.overflow).toBe(0);
  });

  it('история 20/4/2: свой шаблон, все ответы на месте', async () => {
    const tk = ticket(20, 4, 2);
    expect(keyTemplateName('hist', [tk])).toBe('hist');
    const { stats } = await buildAnswerKeyDocx(fs.readFileSync('templates/key/hist.docx'), [tk]);
    expect(stats.universal).toBeUndefined();
    expect(stats.overflow).toBe(0);
  });

  it('математика 18/2/7: свой шаблон, все ответы на месте', async () => {
    const tk = ticket(18, 2, 7);
    expect(keyTemplateName('math', [tk])).toBe('math');
    const { stats } = await buildAnswerKeyDocx(fs.readFileSync('templates/key/math.docx'), [tk]);
    expect(stats.universal).toBeUndefined();
    expect(stats.overflow).toBe(0);
  });

  it('остальные предметы не затронуты', () => {
    expect(keyTemplateName('bio', [ticket(20, 4, 2)])).toBe('bio');
  });

  it('шаблоны есть и на сайте, и в функциях бота', async () => {
    const { KEY_TEMPLATES } = await import('../supabase/functions/_shared/keyTemplates');
    for (const name of ['taj', 'taj-cluster', 'law', 'hist', 'math']) {
      const file = fs.readFileSync(`templates/key/${name}.docx`);
      expect(KEY_TEMPLATES[name]).toBe(file.toString('base64'));
      expect(fs.readFileSync(`public/key-templates/${name}.docx`).equals(file)).toBe(true);
    }
  });
});
