import { describe, expect, it } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { cropSheet, matchRect, openRect, rectifyStrip, sheetCorners, testRect, variantRect } from '../src/lib/omr/rectify';
import { processGray, probeGray } from '../src/lib/omr/process';
import { omrRead } from '../src/lib/omr/recognize';
import type { GrayImage } from '../src/lib/omr/types';
import { render } from './omrRender';

const mean = (g: GrayImage, x0: number, y0: number, x1: number, y1: number) => {
  let s = 0, n = 0;
  for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) { s += g.data[y * g.w + x]; n++; }
  return s / n;
};

/** Снимок, повёрнутый на четверть оборота по часовой (телефон держали иначе) */
const turn = (g: GrayImage): GrayImage => {
  const data = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) data[x * g.h + (g.h - 1 - y)] = g.data[y * g.w + x];
  return { w: g.h, h: g.w, data };
};

describe('выпрямленный снимок полоски', () => {
  it.each([['chem', 4, 0], ['chem', 4, 1], ['chem', 183, 0], ['bio', -3, 3], ['chemphys', 5, 1], ['taj', 356, 0]] as const)('%s, наклон %i°, четвертей оборота %i: метки и отметки лежат на своих местах', (id, deg, turns) => {
    const layout = OMR_LAYOUTS[id];
    const shot = render(layout, 23, deg), truth = shot.truth;
    let img = shot.img;
    for (let i = 0; i < turns; i++) img = turn(img);
    const r = omrRead(img, layout);
    expect(r.ok && r.codeOk).toBe(true);
    if (!r.ok) return;
    const sheet = rectifyStrip(img, r.toPhoto, layout.strip, 6);
    expect([sheet.w, sheet.h]).toEqual([Math.round(layout.strip.w * 6), Math.round(layout.strip.h * 6)]);
    for (const m of layout.markers) expect(mean(sheet, (m.x - 1) * 6, (m.y - 1) * 6, (m.x + 1) * 6, (m.y + 1) * 6), `метка ${m.x},${m.y}`).toBeLessThan(90);
    layout.tests.forEach((t, i) => t.options.forEach((o) => {
      const v = mean(sheet, (o.x - 0.9) * 6, (o.y - 0.9) * 6, (o.x + 0.9) * 6, (o.y + 0.9) * 6);
      if (String(o.value) === truth.tests[i]) expect(v, `тест ${t.q}${o.value}`).toBeLessThan(110);
      else expect(v, `тест ${t.q}${o.value}`).toBeGreaterThan(130);
    }));
  });

  it('за краем снимка — серый фон, а не падение', () => {
    const img: GrayImage = { w: 10, h: 10, data: new Uint8Array(100).fill(50) };
    const s = rectifyStrip(img, [1, 0, -100, 0, 1, -100, 0, 0, 1], { w: 5, h: 5 }, 2);
    expect(Array.from(s.data).every((v) => v === 200)).toBe(true);
  });
});

describe('фрагменты снимка', () => {
  const layout = OMR_LAYOUTS.chem;
  it('у каждого задания свой кусок внутри полоски, кружки целиком внутри', () => {
    for (const l of Object.values(OMR_LAYOUTS)) {
      const inside = (r: { x: number; y: number; w: number; h: number }) => r.x >= 0 && r.y >= 0 && r.x + r.w <= l.strip.w && r.y + r.h <= l.strip.h;
      l.tests.forEach((t, i) => {
        const r = testRect(l, i);
        expect(inside(r)).toBe(true);
        for (const o of t.options) expect(o.x - o.d / 2 >= r.x && o.x + o.d / 2 <= r.x + r.w && o.y - o.d / 2 >= r.y && o.y + o.d / 2 <= r.y + r.h).toBe(true);
        // соседние строки в кусок не попадают целиком
        expect(r.h).toBeLessThan(9);
      });
      l.matching.forEach((m, i) => m.rows.forEach((_, k) => expect(inside(matchRect(l, i, k))).toBe(true)));
      l.open.forEach((_, i) => expect(inside(openRect(l, i))).toBe(true));
      expect(inside(variantRect(l))).toBe(true);
    }
  });

  it('cropSheet вырезает ровно нужный прямоугольник', () => {
    const sheet: GrayImage = { w: 20, h: 10, data: Uint8Array.from({ length: 200 }, (_, i) => i) };
    const c = cropSheet(sheet, { x: 1, y: 1, w: 2, h: 1 }, 2);
    expect([c.w, c.h]).toEqual([4, 2]);
    expect(Array.from(c.data)).toEqual([42, 43, 44, 45, 62, 63, 64, 65]);
  });

  it('cropSheet не выходит за край', () => {
    const sheet: GrayImage = { w: 20, h: 10, data: new Uint8Array(200) };
    const c = cropSheet(sheet, { x: 8, y: 3, w: 10, h: 10 }, 2);
    expect([c.w, c.h]).toEqual([4, 4]);
  });

  it('обработка снимка отдаёт выпрямленную полоску и раскладку, отказ — картинку для подсказки', () => {
    const ok = processGray(render(layout, 8, 3).img, ['chem', 'phys']);
    expect(ok.res?.codeOk).toBe(true);
    expect(ok.sheet?.img.w).toBe(Math.round(layout.strip.w * 6));
    expect(OMR_LAYOUTS[ok.sheet!.layout].kind).toBe('k18');
    const bad = processGray({ w: 400, h: 300, data: new Uint8Array(120000).fill(180) }, ['chem']);
    expect(bad.res).toBeUndefined();
    expect(bad.error).toBeTruthy();
    expect(bad.debug?.bin.length).toBe(120000);
  });
});

describe('проба кадра для автоснимка', () => {
  it('видит бланк и его углы', () => {
    const { img } = render(OMR_LAYOUTS.chem, 8, 3);
    const c = probeGray(img, ['chem', 'phys']);
    expect(c).toHaveLength(4);
    const r = omrRead(img, OMR_LAYOUTS.chem);
    if (r.ok) expect(c).toEqual(sheetCorners(r.toPhoto, OMR_LAYOUTS.chem));
  });
  it('чужой бланк и пустой стол — null', () => {
    expect(probeGray(render(OMR_LAYOUTS.bio, 8, 3).img, ['chem', 'phys'])).toBeNull();
    expect(probeGray({ w: 400, h: 300, data: new Uint8Array(120000).fill(180) }, ['chem'])).toBeNull();
  });
});
