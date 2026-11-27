import { describe, expect, it, vi } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { omrRead, omrReadAny } from '../src/lib/omr/recognize';
import type { GrayImage } from '../src/lib/omr/types';

import { render } from './omrRender';

const ids = Object.keys(OMR_LAYOUTS);

// Сервер сборки Vercel заметно медленнее рабочей машины: с лимитом vitest по умолчанию (5 с) деплой иногда падал
vi.setConfig({ testTimeout: 60000 });

describe('распознавание бланка по снимку', () => {
  it('в раскладках шесть бланков с ожидаемым числом заданий', () => {
    const size = (id: string) => [OMR_LAYOUTS[id].tests.length, OMR_LAYOUTS[id].matching.length, OMR_LAYOUTS[id].open.length].join('/');
    expect(ids.map((id) => `${id}:${size(id)}`).sort()).toEqual(['bio:20/4/2', 'bioday:20/4/2', 'chem:18/2/7', 'chemphys:8/2/2', 'phys:18/2/7', 'taj:20/4/2']);
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

  // Реальные снимки таджикского (№29, 32, 36, 38 пачки batch-5): правый столбец тестов уехал на 1,2–2,1 мм, подстройка
  // ряда до него не дотягивалась, кольцо попадало в кружок — и чистый бланк получал «много неясных отметок».
  for (const id of ['taj', 'chem']) {
    it(`${id}: приподнятый край листа (сдвиг столбца 2 мм) — ответы без ложных сомнений`, () => {
      const layout = OMR_LAYOUTS[id];
      const { img, truth } = render(layout, 41, 180 - 4, { curl: 2 });
      const res = omrRead(img, layout);
      expect(res.ok && res.codeOk).toBe(true);
      if (!res.ok) return;
      expect(res.variant.answer).toBe(truth.variant);
      expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
      expect(res.matching.map((m) => m.rows.map((r) => r.answer))).toEqual(truth.matching);
      expect(res.tests.filter((t) => t.unsure).map((t) => t.q)).toEqual([]);
      expect(res.matching.flatMap((m) => m.rows.filter((r) => r.unsure).map((r) => `${m.q}${r.row}`))).toEqual([]);
      expect(qualityWarnings(res)).toEqual([]);
    });
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

  // Реальные снимки: метки отпечатаны серым, полоска лежит на тёмном столе, край листа в 1–2 мм от метки. Тёмный стол
  // в окне усреднения опускал среднее, и при пороге 0,8 метки не находились — бланк отклонялся, хотя виден целиком.
  for (const deg of [0, 3, 180 - 4]) {
    it(`серые метки, лист на тёмном столе вплотную к краю — бланк находится (снимок под ${deg}°)`, () => {
      const layout = OMR_LAYOUTS.chemphys;
      const { img, truth } = render(layout, 77, deg);
      const pad = 10, W = img.w + 2 * pad, H = img.h + 2 * pad;
      const data = new Uint8Array(W * H).fill(30);
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        const v = img.data[y * img.w + x];
        data[(y + pad) * W + x + pad] = v < 60 ? Math.round(140 + v * 0.3) : v;
      }
      const res = omrRead({ w: W, h: H, data }, layout);
      expect(res.ok && res.codeOk).toBe(true);
      if (!res.ok) return;
      expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
    });
  }

  // Реальный бланк: ответы отмечены бледной редкой штриховкой карандашом — кружок закрашен на 0,2–0,4, остальные пусты.
  // Порог 0,4 не проходил ни один, и весь бланк читался пустым. Одна бледная отметка в пустом ряду — ответ с сомнением.
  for (const deg of [0, 3, 180 - 4]) {
    it(`бледная штриховка карандашом читается как ответ с сомнением (снимок под ${deg}°)`, () => {
      const layout = OMR_LAYOUTS.chemphys;
      const { img, truth } = render(layout, 81, deg, { hatch: 130 });
      const res = omrRead(img, layout);
      expect(res.ok && res.codeOk).toBe(true);
      if (!res.ok) return;
      expect(res.variant.answer).toBe(truth.variant);
      expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
      expect(res.matching.map((m) => m.rows.map((r) => (r.answer === null ? null : Number(r.answer))))).toEqual(truth.matching);
      // Пустые ряды остаются пустыми, а бледные ответы помечены сомнением — проверяющий их видит
      for (const t of res.tests) if (t.answer !== null && Math.max(...t.fills) < 0.4) expect(t.unsure).toBe(true);
    });
  }

  // Реальный бланк таджикского: «1» написана тонко и вплотную к левой линии клетки. Очистка рамки принимала такой
  // штрих за остаток линии (высокий, в краевой полосе окна) и стирала — клетка выглядела пустой.
  for (const deg of [0, 3, 180 - 4]) {
    it(`тонкая единица у левого края клетки — цифра, а не остаток рамки (снимок под ${deg}°)`, () => {
      const layout = OMR_LAYOUTS.taj;
      const empty = render(layout, 5, deg).truth.open[0]; // первая пустая клетка первого открытого вопроса
      const b = layout.open[0].boxes[empty];
      const { img, truth } = render(layout, 5, deg, { draw: (stroke) => stroke(b.x + 1.7, b.y + 1.5, b.x + 1.05, b.y + 5.7, 0.45) });
      const res = omrRead(img, layout);
      expect(res.ok && res.codeOk).toBe(true);
      if (!res.ok) return;
      expect(res.open[0].boxes.map((x) => x.hasDigit)).toEqual(layout.open[0].boxes.map((_, i) => i <= empty));
      expect(res.open[1].boxes.filter((x) => x.hasDigit).length).toBe(truth.open[1]);
    });
  }

  // Реальный бланк: цифра написана бледным карандашом (темнее бумаги всего на четверть). Строгая бинаризация её не видела,
  // и клетка считалась пустой. Пустая клетка перечитывается с мягким порогом.
  for (const deg of [0, 3, 180 - 4]) {
    it(`цифра бледным карандашом в клетке находится (снимок под ${deg}°)`, () => {
      const layout = OMR_LAYOUTS.taj;
      const empty = render(layout, 5, deg).truth.open[0];
      const b = layout.open[0].boxes[empty];
      const four = [[0.7, 1], [0.7, 0], [0, 0.7], [1, 0.7]].map(([x, y]) => [b.x + 1.3 + x * 2.9, b.y + 1.4 + y * 4.2]);
      const { img, truth } = render(layout, 5, deg, { draw: (stroke) => { for (let k = 0; k + 1 < four.length; k++) stroke(four[k][0], four[k][1], four[k + 1][0], four[k + 1][1], 0.45, 175); } });
      const res = omrRead(img, layout);
      expect(res.ok && res.codeOk).toBe(true);
      if (!res.ok) return;
      expect(res.open[0].boxes.map((x) => x.hasDigit)).toEqual(layout.open[0].boxes.map((_, i) => i <= empty));
      expect(res.open[1].boxes.filter((x) => x.hasDigit).length).toBe(truth.open[1]);
    });
  }

  // Реальные снимки: бланк лежит на стопке, в кадр попали соседние бланки. Их метки и квадратики кода ближе к углу
  // кадра, чем метка своего бланка, и вытесняли её из кандидатов — бланк отклонялся, хотя все четыре метки видны.
  it('соседние бланки в углу кадра: чужие метки дальше к углу, свой бланк всё равно читается', () => {
    const layout = OMR_LAYOUTS.taj;
    const { img, truth } = render(layout, 5, 2);
    const d = img.data as Float32Array;
    const paint = (x0: number, y0: number, x1: number, y1: number, v: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d[y * img.w + x] = v; };
    // лист соседнего бланка в правом верхнем углу кадра и восемь чёрных квадратов на нём
    paint(img.w - 290, 10, img.w, 165, 235);
    for (const [cx, cy] of [[250, 45], [200, 45], [150, 45], [100, 45], [50, 45], [150, 115], [100, 115], [50, 115]]) paint(img.w - cx - 12, cy - 12, img.w - cx + 12, cy + 12, 15);
    const res = omrRead(img, layout);
    expect(res.ok && res.codeOk).toBe(true);
    if (!res.ok) return;
    expect(res.variant.answer).toBe(truth.variant);
    expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
    expect(res.matching.map((m) => m.rows.map((r) => r.answer))).toEqual(truth.matching);
  });

  // Бланк лежит на стопке таких же: из-под него выглядывают метки нижних листов, рядом с каждой своей. Четвёрок с
  // подходящей формой получается много, своя — самая маленькая из них и раньше не попадала в число проверяемых.
  it('метки нижних листов стопки рядом со своими: читается верхний бланк', () => {
    const layout = OMR_LAYOUTS.taj;
    const { img, truth } = render(layout, 5, 0);
    const d = img.data as Float32Array;
    const paint = (x0: number, y0: number, x1: number, y1: number, v: number) => { for (let y = Math.round(y0); y < y1; y++) for (let x = Math.round(x0); x < x1; x++) d[y * img.w + x] = v; };
    // снимок без поворота: мм бланка → пиксели кадра (6 пикс/мм, поля 80 и 180); метка нижнего листа — на 12 мм наружу
    const m = layout.markers;
    const k = (m[1].x - m[0].x) / (m[2].y - m[0].y);
    m.forEach((c, i) => {
      const px = 80 + 6 * (c.x + (i % 2 ? 12 : -12)), py = 180 + 6 * (c.y + (i < 2 ? -12 : 12) / k);
      paint(px - 22, py - 22, px + 22, py + 22, 235);
      paint(px - 12, py - 12, px + 12, py + 12, 15);
    });
    const res = omrRead(img, layout);
    expect(res.ok && res.codeOk).toBe(true);
    if (!res.ok) return;
    expect(res.variant.answer).toBe(truth.variant);
    expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
    expect(res.matching.map((m2) => m2.rows.map((r) => r.answer))).toEqual(truth.matching);
  });

  // Метка нижнего листа совсем рядом со своей (5 мм): четвёрка с ней тоже проходит проверку кода и кружков (кружки идут
  // с постоянным шагом и частично совпадают со сдвигом), а ответы читаются не там. Берётся четвёрка, где совпали все кружки.
  it('метка нижнего листа в 5 мм от своей: ответы читаются по своим меткам', () => {
    const layout = OMR_LAYOUTS.taj;
    const m = layout.markers;
    const k = (m[1].x - m[0].x) / (m[2].y - m[0].y);
    const decoys = m.map((c, i) => ({ x: c.x + (i % 2 ? 5 : -5), y: c.y + (i < 2 ? -5 : 5) / k }));
    const { img, truth } = render(layout, 5, 2, { draw: (stroke) => { for (const c of decoys) stroke(c.x - 0.01, c.y, c.x + 0.01, c.y, 4.2, 15); } });
    const res = omrRead(img, layout);
    expect(res.ok && res.codeOk).toBe(true);
    if (!res.ok) return;
    expect(res.variant.answer).toBe(truth.variant);
    expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
    expect(res.matching.map((m2) => m2.rows.map((r) => r.answer))).toEqual(truth.matching);
  });

  // Своя метка закрыта, а рядом видна метка нижнего листа стопки: такая четвёрка проходила и код, и медиану кружков,
  // и ответы молча читались со сдвигом (проверено на фото №10 и №12 с закрашенной меткой).
  for (const [corner, dx, dy] of [[0, 12, 0], [0, -9, -7], [0, 10, 8], [1, -10, 0], [1, 8, -5], [1, -8, 6]] as const) {
    it(`своя метка ${corner} закрыта, рядом метка нижнего листа (${dx}; ${dy} мм): отказ или верные ответы`, () => {
      const base = OMR_LAYOUTS.taj;
      const markers = base.markers.map((m, i) => (i === corner ? { ...m, x: m.x + dx, y: m.y + dy } : m));
      const { img, truth } = render({ ...base, markers }, 5, 2);
      const res = omrRead(img, base);
      if (!res.ok || !res.codeOk) return;
      expect(res.tests.map((t) => t.answer)).toEqual(truth.tests);
      expect(res.matching.map((m2) => m2.rows.map((r) => r.answer))).toEqual(truth.matching);
    });
  }

  it('бланк таджикского — пять клеток под открытый ответ, раскладка выбирается по коду бланка', () => {
    expect(OMR_LAYOUTS.taj.open.map((o) => o.boxes.length)).toEqual([5, 5]);
    expect(OMR_LAYOUTS.bio.open.map((o) => o.boxes.length)).toEqual([4, 4]);
    // клетки не доходят до правой угловой метки и не налезают на рамку соответствия
    for (const o of OMR_LAYOUTS.taj.open) {
      expect(o.boxes[0].x).toBeGreaterThan(165);
      expect(o.boxes[4].x + o.boxes[4].w).toBeLessThan(199);
    }
    // «Биология ежедневный» (bioday) — третий вид бланка того же состава, со своими метками и кодом
    const pair = [OMR_LAYOUTS.bio, OMR_LAYOUTS.taj, OMR_LAYOUTS.bioday];
    for (const id of ['taj', 'bio', 'bioday'] as const) {
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

  // Реальные отказы (№30: верхний левый угол подогнут; №34: левые метки за кадром): подсказка называла нижний левый и
  // нижний правый угол, потому что бралась первая попавшаяся тройка квадратов, в том числе из закрашенных кружков.
  const names = ['верхний левый', 'верхний правый', 'нижний левый', 'нижний правый'];
  const erased = (idx: number[]) => {
    const layout = OMR_LAYOUTS.taj;
    const { img } = render(layout, 41, 0);
    const data = Float32Array.from(img.data as ArrayLike<number>);
    for (const n of idx) {
      const m = layout.markers[n];
      const cx = img.w / 2 + (m.x - layout.strip.w / 2) * 6, cy = img.h / 2 + (m.y - layout.strip.h / 2) * 6;
      for (let y = Math.round(cy - 16); y < cy + 16; y++) for (let x = Math.round(cx - 16); x < cx + 16; x++) data[y * img.w + x] = 230;
    }
    return omrRead({ w: img.w, h: img.h, data }, layout);
  };
  for (let n = 0; n < 4; n++) {
    it(`taj: закрыт ${names[n]} угол — назван именно он`, () => {
      const res = erased([n]);
      expect(res.ok && res.codeOk).toBe(false);
      expect(res.missingHint).toContain(`Не виден ${names[n]} угол`);
    });
  }
  it('taj: нет обеих левых меток — угол не называется наугад', () => {
    const res = erased([0, 2]);
    expect(res.ok && res.codeOk).toBe(false);
    expect(res.missingHint ?? '').not.toMatch(/прав/);
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
  it('на прочитанном снимке кружки бланка совпадают с раскладкой', () => {
    for (const id of ids) {
      const { img } = render(OMR_LAYOUTS[id], 91, 3);
      const res = omrRead(img, OMR_LAYOUTS[id]);
      if (!res.ok) throw new Error('не прочитано');
      expect(res.quality.ring).toBeGreaterThan(0.8);
    }
  });
});
