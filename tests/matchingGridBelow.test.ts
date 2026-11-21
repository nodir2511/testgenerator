import { describe, it, expect } from 'vitest';
import { Document, Packer } from 'docx';
import JSZip from 'jszip';
import { createQuestionTable } from '../src/lib/docxExport';

// Минимальный PNG 8×8 (заголовок + IDAT), чтобы imageSize прочитал размеры
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=', 'base64'));

const item = (side: string, text: string, i: number) => ({ id: `${side}${i}`, side, text, text_ru: text, text_tg: text, order_index: i });
const make = (texts: string[]) => ({
  type: 'matching', content: 'Соотнесите', content_tg: 'Мувофиқат',
  matching_items: [
    ...texts.slice(0, 4).map((t, i) => item('left', t, i + 1)),
    ...['хромосома', 'хроматин', 'ядро', 'ядрышко', 'кариоплазма'].map((t, i) => item('right', t, i + 1)),
  ],
});

async function xmlOf(q: any): Promise<string> {
  const table = await createQuestionTable(q, 24, true, { matchingGrid: PNG, matchingGridLabel: 'Ҷавоб:', compact: true });
  const buf = await Packer.toBuffer(new Document({ sections: [{ children: [table] }] }));
  return (await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string'));
}

describe('таблица ответа соответствия', () => {
  it('короткие пункты — таблица справа (объединённая ячейка по вертикали)', async () => {
    const xml = await xmlOf(make(['цитоплазма', 'ядро', 'мембрана', 'рибосома']));
    expect(xml).toContain('w:vMerge');
    expect((xml.match(/<w:tr[ >]/g) || []).length).toBe(1 + 5);
  });
  it('длинные пункты — таблица ответа отдельной строкой внизу, колонки не сужаются', async () => {
    const long = 'Мухити ниммоеъе, ки фазои байни сохторҳои ядроро пурмекунад, чӣ ном дорад ва кадом вазифаҳоро иҷро менамояд, ки дар китоб навишта шудааст?';
    const xml = await xmlOf(make([long, long, long, long]));
    expect(xml).not.toContain('w:vMerge');
    expect((xml.match(/<w:tr[ >]/g) || []).length).toBe(1 + 5 + 1);
    expect(xml.indexOf('Ҷавоб:')).toBeGreaterThan(xml.lastIndexOf('кариоплазма'));
  });
});
