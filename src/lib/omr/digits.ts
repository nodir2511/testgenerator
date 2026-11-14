// Цифры из клеток открытых вопросов: приведение рисунка к 28×28 и запасной набор «синтетических» примеров.
import type { OpenBox } from './types';

/** Штрихи цифр в единичном квадрате (x вправо, y вниз). Из них строятся примеры, пока нет настоящих. */
export const GLYPHS: Record<string, number[][]> = {
  0: [[0.5, 0], [0.1, 0.2], [0, 0.5], [0.1, 0.8], [0.5, 1], [0.9, 0.8], [1, 0.5], [0.9, 0.2], [0.5, 0]],
  1: [[0.3, 0.25], [0.55, 0], [0.55, 1]],
  2: [[0, 0.2], [0.2, 0], [0.8, 0], [1, 0.25], [0, 1], [1, 1]],
  3: [[0, 0], [1, 0], [0.4, 0.45], [1, 0.65], [0.8, 1], [0.1, 1]],
  4: [[0.7, 1], [0.7, 0], [0, 0.7], [1, 0.7]],
  5: [[1, 0], [0.1, 0], [0, 0.45], [0.7, 0.4], [1, 0.7], [0.8, 1], [0, 1]],
  6: [[0.9, 0], [0.2, 0.3], [0, 0.7], [0.3, 1], [0.9, 0.9], [0.9, 0.55], [0.2, 0.55]],
  7: [[0, 0], [1, 0], [0.4, 1]],
  8: [[0.5, 0.5], [0.1, 0.25], [0.5, 0], [0.9, 0.25], [0.5, 0.5], [0.05, 0.75], [0.5, 1], [0.95, 0.75], [0.5, 0.5]],
  9: [[1, 0.45], [0.2, 0.5], [0.1, 0.1], [0.7, 0], [1, 0.2], [1, 0.6], [0.5, 1]],
};

export const PIX = 14; // сторона маленькой картинки для сравнения и для хранения (14×14, 1 байт на пиксель)

/** Рисунок цифры как у MNIST: обрезка по чернилам, вписывание в 20×20, центр масс в центре 28×28. Значения 0…1. */
export function digitTo28(box: Pick<OpenBox, 'cols' | 'rows' | 'bitmap'>): Float32Array {
  const { cols, rows, bitmap } = box;
  const out = new Float32Array(28 * 28);
  let x0 = cols, x1 = -1, y0 = rows, y1 = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (bitmap[r * cols + c]) {
    if (c < x0) x0 = c;
    if (c > x1) x1 = c;
    if (r < y0) y0 = r;
    if (r > y1) y1 = r;
  }
  if (x1 < 0) return out;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = 20 / Math.max(bw, bh);
  const tw = bw * s, th = bh * s;
  const tmp = new Float32Array(28 * 28);
  let sx = 0, sy = 0, m = 0;
  const k = Math.max(1, Math.round(1 / s));
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
    const px = x0 + (x - (28 - tw) / 2) / s, py = y0 + (y - (28 - th) / 2) / s;
    const ix = Math.floor(px), iy = Math.floor(py);
    let v = 0;
    if (ix >= x0 && ix <= x1 && iy >= y0 && iy <= y1) {
      let sum = 0, cnt = 0;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
        sum += bitmap[Math.min(y1, iy + dy) * cols + Math.min(x1, ix + dx)];
        cnt++;
      }
      v = sum / cnt;
    }
    tmp[y * 28 + x] = v;
    sx += x * v; sy += y * v; m += v;
  }
  if (m === 0) return out;
  const shx = Math.round(13.5 - sx / m), shy = Math.round(13.5 - sy / m);
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
    const xx = x - shx, yy = y - shy;
    if (xx >= 0 && xx < 28 && yy >= 0 && yy < 28) out[y * 28 + x] = tmp[yy * 28 + xx];
  }
  return out;
}

/** 28×28 → 14×14 (среднее по 2×2), байты 0…255 */
export function toPix(v28: Float32Array): Uint8Array {
  const out = new Uint8Array(PIX * PIX);
  for (let y = 0; y < PIX; y++) for (let x = 0; x < PIX; x++) {
    const s = v28[2 * y * 28 + 2 * x] + v28[2 * y * 28 + 2 * x + 1] + v28[(2 * y + 1) * 28 + 2 * x] + v28[(2 * y + 1) * 28 + 2 * x + 1];
    out[y * PIX + x] = Math.round((s / 4) * 255);
  }
  return out;
}

/** Рисунок клетки → байты 14×14 (то, что сравнивается и хранится) */
export const boxToPix = (box: Pick<OpenBox, 'cols' | 'rows' | 'bitmap'>): Uint8Array => toPix(digitTo28(box));

export const pixToBase64 = (p: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < p.length; i++) s += String.fromCharCode(p[i]);
  return btoa(s);
};
export const pixFromBase64 = (b64: string): Uint8Array | null => {
  try {
    const s = atob(b64);
    if (s.length !== PIX * PIX) return null;
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch { return null; }
};

// ---------- синтетические примеры ----------
const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Цифра, нарисованная штрихами с разбросом, в той же сетке, что даёт clеtка бланка (шаг 0,15 мм, поле 4,2×5,2 мм) */
export function drawGlyph(digit: string, rnd: () => number, cols = 28, rows = 34): Pick<OpenBox, 'cols' | 'rows' | 'bitmap'> {
  const step = 0.15, W = cols * step, Hh = rows * step;
  const gw = 3 + rnd() * 0.9, gh = 4 + rnd() * 0.7;
  const ox = (W - gw) / 2 + (rnd() - 0.5) * 0.5, oy = (Hh - gh) / 2 + (rnd() - 0.5) * 0.5;
  const slant = (rnd() - 0.5) * 0.3;
  const pts = GLYPHS[digit].map(([x, y]) => [ox + (x + slant * (0.5 - y)) * gw + (rnd() - 0.5) * 0.18, oy + y * gh + (rnd() - 0.5) * 0.18]);
  const wmm = 0.4 + rnd() * 0.2;
  const bitmap = new Uint8Array(cols * rows);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * step, y = r * step;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= wmm / 2) bitmap[r * cols + c] = 1;
    }
  }
  return { cols, rows, bitmap };
}

/** Запасной набор: по `perDigit` примеров каждой цифры (одинаковый при одинаковом seed) */
export function syntheticSamples(perDigit = 24, seed = 12345): Array<{ d: number; px: Uint8Array }> {
  const rnd = mulberry(seed);
  const out: Array<{ d: number; px: Uint8Array }> = [];
  for (let d = 0; d <= 9; d++) for (let i = 0; i < perDigit; i++) out.push({ d, px: boxToPix(drawGlyph(String(d), rnd)) });
  return out;
}
