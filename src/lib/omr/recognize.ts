// Распознавание бланка по снимку одной полоски. Без зависимостей: работает над серым изображением.
// Порядок: строгая бинаризация → четыре угловые метки → выравнивание (гомография) →
// код бланка (он же определяет поворот снимка) → вариант, тесты, соответствия, клетки открытых.
// Распознавание самих цифр здесь нет: для открытых вопросов отдаётся, есть ли в клетке цифра, и её рисунок.
import type { GrayImage, OmrCircle, OmrLayout, OmrResult, OpenBox, Picked } from './types';

type H3 = number[];

// ---------- геометрия ----------
export function solveHomography(src: number[][], dst: number[][]): H3 | null {
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    [B[i], B[p]] = [B[p], B[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      B[r] -= f * B[i];
    }
  }
  const h = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = B[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * h[c];
    h[i] = s / A[i][i];
  }
  return [...h, 1];
}

const applyH = (H: H3, x: number, y: number): [number, number] => {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
};

// ---------- бинаризация и пятна ----------
/** Пиксель «тёмный», если он темнее k · (среднее в окне). k = 0,8 — чернила, 0,4 — почти чёрные метки */
export function adaptiveBinary(img: GrayImage, win: number, k: number): Uint8Array {
  const { w, h, data } = img;
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const half = win >> 1;
  const bin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      bin[y * w + x] = data[y * w + x] < mean * k ? 1 : 0;
    }
  }
  return bin;
}

interface Blob { area: number; cx: number; cy: number; x0: number; y0: number; x1: number; y1: number; iso: number; solid: number }

function components(bin: Uint8Array, w: number, h: number): Blob[] {
  const lab = new Uint8Array(w * h);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!bin[i] || lab[i]) continue;
    let area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack.push(i);
    lab[i] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && bin[p - 1] && !lab[p - 1]) { lab[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && bin[p + 1] && !lab[p + 1]) { lab[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && bin[p - w] && !lab[p - w]) { lab[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && bin[p + w] && !lab[p + w]) { lab[p + w] = 1; stack.push(p + w); }
    }
    const cx = sx / area, cy = sy / area;
    const vxx = sxx / area - cx * cx + 1 / 12, vyy = syy / area - cy * cy + 1 / 12, vxy = sxy / area - cx * cy;
    const tr = vxx + vyy, det = vxx * vyy - vxy * vxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    out.push({ area, cx, cy, x0, y0, x1, y1, iso: l2 / l1, solid: area / (12 * Math.sqrt(l1 * l2)) });
  }
  return out;
}

interface Corners { TL: Blob; TR: Blob; BL: Blob; BR: Blob }

/** Четыре угловые метки: самый большой согласованный четырёхугольник из квадратных пятен */
function findMarkers(bin: Uint8Array, w: number, h: number): Corners | null {
  const minArea = w * h * 0.00007;
  // Квадрат при любом повороте: равные главные оси и площадь ≈ 12·σ² (кольца и линии отсеиваются)
  const sq = components(bin, w, h).filter((c) => {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    return c.area >= minArea && c.iso > 0.45 && c.solid > 0.8 && c.solid < 1.35 && Math.max(bw, bh) < w * 0.12;
  });
  if (sq.length < 4) return null;
  // Закрашенные кружки и квадратики кода по размеру близки к меткам: берём для каждого угла
  // несколько самых крайних кандидатов и ищем четырёхугольник наибольшей площади, остальное лежит внутри него
  const K = 4;
  const best = (f: (c: Blob) => number) => sq.slice().sort((p, q) => f(q) - f(p)).slice(0, K);
  const TLs = best((c) => -(c.cx + c.cy)), BRs = best((c) => c.cx + c.cy);
  const TRs = best((c) => c.cx - c.cy), BLs = best((c) => -(c.cx - c.cy));
  let top: (Corners & { area2: number }) | null = null;
  for (const TL of TLs) for (const TR of TRs) for (const BL of BLs) for (const BR of BRs) {
    if (new Set([TL, TR, BL, BR]).size < 4) continue;
    const areas = [TL.area, TR.area, BL.area, BR.area];
    if (Math.max(...areas) > Math.min(...areas) * 2.6) continue;
    const P = [TL, TR, BR, BL];
    let area2 = 0;
    for (let i = 0; i < 4; i++) { const p = P[i], q = P[(i + 1) % 4]; area2 += p.cx * q.cy - q.cx * p.cy; }
    area2 = Math.abs(area2);
    const d1 = Math.hypot(TL.cx - BR.cx, TL.cy - BR.cy), d2 = Math.hypot(TR.cx - BL.cx, TR.cy - BL.cy);
    const mid = Math.hypot((TL.cx + BR.cx - TR.cx - BL.cx) / 2, (TL.cy + BR.cy - TR.cy - BL.cy) / 2);
    if (mid > 0.15 * Math.min(d1, d2)) continue;
    if (!top || area2 > top.area2) top = { area2, TL, TR, BL, BR };
  }
  return top ? { TL: top.TL, TR: top.TR, BL: top.BL, BR: top.BR } : null;
}

