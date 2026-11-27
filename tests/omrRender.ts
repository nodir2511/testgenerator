import type { GrayImage, OmrLayout } from '../src/lib/omr/types';
import { GLYPHS } from '../src/lib/omr/digits';

// Мини-«камера»: рисуем бланк с отметками в растр 8 px/мм, затем поворачиваем и кладём на стол.
const S = 8;
const rng = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

/** Профиль сгиба: [x бланка, мм; сдвиг в долях fold] */
const FOLD_X = [[9, 0], [35, -0.25], [60, 0.25], [90, 0.2], [105, -0.3], [118, -1], [145, -1], [183, -0.35], [201, 0]];
const FOLD_Y = [[9, 0], [60, 0.15], [105, 0.5], [145, 0.3], [201, 0]];
/** Профиль прогиба полоски, лежащей на стопке листов: [x бланка, мм; сдвиг в долях sag]. Снят с реального фото
 * (пачка batch-13, №9): тесты почти на месте, соответствие 9 уехало влево на ~2,5 мм, соответствие 10 — на ~4 мм */
const SAG_X = [[9, 0], [40, -0.05], [55, -0.2], [85, -0.65], [105, -0.85], [126, -1], [150, -0.9], [170, -0.5], [201, 0]];
/** Профиль «домика»: полоска согнута поперёк, сгиб проходит через соответствие 9 и приподнят к камере (пачка batch-17,
 * №10 и №13): рамка 9 сжата по ширине на ~2 мм и уехала влево дальше запаса поиска столбцов, квадратики кода сдвинуты.
 * [x бланка, мм; сдвиг в долях ridge] */
const RIDGE_X = [[9, 0], [50, -0.2], [80, -0.7], [110, -1.1], [150, -1], [175, -0.35], [195, -0.25], [201, 0]];
const along = (p: number[][], x: number) => {
  if (x <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) if (x <= p[i][0]) return p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * (x - p[i - 1][0])) / (p[i][0] - p[i - 1][0]);
  return p[p.length - 1][1];
};

export interface Truth { variant: number | null; tests: Array<string | null>; matching: Array<Array<number | null>>; open: number[]; openText: string[] }

