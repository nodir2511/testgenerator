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
});
