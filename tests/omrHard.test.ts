import { describe, expect, it } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { omrRead } from '../src/lib/omr/recognize';
import type { GrayImage, OmrLayout } from '../src/lib/omr/types';

import { render, type Truth } from './omrRender';

// Реальные снимки пачек batch-9 и batch-10, которые бот отклонял или читал с ложными цифрами
/** Яркость бледных просветов в метке: темнее бумаги, но светлее строгого порога меток */
const PALE = 138;
const taj = OMR_LAYOUTS.taj;
const clone = (l: OmrLayout): OmrLayout => JSON.parse(JSON.stringify(l));
const expectRead = (img: GrayImage, truth: Truth) => {
  const res = omrRead(img, taj);
  expect(res.ok && res.codeOk).toBe(true);
  if (!res.ok) return;
  expect(res.variant.answer).toBe(truth.variant);
  expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
  expect(res.matching.map((m) => m.rows.map((r) => r.answer))).toEqual(truth.matching);
};
describe('трудные снимки', () => {
  it('метки напечатаны бледно, с просветами: бланк принимается', () => {
    for (const seed of [1, 2, 3]) {
      const { img, truth } = render(taj, seed, 3);
      const data = img.data as Float32Array, a = (3 * Math.PI) / 180;
      for (const m of taj.markers) {
        const dx = (m.x - taj.strip.w / 2) * 6, dy = (m.y - taj.strip.h / 2) * 6;
        const cx = img.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), cy = img.h / 2 + dx * Math.sin(a) + dy * Math.cos(a);
        for (let y = Math.round(cy - 25); y < cy + 25; y++) for (let x = Math.round(cx - 25); x < cx + 25; x++) {
          if (data[y * img.w + x] < 60) data[y * img.w + x] = (x >> 2) % 3 === 0 ? PALE : 60;
        }
      }
      expectRead(img, truth);
    }
  }, 60000);

  it('у загнутого края квадратики кода уехали на 1,2 мм: бланк принимается', () => {
    for (const [dx, dy] of [[-1.2, 0.6], [1.2, -1.2]]) {
      const bent = clone(taj);
      bent.codeCells.forEach((c) => { c.x += dx; c.y += dy; });
      const { img, truth } = render(bent, 4, 2);
      expectRead(img, truth);
    }
  }, 60000);

  it('последняя клетка открытого ответа уехала у загнутого края: пустые клетки не становятся цифрами', () => {
    for (const dy of [1, -1]) {
      const bent = clone(taj);
      bent.open.forEach((o) => { o.boxes[o.boxes.length - 1].y += dy; o.boxes[o.boxes.length - 1].x += 0.9; });
      const { img, truth } = render(bent, 6, 2);
      const res = omrRead(img, taj);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.open.map((o) => o.boxes.filter((b) => b.hasDigit).length)).toEqual(truth.open);
    }
  });
});