/** draw — дорисовать на бланке свои штрихи (координаты в мм бланка; v — яркость штриха, бумага 235), например цифру у самого края клетки или бледным карандашом */
export function render(layout: OmrLayout, seed: number, deg: number, opts: { glyphs?: boolean; bend?: number; curl?: number; fold?: number; sag?: number; ridge?: number; hatch?: number; draw?: (stroke: (ax: number, ay: number, bx: number, by: number, wmm: number, v?: number) => void) => void } = {}): { img: GrayImage; truth: Truth } {
  const r = rng(seed);
  const W = Math.round(layout.strip.w * S), H = Math.round(layout.strip.h * S);
  const d = new Float32Array(W * H).fill(235);
  const dot = (x: number, y: number, v: number) => { if (x >= 0 && y >= 0 && x < W && y < H) d[y * W + x] = Math.min(d[y * W + x], v); };
  const rect = (x: number, y: number, w: number, h: number, v = 15) => {
    for (let py = Math.floor(y * S); py < Math.ceil((y + h) * S); py++) for (let px = Math.floor(x * S); px < Math.ceil((x + w) * S); px++) dot(px, py, v);
  };
  const outline = (x: number, y: number, w: number, h: number) => { rect(x, y, w, 0.4); rect(x, y + h - 0.4, w, 0.4); rect(x, y, 0.4, h); rect(x + w - 0.4, y, 0.4, h); };
  const circle = (c: { x: number; y: number; d: number }, fill: boolean) => {
    const R = c.d / 2;
    for (let py = Math.floor((c.y - R) * S); py <= Math.ceil((c.y + R) * S); py++) for (let px = Math.floor((c.x - R) * S); px <= Math.ceil((c.x + R) * S); px++) {
      const dist = Math.hypot((px + 0.5) / S - c.x, (py + 0.5) / S - c.y);
      // hatch: отметка — редкая бледная штриховка карандашом (полосы 0,3 мм с шагом 0,8 мм, яркость opts.hatch)
      const hatched = !opts.hatch || ((px + py) / S) % 0.8 < 0.3;
      if (fill ? dist <= R * 0.85 && hatched : dist <= R && dist >= R - 0.3) dot(px, py, fill ? opts.hatch ?? 40 : 20);
    }
  };
  for (const m of layout.markers) rect(m.x - m.size / 2, m.y - m.size / 2, m.size, m.size);
  for (const c of layout.codeCells) if (c.bit) rect(c.x - c.size / 2, c.y - c.size / 2, c.size, c.size);
  const stroke = (ax: number, ay: number, bx: number, by: number, wmm: number, v = 35) => {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
    for (let py = Math.floor((Math.min(ay, by) - wmm) * S); py < Math.ceil((Math.max(ay, by) + wmm) * S); py++) {
      for (let px = Math.floor((Math.min(ax, bx) - wmm) * S); px < Math.ceil((Math.max(ax, bx) + wmm) * S); px++) {
        const x = (px + 0.5) / S, y = (py + 0.5) / S;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
        if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= wmm / 2) dot(px, py, v);
      }
    }
  };
  const pick = (n: number) => (r() < 0.12 ? -1 : Math.floor(r() * n));
  const truth: Truth = { variant: null, tests: [], matching: [], open: [], openText: [] };
  const v = Math.floor(r() * layout.variant.length);
  layout.variant.forEach((c, i) => circle(c, i === v));
  truth.variant = Number(layout.variant[v].value);
  for (const t of layout.tests) {
    const a = pick(4);
    t.options.forEach((c, i) => circle(c, i === a));
    truth.tests.push(a < 0 ? null : String(t.options[a].value));
  }
  for (const m of layout.matching) {
    outline(m.frame.x, m.frame.y, m.frame.w, m.frame.h);
    truth.matching.push(m.rows.map((row) => {
      const a = pick(5);
      row.options.forEach((c, i) => circle(c, i === a));
      return a < 0 ? null : Number(row.options[a].value);
    }));
  }
  for (const o of layout.open) {
    o.boxes.forEach((b) => outline(b.x, b.y, b.w, b.h));
    const digits = r() < 0.5 ? 0 : 1 + Math.floor(r() * 3);
    truth.open.push(digits);
    let text = '';
    for (let i = 0; i < digits; i++) {
      const bx = o.boxes[i];
      if (!opts.glyphs) {
        // «Цифра» — вертикальный штрих на всю высоту клетки
        rect(bx.x + 2.6, bx.y + 1.2, 0.7, bx.h - 2.4, 30);
        continue;
      }
      const ch = String(Math.floor(r() * 10));
      text += ch;
      const gw = 3 + r() * 0.9, gh = 4 + r() * 0.7, slant = (r() - 0.5) * 0.3;
      const gx = bx.x + (bx.w - gw) / 2 + (r() - 0.5) * 0.5, gy = bx.y + (bx.h - gh) / 2 + (r() - 0.5) * 0.5;
      const pts = GLYPHS[ch].map(([x, y]) => [gx + (x + slant * (0.5 - y)) * gw + (r() - 0.5) * 0.18, gy + y * gh + (r() - 0.5) * 0.18]);
      const wmm = 0.4 + r() * 0.2;
      for (let k = 0; k + 1 < pts.length; k++) stroke(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], wmm);
    }
    truth.openText.push(text);
  }
  opts.draw?.(stroke);

  // Фото: поворот на угол deg вокруг центра полоски, масштаб 6 px/мм, поля со столом
  const sc = 6 / S, PW = Math.round(layout.strip.w * 6 + 160), PH = Math.round(layout.strip.h * 6 + 160) + 200;
  const data = new Float32Array(PW * PH).fill(120);
  const bend = opts.bend ?? 0;
  const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const dx = (x - PW / 2) / 6, dy = (y - PH / 2) / 6;
    let mx = (dx * ca + dy * sa) + layout.strip.w / 2, my = (-dx * sa + dy * ca) + layout.strip.h / 2;
    // Изгиб листа: плавное смещение до bend мм в середине, на угловых метках нулевое (метки лежат на месте, кружки и рамки — нет)
    if (bend) {
      const f = bend * Math.sin(Math.PI * mx / layout.strip.w) * Math.sin(Math.PI * my / layout.strip.h);
      mx -= f; my -= 0.7 * f;
    }
    // Правый край листа приподнят в середине: столбец кружков уезжает влево на curl мм, метки и код бланка на месте
    if (opts.curl) {
      const [a0, b0, c0] = layout.markers, unit = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
      mx += opts.curl * Math.sin(Math.PI * unit(mx, a0.x, b0.x) ** 6) * Math.sqrt(Math.sin(Math.PI * unit(my, a0.y, c0.y)));
    }
    // Лист сложен пополам и расправлен: половинки выгнуты, у сгиба (середина полоски) — излом. Профиль снят с реального
    // фото (пачка batch-7, №1): сразу за сгибом кружки уезжают влево на fold мм, у краёв листа и меток сдвига нет
    if (opts.fold) {
      const dx = along(FOLD_X, mx) * opts.fold;
      my -= along(FOLD_Y, mx) * opts.fold;
      mx -= dx;
    }
    // Полоска прогнулась поперёк (лежит на стопке): середина листа уехала влево на sag мм, у меток сдвига нет
    if (opts.sag) mx -= along(SAG_X, mx) * opts.sag;
    // Сгиб «домиком» через соответствие 9: рамка 9 сжата по ширине, правее сгиба всё уехало влево до ridge мм
    if (opts.ridge) mx -= along(RIDGE_X, mx) * opts.ridge;
    if (mx < 0 || my < 0 || mx >= layout.strip.w || my >= layout.strip.h) continue;
    data[y * PW + x] = d[Math.floor(my * S) * W + Math.floor(mx * S)];
  }
  void sc;
  return { img: { w: PW, h: PH, data }, truth };
}

/** Несколько бланков на одном фото: снимки друг под другом, поля сверху и снизу каждого урезаны на cut пикселей */
export function renderPile(layout: OmrLayout, seed: number, degs: number[], cut = 120): { img: GrayImage; truths: Truth[] } {
  const parts = degs.map((deg, i) => render(layout, seed + i, deg));
  const w = parts[0].img.w, h = parts[0].img.h - 2 * cut;
  const data = new Float32Array(w * h * parts.length);
  parts.forEach((p, i) => data.set((p.img.data as Float32Array).subarray(cut * w, (cut + h) * w), i * w * h));
  return { img: { w, h: h * parts.length, data }, truths: parts.map((p) => p.truth) };
}
