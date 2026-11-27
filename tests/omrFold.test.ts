import { describe, expect, it, vi } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { omrRead } from '../src/lib/omr/recognize';

import { render } from './omrRender';

const ids = Object.keys(OMR_LAYOUTS);

// Отдельный файл: vitest выполняет файлы параллельно, а эти тесты — самые долгие из распознавания
vi.setConfig({ testTimeout: 60000 });

describe('распознавание бланка по снимку: лист сложен пополам', () => {
  // Реальные снимки химии/физики (№1, 6, 8, 9 пачки batch-7): лист сложен пополам, соответствие 10 за сгибом уехало на
  // 2,4 мм, а столбцы задания 9 — по разные стороны сгиба. Бланк отбраковывался («не удалось определить вид бланка»).
  for (const id of ids) {
    for (const deg of [0, 180 - 4]) {
      it(`${id}: лист сложен пополам (снимок под ${deg}°) — бланк принимается, отметки читаются без ложных сомнений`, () => {
        const layout = OMR_LAYOUTS[id];
        const { img, truth } = render(layout, id.length * 13 + 5, deg, { fold: id === 'chemphys' ? 2.4 : 1.8 });
        const res = omrRead(img, layout);
        expect(res.ok && res.codeOk).toBe(true);
        if (!res.ok) return;
        expect(res.variant.answer).toBe(truth.variant);
        expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
        expect(res.matching.map((m) => m.rows.map((r) => r.answer))).toEqual(truth.matching);
        expect(res.tests.filter((t) => t.unsure).map((t) => t.q)).toEqual([]);
        expect(res.matching.flatMap((m) => m.rows.filter((r) => r.unsure).map((r) => `${m.q}${r.row}`))).toEqual([]);
        // чужая раскладка от этого не становится «своей»
        for (const other of ids.filter((x) => x !== id)) {
          const no = omrRead(img, OMR_LAYOUTS[other]);
          expect(no.ok && no.codeOk, other).toBe(false);
        }
      });
    }
  }

  // Реальный снимок химии/физики (пачка batch-13, №9): полоска лежит на стопке и прогнулась, соответствие 10 уехало влево
  // на ~4 мм — больше половины шага кружков. Столбцы садились на соседние, бланк принимался с ответами со сдвигом на столбец
  for (const seed of [8, 22, 29]) {
    for (const deg of [3, 176]) {
      it(`chemphys: полоска прогнулась на 4 мм (снимок ${seed}, под ${deg}°) — соответствия не сдвигаются на столбец`, () => {
        const layout = OMR_LAYOUTS.chemphys;
        const { img, truth } = render(layout, seed, deg, { sag: 4 });
        const res = omrRead(img, layout);
        expect(res.ok && res.codeOk).toBe(true);
        if (!res.ok) return;
        expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
        expect(res.matching.map((m) => m.rows.map((r) => r.answer))).toEqual(truth.matching);
      });
    }
  }

  // Реальные снимки химии/физики (пачка batch-17, №10 и №13): полоска согнута «домиком», сгиб проходит через соответствие 9.
  // Рамка 9 сжата по ширине на ~2 мм и не находилась, столбцы искались от места по раскладке: бланк отбраковывался,
  // а при сдвиге дальше запаса поиска — принимался с ответами соответствий со сдвигом на столбец
  for (const seed of [10, 17, 31]) {
    for (const deg of [2, 177]) {
      it(`chemphys: сгиб «домиком» через соответствие 9 (снимок ${seed}, под ${deg}°) — бланк принимается, ответы на месте`, () => {
        const layout = OMR_LAYOUTS.chemphys;
        const { img, truth } = render(layout, seed, deg, { ridge: 5 });
        const res = omrRead(img, layout);
        expect(res.ok && res.codeOk).toBe(true);
        if (!res.ok) return;
        expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
        expect(res.matching.map((m) => m.rows.map((r) => r.answer))).toEqual(truth.matching);
      });
    }
  }
});