// ---------- чтение отметок ----------
/** Доля закрашенной площади кружка, начиная с которой он считается отмеченным */
export const FILL_ON = 0.38;
const UNSURE_LO = 0.18;

type At = (x: number, y: number) => number;

function sampler(bin: Uint8Array, w: number, h: number, H: H3): At {
  return (x, y) => {
    const [u, v] = applyH(H, x, y);
    const ix = Math.round(u), iy = Math.round(v);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return -1;
    return bin[iy * w + ix];
  };
}

function discFill(at: At, cx: number, cy: number, r: number): number {
  let on = 0, tot = 0;
  const step = 0.3;
  for (let dy = -r; dy <= r; dy += step) for (let dx = -r; dx <= r; dx += step) {
    if (dx * dx + dy * dy > r * r) continue;
    const v = at(cx + dx, cy + dy);
    if (v < 0) continue;
    tot++; on += v;
  }
  return tot ? on / tot : 0;
}

function squareFill(at: At, cx: number, cy: number, size: number): number {
  let on = 0, tot = 0;
  const r = size / 2 * 0.7, step = 0.25;
  for (let dy = -r; dy <= r; dy += step) for (let dx = -r; dx <= r; dx += step) {
    const v = at(cx + dx, cy + dy);
    if (v < 0) continue;
    tot++; on += v;
  }
  return tot ? on / tot : 0;
}

function pickOne(options: OmrCircle[], at: At): Picked {
  const fills = options.map((o) => discFill(at, o.x, o.y, o.d / 2 * 0.62));
  const on: number[] = [];
  fills.forEach((f, i) => { if (f >= FILL_ON) on.push(i); });
  const unsure = fills.some((f) => f >= UNSURE_LO && f < FILL_ON + 0.1);
  if (on.length === 0) return { answer: null, unsure, fills };
  if (on.length > 1) return { answer: 'multi', unsure: true, fills, candidates: on.map((i) => options[i].value) };
  return { answer: options[on[0]].value, unsure, fills };
}

function openBox(at: At, b: { x: number; y: number; w: number; h: number }): OpenBox {
  const inset = 0.9, step = 0.15;
  const x0 = b.x + inset, x1 = b.x + b.w - inset, y0 = b.y + inset, y1 = b.y + b.h - inset;
  const cols = Math.floor((x1 - x0) / step), rows = Math.floor((y1 - y0) / step);
  const bitmap = new Uint8Array(cols * rows);
  let on = 0, top = rows, bottom = -1, left = cols, right = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = at(x0 + c * step, y0 + r * step);
    if (v > 0) {
      bitmap[r * cols + c] = 1;
      on++;
      if (r < top) top = r;
      if (r > bottom) bottom = r;
      if (c < left) left = c;
      if (c > right) right = c;
    }
  }
  // Цифра — рисунок высотой не меньше ~45 % клетки; точки и короткие чёрточки — случайные пятна
  const heightMm = bottom >= 0 ? (bottom - top + 1) * step : 0;
  const widthMm = right >= 0 ? (right - left + 1) * step : 0;
  const ink = cols * rows ? on / (cols * rows) : 0;
  return { ink, hasDigit: ink > 0.02 && heightMm >= 2.4, heightMm, widthMm, cols, rows, bitmap };
}

