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
    const long = 'Мухити ниммоеъе, ки фазои байни сохторҳои ядроро пурмекунад, чӣ ном дорад ва кадом вазифаҳоро иҷро менамояд, ки дар китоб навишта шудааст ва ба хонандагон маълум аст?';
    const xml = await xmlOf(make([long, long, long, long]));
    expect(xml).not.toContain('w:vMerge');
    expect((xml.match(/<w:tr[ >]/g) || []).length).toBe(1 + 5 + 1);
    expect(xml.indexOf('Ҷавоб:')).toBeGreaterThan(xml.lastIndexOf('кариоплазма'));
  });
  it('ширина колонок гибкая: длинная левая шире короткой правой', async () => {
    const q: any = {
      type: 'matching', content: 'Установите', content_tg: 'Установите',
      matching_items: [
        ...['Mg + O2 → MgO', 'Al + HCl → AlCl3 + H2', 'Li + N2 → Li3N', 'Zn + H2SO4 → ZnSO4 + H2'].map((t, i) => item('left', t, i + 1)),
        ...['9', '7', '4', '5', '13'].map((t, i) => item('right', t, i + 1)),
      ],
    };
    const xml = await xmlOf(q);
    const cols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
    expect(cols.length).toBe(4);
    expect(cols[1]).toBeGreaterThan(cols[2] * 2);
    expect(cols.slice(1, 3).reduce((a, b) => a + b, 0)).toBe(6200);
  });
  it('наоборот: короткая левая уже длинной правой', async () => {
    const q: any = {
      type: 'matching', content: 'x', content_tg: 'x',
      matching_items: [
        ...['A1', 'B2', 'C3', 'D4'].map((t, i) => item('left', t, i + 1)),
        ...['участвует в перемещении органоидов и отдельных соединений', 'регулирует обмен веществ', 'хранение информации', 'синтезирует вещества', 'расщепляет глюкозу'].map((t, i) => item('right', t, i + 1)),
      ],
    };
    const cols = [...(await xmlOf(q)).matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
    expect(cols[2]).toBeGreaterThan(cols[1] * 2);
  });
  it('короткая правая колонка получает ширину, чтобы «биологическая мембрана» не рвалась на много строк', async () => {
    const q: any = {
      type: 'matching', content: 'x', content_tg: 'x',
      matching_items: [
        ...['Укажите опорный элемент цитоплазмы', 'Какая структура клетки объединяет все органоиды?', 'Как называются непостоянные компоненты цитоплазмы, содержание которых меняется в зависимости от функционального состояния клетки?', 'Как называется бимолекулярный слой фосфолипидов?'].map((t, i) => item('left', t, i + 1)),
        ...['цитоплазма', 'цитоскелет', 'включения', 'органоиды', 'биологическая мембрана'].map((t, i) => item('right', t, i + 1)),
      ],
    };
    const cols = [...(await xmlOf(q)).matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
    expect(cols[2]).toBeGreaterThanOrEqual(2500);
  });
});
