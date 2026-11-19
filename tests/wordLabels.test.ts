import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { groupByLabel, newFmtState, tokenizeFormatted } from '../src/lib/fractions';
import { formatProblem, plainText } from '../src/lib/questionChecks';

// Цифра над словом: морфологический разбор (задание № 25 билета НЦТ по таджикскому языку)
const SENTENCE = '<lab1>Забон</lab1> <lab2>барои</lab2> <lab3>мо</lab3> <lab4><b>воситаи</b> муҳими</lab4> <lab5>муошират</lab5> мебошад.';

describe('цифры над словами: разбор тегов', () => {
  it('куски получают номер цифры, лишние пробелы остаются без цифры', () => {
    const toks = tokenizeFormatted(SENTENCE, newFmtState());
    expect(toks.filter((t) => t.lab > 0).map((t) => [t.lab, t.text])).toEqual([[1, 'Забон'], [2, 'барои'], [3, 'мо'], [4, 'воситаи'], [4, ' муҳими'], [5, 'муошират']]);
    expect(toks.filter((t) => t.lab === 0).map((t) => t.text).join('')).toBe('     мебошад.');
  });
  it('группа слов с одной цифрой собирается вместе, даже если внутри есть <b>', () => {
    const groups = groupByLabel(tokenizeFormatted(SENTENCE, newFmtState())).filter((g) => g.lab > 0);
    expect(groups.map((g) => g.lab)).toEqual([1, 2, 3, 4, 5]);
    expect(groups[3].tokens.map((t) => t.text).join('')).toBe('воситаи муҳими');
  });
  it('обычный текст и текст без lab не меняются', () => {
    expect(tokenizeFormatted('H<sub>2</sub>O', newFmtState()).every((t) => t.lab === 0)).toBe(true);
    expect(plainText(SENTENCE)).toBe('Забон барои мо воситаи муҳими муошират мебошад.');
  });
});

describe('цифры над словами: проверка тегов', () => {
  it('lab1–lab9 допустимы, незакрытые и пустые — ошибка', () => {
    expect(formatProblem(SENTENCE)).toBe(false);
    expect(formatProblem('<lab1>слово')).toBe(true);
    expect(formatProblem('<lab2> </lab2>')).toBe(true);
    expect(formatProblem('<lab0>слово</lab0>')).toBe(true);
  });
});

describe('цифры над словами: Word', () => {
  it('в документе цифра стоит надписью над словом, а в тексте нет сырых тегов', async () => {
    const { buildSingleTicketBlob } = await import('../src/lib/docxExport');
    const q = { id: 'm1', type: 'test', content: `Выполните разбор: ${SENTENCE}`, content_ru: `Разбор: ${SENTENCE}`, content_tg: `Таҳлил кунед: ${SENTENCE}`,
      options: [{ id: 'a', text: 'А', is_correct: true }, { id: 'b', text: 'Б' }, { id: 'c', text: 'В' }, { id: 'd', text: 'Г' }] };
    const blob = await buildSingleTicketBlob('x', { ticket_number: 1, questions: [{ question_snapshot: q }] }, 'Таджикский язык', true);
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    expect(xml).not.toContain('lab1');
    expect(xml).not.toContain('&lt;lab');
    expect(xml).not.toContain('<undefined');
    const rubies = xml.match(/<w:ruby>/g) || [];
    expect(rubies.length).toBe(5);
    const rt = [...xml.matchAll(/<w:rt>.*?<w:t[^>]*>(\d)<\/w:t>.*?<\/w:rt>/g)].map((m) => m[1]);
    expect(rt).toEqual(['1', '2', '3', '4', '5']);
    expect(xml).toMatch(/<w:rubyBase>.*воситаи.*муҳими.*<\/w:rubyBase>/);
  });
});

describe('цифры над словами: показ на сайте', () => {
  it('FormattedText рисует <ruby> с цифрой над словом, по одной цифре на группу', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { FormattedText } = await import('../src/components/FormulaEditor');
    const html = renderToStaticMarkup(React.createElement(FormattedText, { text: SENTENCE }));
    expect((html.match(/<ruby/g) || []).length).toBe(5);
    expect([...html.matchAll(/<rt[^>]*>(\d)<\/rt>/g)].map((m) => m[1])).toEqual(['1', '2', '3', '4', '5']);
    expect(html).not.toContain('lab1');
    expect(html).toMatch(/<ruby[^>]*>(?:(?!<\/ruby>).)*воситаи(?:(?!<\/ruby>).)*муҳими(?:(?!<\/ruby>).)*<rt[^>]*>4<\/rt><\/ruby>/);
  });
});
