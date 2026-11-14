import { describe, expect, it } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { omrRead } from '../src/lib/omr/recognize';
import type { GrayImage } from '../src/lib/omr/types';

import { render } from './omrRender';

const ids = Object.keys(OMR_LAYOUTS);

describe('распознавание бланка по снимку', () => {
  it('в раскладках пять бланков с ожидаемым числом заданий', () => {
    const size = (id: string) => [OMR_LAYOUTS[id].tests.length, OMR_LAYOUTS[id].matching.length, OMR_LAYOUTS[id].open.length].join('/');
    expect(ids.map((id) => `${id}:${size(id)}`).sort()).toEqual(['bio:20/4/2', 'chem:18/2/7', 'chemphys:8/2/2', 'phys:18/2/7', 'taj:20/4/2']);
  });

  for (const id of ids) {
    for (const [name, deg] of [['с наклоном 7°', 7], ['перевёрнутый на 180° и наклонённый', 180 - 6]] as const) {
      it(`${id}: все отметки считываются, снимок ${name}`, () => {
        const layout = OMR_LAYOUTS[id];
        const { img, truth } = render(layout, id.length * 31 + deg, deg);
        const res = omrRead(img, layout);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.codeOk).toBe(true);
        expect(res.variant.answer).toBe(truth.variant);
        expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
        expect(res.matching.map((m) => m.rows.map((r) => r.answer))).toEqual(truth.matching);
        expect(res.open.map((o) => o.boxes.filter((b) => b.hasDigit).length)).toEqual(truth.open);
      });
    }
  }

  it('химия и физика отличаются кодом бланка: свой код проходит, чужой — нет', () => {
    const { img } = render(OMR_LAYOUTS.chem, 5, 4);
    const own = omrRead(img, OMR_LAYOUTS.chem);
    const other = omrRead(img, OMR_LAYOUTS.phys);
    const both = omrRead(img, OMR_LAYOUTS.phys, { codes: [OMR_LAYOUTS.chem.code, OMR_LAYOUTS.phys.code] });
    expect(own.ok && own.codeOk).toBe(true);
    expect(other.ok && other.codeOk).toBe(false);
    expect(both.ok && both.codeOk).toBe(true);
  });

  it('пустой стол без меток — отказ, а не случайные ответы', () => {
    const img: GrayImage = { w: 800, h: 500, data: new Uint8Array(800 * 500).fill(180) };
    expect(omrRead(img, OMR_LAYOUTS.chem)).toEqual({ ok: false, reason: 'markers' });
  });

  it('метки есть, но не от этого бланка: код не сходится', () => {
    const { img } = render(OMR_LAYOUTS.chemphys, 9, 0);
    const res = omrRead(img, OMR_LAYOUTS.chemphys, { codes: [6] });
    expect(res.ok && res.codeOk).toBe(false);
  });
});
