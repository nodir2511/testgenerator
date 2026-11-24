import { describe, expect, it } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { omrRead, omrReadAny } from '../src/lib/omr/recognize';
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

  // Реальные снимки (бланк химии/физики, рука держит полоску): бумага изогнута, печатные кружки и рамки клеток
  // лежат не там, где в раскладке, на 0,5–1 мм. Раньше такие бланки отбраковывались как «не тот бланк».
  for (const id of ids) {
    for (const bend of [0.6, 1.0]) {
      it(`${id}: изгиб листа до ${bend} мм — бланк принимается, отметки и клетки открытых читаются`, () => {
        const layout = OMR_LAYOUTS[id];
        const { img, truth } = render(layout, id.length * 17 + 3, 180 - 4, { bend });
        const res = omrRead(img, layout);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.codeOk).toBe(true);
        expect(res.variant.answer).toBe(truth.variant);
        expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
        expect(res.matching.map((m) => m.rows.map((r) => r.answer))).toEqual(truth.matching);
        // пустая клетка с изогнутой рамкой не считается цифрой
        expect(res.open.map((o) => o.boxes.filter((b) => b.hasDigit).length)).toEqual(truth.open);
      });
    }
  }

  it('изгиб листа не делает чужую раскладку «своей»: код и кружки другого бланка не сходятся', () => {
    const { img } = render(OMR_LAYOUTS.chemphys, 9, 180 - 4, { bend: 1.0 });
    for (const id of ids.filter((x) => x !== 'chemphys')) {
      const res = omrRead(img, OMR_LAYOUTS[id]);
      expect(res.ok && res.codeOk).toBe(false);
    }
  });

  it('химия и физика отличаются кодом бланка: свой код проходит, чужой — нет', () => {
    const { img } = render(OMR_LAYOUTS.chem, 5, 4);
    const own = omrRead(img, OMR_LAYOUTS.chem);
    const other = omrRead(img, OMR_LAYOUTS.phys);
    const both = omrRead(img, OMR_LAYOUTS.phys, { codes: [OMR_LAYOUTS.chem.code, OMR_LAYOUTS.phys.code] });
    expect(own.ok && own.codeOk).toBe(true);
    expect(other.ok && other.codeOk).toBe(false);
    expect(both.ok && both.codeOk).toBe(true);
  });

  it('бланк на тёмном столе вплотную к краю: метки светлее обычного, но находятся', () => {
    const layout = OMR_LAYOUTS.bio;
    const { img, truth } = render(layout, 77, 3);
    // Лист лежит на тёмной клавиатуре, а чёрные метки на снимке выходят серыми (экспозиция)
    const pad = 40, W = img.w + 2 * pad, H = img.h + 2 * pad;
    const data = new Uint8Array(W * H).fill(45);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const v = img.data[y * img.w + x];
      data[(y + pad) * W + x + pad] = v < 60 ? Math.round(v * 0.4 + 100) : v;
    }
    const res = omrRead({ w: W, h: H, data }, layout);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.codeOk).toBe(true);
    expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
  });

  it('бланк таджикского — пять клеток под открытый ответ, раскладка выбирается по коду бланка', () => {
    expect(OMR_LAYOUTS.taj.open.map((o) => o.boxes.length)).toEqual([5, 5]);
    expect(OMR_LAYOUTS.bio.open.map((o) => o.boxes.length)).toEqual([4, 4]);
    // клетки не доходят до правой угловой метки и не налезают на рамку соответствия
    for (const o of OMR_LAYOUTS.taj.open) {
      expect(o.boxes[0].x).toBeGreaterThan(165);
      expect(o.boxes[4].x + o.boxes[4].w).toBeLessThan(199);
    }
    const pair = [OMR_LAYOUTS.bio, OMR_LAYOUTS.taj];
    for (const id of ['taj', 'bio'] as const) {
      const { img, truth } = render(OMR_LAYOUTS[id], 5, 2);
      const { res, layout } = omrReadAny(img, pair);
      expect(layout.id, id).toBe(id);
      expect(res.ok && res.codeOk, id).toBe(true);
      if (!res.ok) continue;
      expect(res.open.map((o) => o.boxes.length)).toEqual(id === 'taj' ? [5, 5] : [4, 4]);
      expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
    }
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

  it('при закрытии одного угла даёт подсказку, какой именно угол не виден', () => {
    const layout = OMR_LAYOUTS.chem;
    const { img } = render(layout, 123, 0);
    const data = Float32Array.from(img.data as ArrayLike<number>);
    // Стираем нижний правый маркер (BR, индекс 3)
    const m = layout.markers[3];
    const dx = (m.x - layout.strip.w / 2) * 6, dy = (m.y - layout.strip.h / 2) * 6;
    const cx = img.w / 2 + dx, cy = img.h / 2 + dy;
    for (let y = Math.round(cy - 25); y < cy + 25; y++) {
      for (let x = Math.round(cx - 25); x < cx + 25; x++) {
        data[y * img.w + x] = 230;
      }
    }
    const res = omrRead({ w: img.w, h: img.h, data }, layout);
    const failed = !res.ok || !res.codeOk;
    expect(failed).toBe(true);
    expect(res.missingHint).toBeDefined();
    expect(res.missingHint).toMatch(/нижний правый|правый нижний/i);
  });
});