export interface OmrOptions {
  /** Допустимые коды бланка (у химии и физики одинаковая раскладка, а коды разные). По умолчанию — код раскладки. */
  codes?: number[];
}

/** Считывает одну полоску бланка. Если codeOk = false, снимок лучше не использовать. */
export function omrRead(img: GrayImage, layout: OmrLayout, opts: OmrOptions = {}): OmrResult {
  const { w, h } = img;
  // Метки почти чёрные: ищем их по строгому порогу, тогда стол и тень у края бумаги к ним не прилипают
  const win = Math.max(31, Math.round(w / 8) | 1);
  const mk = findMarkers(adaptiveBinary(img, win, 0.4), w, h);
  if (!mk) return { ok: false, reason: 'markers' };

  const lm = layout.markers; // TL, TR, BL, BR
  {
    const d = (a: Blob, b: Blob) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
    const got = (d(mk.TL, mk.TR) + d(mk.BL, mk.BR)) / (d(mk.TL, mk.BL) + d(mk.TR, mk.BR));
    const want = Math.hypot(lm[1].x - lm[0].x, lm[1].y - lm[0].y) / Math.hypot(lm[2].x - lm[0].x, lm[2].y - lm[0].y);
    // форма должна быть как у бланка, в любом из поворотов на 90°
    if (Math.min(got / want, want / got) < 0.6 && Math.min(got * want, 1 / (got * want)) < 0.6) return { ok: false, reason: 'shape' };
  }

  const bin = adaptiveBinary(img, win, 0.8);
  const dstRing: number[][] = [[lm[0].x, lm[0].y], [lm[1].x, lm[1].y], [lm[3].x, lm[3].y], [lm[2].x, lm[2].y]]; // по часовой
  const ring = [mk.TL, mk.TR, mk.BR, mk.BL];
  const codes = opts.codes ?? [layout.code];
  let best: { score: number; mism: number; rot: number; at: At } | null = null;
  for (let rot = 0; rot < 4; rot++) {
    const src = dstRing.map((_, i) => [ring[(i + rot) % 4].cx, ring[(i + rot) % 4].cy]);
    const H = solveHomography(dstRing, src);
    if (!H) continue;
    const at = sampler(bin, w, h, H);
    const bits = layout.codeCells.map((c) => squareFill(at, c.x, c.y, c.size));
    const first = bits[0];
    const value = bits.slice(1).reduce((a, f) => (a << 1) | (f > 0.5 ? 1 : 0), 0);
    const popcount = (n: number) => { let c = 0; for (; n; n >>= 1) c += n & 1; return c; };
    let mism = Math.min(...codes.map((c) => popcount(c ^ value)));
    if (first < 0.5) mism += 2;
    const score = mism * 10 - first;
    if (!best || score < best.score) best = { score, mism, rot, at };
  }
  if (!best) return { ok: false, reason: 'homography' };
  const { at } = best;

  // Качество снимка: сколько пикселей приходится на мм бланка и насколько сильно он снят под углом
  const edge = (a: Blob, b: Blob) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const e = [edge(ring[0], ring[1]), edge(ring[1], ring[2]), edge(ring[2], ring[3]), edge(ring[3], ring[0])];
  const mmE = [0, 1, 2, 3].map((i) => Math.hypot(dstRing[(i + 1) % 4][0] - dstRing[i][0], dstRing[(i + 1) % 4][1] - dstRing[i][1]));
  const pxPerMm = e.reduce((a, v) => a + v, 0) / mmE.reduce((a, v) => a + v, 0);
  const skew = Math.max(Math.max(e[0], e[2]) / Math.min(e[0], e[2]), Math.max(e[1], e[3]) / Math.min(e[1], e[3]));

  return {
    ok: true,
    codeOk: best.mism === 0,
    quality: { pxPerMm, skew },
    rotation: best.rot * 90,
    variant: pickOne(layout.variant, at),
    tests: layout.tests.map((t) => ({ q: t.q, ...pickOne(t.options, at) })),
    matching: layout.matching.map((m) => ({ q: m.q, rows: m.rows.map((r) => ({ row: r.row, ...pickOne(r.options, at) })) })),
    open: layout.open.map((o) => ({ q: o.q, boxes: o.boxes.map((b) => openBox(at, b)) })),
  };
}
