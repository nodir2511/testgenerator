import { describe, it, expect } from 'vitest';
import { parseDocumentXml } from '../src/lib/docxParse';

// Word склеивает соседние таблицы, если между ними удалить абзац: два задания оказываются в одной таблице.
const tc = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
const tr = (...cells: string[]) => `<w:tr>${cells.map(tc).join('')}</w:tr>`;
const tbl = (...rows: string[]) => `<w:tbl>${rows.join('')}</w:tbl>`;
const doc = (...parts: string[]) => `<w:document><w:body>${parts.join('<w:p/>')}</w:body></w:document>`;

const matching24 = [tr('24', 'Соотнесите'), tr('A) Растения', '1) Нет стенки'), tr('B) Грибы', '2) Муреин'), tr('C) Бактерии', '3) Целлюлоза'), tr('D) Животные', '4) Кератин'), tr('', '5) Хитин')];
const open25 = [tr('25', 'Сколько хромосом?'), tr('', ''), tr('', 'Ответ: ____')];

describe('склеенные таблицы заданий', () => {
  it('две таблицы, как должно быть', () => {
    const qs = parseDocumentXml(doc(tbl(...matching24), tbl(...open25)));
    expect(qs.map((q) => [q.num, q.type])).toEqual([['24', 'matching'], ['25', 'open']]);
  });

  it('склеенные в одну таблицу читаются так же, как две', () => {
    const qs = parseDocumentXml(doc(tbl(...matching24, ...open25)));
    expect(qs.map((q) => [q.num, q.type])).toEqual([['24', 'matching'], ['25', 'open']]);
  });

  it('три задания в одной таблице', () => {
    const qs = parseDocumentXml(doc(tbl(tr('1', 'Тест'), tr('A) a', 'B) b'), tr('C) c', 'D) d'), ...matching24.map((r, i) => (i === 0 ? tr('2', 'Соотнесите') : r)), ...open25.map((r, i) => (i === 0 ? tr('3', 'Открытый') : r)))));
    expect(qs.map((q) => [q.num, q.type])).toEqual([['1', 'test'], ['2', 'matching'], ['3', 'open']]);
  });
});