import { qualityWarnings, answersFromResult } from '../src/lib/omr/answers';
import { scoreAnswers } from '../supabase/functions/_shared/omrScore';

describe('качество снимка и несколько отметок', () => {
  it('нормальный снимок без предупреждений, качество измеряется', () => {
    const layout = OMR_LAYOUTS.chem;
    const { img } = render(layout, 77, 5);
    const res = omrRead(img, layout);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.quality.pxPerMm).toBeGreaterThan(5);
    expect(res.quality.skew).toBeLessThan(1.1);
    expect(qualityWarnings(res)).toEqual([]);
  });

  it('далёкий снимок и перекос дают предупреждения', () => {
    const layout = OMR_LAYOUTS.chem;
    const { img } = render(layout, 78, 3);
    const res = omrRead(img, layout);
    if (!res.ok) throw new Error('не прочитано');
    expect(qualityWarnings({ ...res, quality: { pxPerMm: 3, skew: 1.4, ring: 1 } }).length).toBe(2);
  });

  it('много неуверенных отметок — предупреждение про блики', () => {
    const layout = OMR_LAYOUTS.chem;
    const { img } = render(layout, 79, 2);
    const res = omrRead(img, layout);
    if (!res.ok) throw new Error('не прочитано');
    const bad = { ...res, tests: res.tests.map((t, i) => (i < 4 ? { ...t, answer: 'multi' as const, unsure: true } : t)) };
    expect(qualityWarnings(bad).some((w) => w.includes('блики'))).toBe(true);
  });

  it('несколько отметок засчитываются как неверный ответ', () => {
    const layout = OMR_LAYOUTS.bio;
    const { img } = render(layout, 80, 2);
    const res = omrRead(img, layout);
    if (!res.ok) throw new Error('не прочитано');
    const key = { tests: res.tests.map(() => 'A'), matching: res.matching.map((m) => m.rows.map(() => '1')), open: res.open.map(() => null) };
    const a = answersFromResult({ ...res, tests: res.tests.map((t) => ({ ...t, answer: 'multi' as const, unsure: true })) });
    expect(a.tests.every((x) => x === null)).toBe(true);
    expect(scoreAnswers(key, a).tests.every((x) => x === false)).toBe(true);
  });
  // Закрытая пальцем или бликом метка: раньше четвёрка из закрашенных кружков иногда «проходила» код бланка,
  // и ответы читались со сдвигом. Теперь такой снимок либо отклоняется, либо читается верно — но не неверно.
  it('метка закрыта: снимок отклоняется или читается верно, белиберды нет', () => {
    let wrong = 0, okCount = 0;
    for (const id of ids) for (let s = 0; s < 12; s++) {
      const layout = OMR_LAYOUTS[id];
      const deg = [0, 4, -5, 180][s % 4];
      const { img, truth } = render(layout, 3000 + s * 13 + id.length, deg);
      const data = Float32Array.from(img.data as ArrayLike<number>);
      const m = layout.markers[s % 4], a = (deg * Math.PI) / 180;
      const dx = (m.x - layout.strip.w / 2) * 6, dy = (m.y - layout.strip.h / 2) * 6;
      const cx = img.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), cy = img.h / 2 + dx * Math.sin(a) + dy * Math.cos(a);
      for (let y = Math.round(cy - 25); y < cy + 25; y++) for (let x = Math.round(cx - 25); x < cx + 25; x++) data[y * img.w + x] = 230;
      const res = omrRead({ w: img.w, h: img.h, data }, layout);
      if (!res.ok || !res.codeOk) continue;
      okCount++;
      if (res.variant.answer !== truth.variant || JSON.stringify(res.tests.map((t) => t.answer)) !== JSON.stringify(truth.tests)) wrong++;
    }
    expect(wrong).toBe(0);
    expect(okCount).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('на прочитанном снимке кружки бланка совпадают с раскладкой', () => {
    for (const id of ids) {
      const { img } = render(OMR_LAYOUTS[id], 91, 3);
      const res = omrRead(img, OMR_LAYOUTS[id]);
      if (!res.ok) throw new Error('не прочитано');
      expect(res.quality.ring).toBeGreaterThan(0.8);
    }
  });
});
