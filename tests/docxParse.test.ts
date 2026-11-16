import { describe, expect, it } from 'vitest';
import { parseDocumentXml as parseRaw } from '../src/lib/docxParse';
import { pairBilingual } from '../src/lib/docxPair';
import { answerText, snapshotFromPaired } from '../src/lib/clusterTickets';

// Мини-документ Word: абзацы и таблицы как в сборниках (не из системы)
const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const cell = (...lines: string[]) => `<w:tc>${lines.map(p).join('')}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`;
const tbl = (...rows: string[]) => `<w:tbl>${rows.join('')}</w:tbl>`;
const doc = (...blocks: string[]) => `<w:document><w:body>${blocks.join('')}</w:body></w:document>`;

// Разбор как в книжке кластера (соответствия включены)
const parseDocumentXml = (xml: string, map: Record<string, string>) => parseRaw(xml, map, { matching: true });

const LEFT = ['A) Ньютон', 'B) Ом', 'C) Ампер', 'D) Вольт'];
const RIGHT = ['1) сила тока', '2) сила', '3) напряжение', '4) сопротивление', '5) мощность'];

describe('разбор Word не из системы: соответствия', () => {
  it('таблица: все пункты в одной строке, по абзацам в двух ячейках', () => {
    const qs = parseDocumentXml(doc(
      p('1. Сколько будет 2 + 2?'), p('A) 3'), p('B) 4'), p('C) 5'), p('D) 6'),
      p('2. Установите соответствие между учёным и величиной.'),
      tbl(row(cell(...LEFT), cell(...RIGHT))),
      p('3. Найдите x, если 2x = 10.'),
      tbl(row(cell('№'), cell('Ответ'), cell('№'), cell('Ответ')), row(cell('1'), cell('B'), cell('2'), cell('2431')), row(cell('3'), cell('5'), cell(''), cell(''))),
    ), {});
    expect(qs.map((q) => q.type)).toEqual(['test', 'matching', 'open']);
    const m = qs[1];
    expect(m.content).toContain('Установите соответствие');
    expect(m.matchingItems!.filter((x) => x.side === 'left').map((x) => x.text)).toEqual(['Ньютон', 'Ом', 'Ампер', 'Вольт']);
    expect(m.matchingItems!.filter((x) => x.side === 'right')).toHaveLength(5);
    expect(m.correctAnswer).toBe('2431');
    expect(qs[0].correctAnswer).toBe('B');
    expect(qs[2].correctAnswer).toBe('5');
  });

  it('таблица: по пункту в строке, пятый справа без пары слева', () => {
    const qs = parseDocumentXml(doc(
      p('1. Установите соответствие.'),
      tbl(...LEFT.map((l, i) => row(cell(l), cell(RIGHT[i]))), row(cell(''), cell(RIGHT[4]))),
    ), {});
    expect(qs[0].type).toBe('matching');
    expect(qs[0].matchingItems!.filter((x) => x.side === 'left')).toHaveLength(4);
    expect(qs[0].matchingItems!.filter((x) => x.side === 'right').map((x) => x.text)).toEqual(['сила тока', 'сила', 'напряжение', 'сопротивление', 'мощность']);
  });

  it('абзацами: A) … D), затем 1) … 5); следующий вопрос «2.» не путается', () => {
    const qs = parseDocumentXml(doc(
      p('1. Установите соответствие.'), ...LEFT.map(p), ...RIGHT.map(p),
      p('2. Столица Таджикистана?'), p('A) Худжанд B) Душанбе C) Бохтар D) Куляб'),
    ), {});
    expect(qs.map((q) => q.type)).toEqual(['matching', 'test']);
    expect(qs[0].matchingItems!.filter((x) => x.side === 'right')).toHaveLength(5);
    expect(qs[1].options).toHaveLength(4);
  });

  it('таблица данных в условии остаётся частью условия', () => {
    const qs = parseDocumentXml(doc(
      p('1. По таблице найдите массу.'), tbl(row(cell('V'), cell('2 л')), row(cell('ρ'), cell('1 кг/л'))),
      p('A) 1 кг'), p('B) 2 кг'), p('C) 3 кг'), p('D) 4 кг'),
    ), {});
    expect(qs[0].type).toBe('test');
    expect(qs[0].content).toContain('2 л');
  });

  it('пара RU + TJ: соответствие с ключом попадает в снимок книжки', () => {
    const ru = parseDocumentXml(doc(p('1. Установите соответствие.'), tbl(row(cell(...LEFT), cell(...RIGHT)))), {});
    const tj = parseDocumentXml(doc(p('1. Мувофиқатро муайян кунед.'), tbl(row(cell(...LEFT), cell(...RIGHT))),
      tbl(row(cell('№'), cell('Ҷавоб')), row(cell('1'), cell('2431')))), {});
    const [pair] = pairBilingual(ru, tj);
    expect(pair.errors).toEqual([]);
    expect(pair.type).toBe('matching');
    const snap = snapshotFromPaired({ ...pair, correctAnswer: pair.correctAnswer || tj[0].correctAnswer }, 'x');
    expect(snap.content_tg).toContain('Мувофиқат');
    expect(answerText(snap)).toBe('2431');
  });

  it('«Массовый импорт» (по умолчанию) разбирает по-старому: таблица под условием — часть условия', () => {
    const xml = doc(p('1. Установите соответствие.'), tbl(row(cell(...LEFT), cell(...RIGHT))));
    const old = parseRaw(xml, {});
    expect(old.map((q) => q.type)).toEqual(['open']);
    expect(old[0].content).toContain('Ньютон');
    expect(parseDocumentXml(xml, {})[0].type).toBe('matching');
  });
});
