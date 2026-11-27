// Маленькая свёрточная сеть для рукописных цифр в клетках открытых ответов:
// 14×14 → свёртка 3×3 (c1 каналов, с полями) → максимум по 2×2 (7×7) → свёртка 3×3 (c2 каналов, 5×5) → fc → 10.
// Работает в браузере без библиотек и без интернета. Веса создаёт scripts/train-digit-nn.py.
import { DIGIT_NN_CONFIG, DIGIT_NN_WEIGHTS_BASE64 } from './digitWeights.generated';
import { CELL_NN_CONFIG, CELL_NN_WEIGHTS_BASE64 } from './cellWeights.generated';
import { boxToPix } from './digits';
import type { OpenBox } from './types';

export interface DigitNnPrediction {
  digit: number;
  prob: number;
  unsure: boolean;
  probs: Float32Array;
}

interface Weights { K1: Float32Array; c1: Float32Array; K2: Float32Array; c2: Float32Array; W1: Float32Array; b1: Float32Array; W2: Float32Array; b2: Float32Array }
let cachedWeights: Weights | null = null;

const S = 14, P = 7, Q = 5; // сторона входа, после максимума 2×2, после второй свёртки

function loadWeights(): Weights {
  if (cachedWeights) return cachedWeights;
  const binaryString = atob(DIGIT_NN_WEIGHTS_BASE64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);

  const { c1: C1, c2: C2, fc: F, out: OUT } = DIGIT_NN_CONFIG;
  let offset = 0;
  const take = (n: number) => { const a = f32.subarray(offset, offset + n); offset += n; return a; };
  cachedWeights = { K1: take(9 * C1), c1: take(C1), K2: take(9 * C1 * C2), c2: take(C2), W1: take(Q * Q * C2 * F), b1: take(F), W2: take(F * OUT), b2: take(OUT) };
  return cachedWeights;
}

/** Предсказание цифры по картинке 14x14 (196 байт) */
export function predictDigitNnPix(pix: Uint8Array): DigitNnPrediction {
  const { K1, c1, K2, c2, W1, b1, W2, b2 } = loadWeights();
  const { c1: C1, c2: C2, fc: F, out: OUT } = DIGIT_NN_CONFIG;

  // Свёртка 1 (с нулевыми полями) + ReLU и сразу максимум по 2×2
  const p1 = new Float32Array(P * P * C1);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = ((y >> 1) * P + (x >> 1)) * C1;
    for (let c = 0; c < C1; c++) {
      let sum = c1[c];
      for (let i = 0; i < 3; i++) {
        const yy = y + i - 1;
        if (yy < 0 || yy >= S) continue;
        for (let j = 0; j < 3; j++) {
          const xx = x + j - 1;
          if (xx < 0 || xx >= S) continue;
          const v = pix[yy * S + xx];
          if (v > 0) sum += (v / 255) * K1[(i * 3 + j) * C1 + c];
        }
      }
      if (sum > p1[o + c]) p1[o + c] = sum; // ReLU: меньше нуля не бывает
    }
  }

  // Свёртка 2 (без полей) + ReLU
  const a2 = new Float32Array(Q * Q * C2);
  for (let y = 0; y < Q; y++) for (let x = 0; x < Q; x++) {
    const o = (y * Q + x) * C2;
    for (let k = 0; k < C2; k++) a2[o + k] = c2[k];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const src = ((y + i) * P + x + j) * C1, kw = (i * 3 + j) * C1;
      for (let c = 0; c < C1; c++) {
        const v = p1[src + c];
        if (v === 0) continue;
        const row = (kw + c) * C2;
        for (let k = 0; k < C2; k++) a2[o + k] += v * K2[row + k];
      }
    }
    for (let k = 0; k < C2; k++) if (a2[o + k] < 0) a2[o + k] = 0;
  }

  // Полносвязный слой + ReLU
  const h = new Float32Array(F);
  h.set(b1);
  for (let i = 0; i < a2.length; i++) {
    const v = a2[i];
    if (v === 0) continue;
    const row = i * F;
    for (let k = 0; k < F; k++) h[k] += v * W1[row + k];
  }

  // Выход + softmax
  const z = new Float32Array(OUT);
  z.set(b2);
  for (let j = 0; j < F; j++) {
    if (h[j] <= 0) continue;
    for (let k = 0; k < OUT; k++) z[k] += h[j] * W2[j * OUT + k];
  }
  let maxZ = -Infinity;
  for (let k = 0; k < OUT; k++) if (z[k] > maxZ) maxZ = z[k];

  const probs = new Float32Array(OUT);
  let sumExp = 0;
  for (let k = 0; k < OUT; k++) {
    probs[k] = Math.exp(z[k] - maxZ);
    sumExp += probs[k];
  }

  let bestDigit = 0;
  let maxProb = 0;
  for (let k = 0; k < OUT; k++) {
    probs[k] /= sumExp;
    if (probs[k] > maxProb) {
      maxProb = probs[k];
      bestDigit = k;
    }
  }

  return {
    digit: bestDigit,
    prob: maxProb,
    unsure: maxProb < 0.65,
    probs,
  };
}

// ---------- сеть по серой вырезке всей клетки (cellGray в recognize.ts) ----------
let cellWeights: Weights | null = null;

function decode(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function loadCellWeights(): Weights {
  if (cellWeights) return cellWeights;
  const f32 = decode(CELL_NN_WEIGHTS_BASE64);
  const { w, h, c1: C1, c2: C2, fc: F, out: OUT } = CELL_NN_CONFIG;
  let offset = 0;
  const take = (n: number) => { const a = f32.subarray(offset, offset + n); offset += n; return a; };
  cellWeights = { K1: take(9 * C1), c1: take(C1), K2: take(9 * C1 * C2), c2: take(C2), W1: take((w >> 2) * (h >> 2) * C2 * F), b1: take(F), W2: take(F * OUT), b2: take(OUT) };
  return cellWeights;
}

/** Свёртка 3×3 с нулевыми полями + ReLU + максимум по 2×2: вход h×w×cin, выход (h/2)×(w/2)×cout */
function convPool(src: Float32Array, h: number, w: number, cin: number, K: Float32Array, bias: Float32Array, cout: number): Float32Array {
  const oh = h >> 1, ow = w >> 1;
  const out = new Float32Array(oh * ow * cout);
  const acc = new Float32Array(cout);
  for (let y = 0; y < oh * 2; y++) for (let x = 0; x < ow * 2; x++) {
    acc.set(bias);
    for (let i = 0; i < 3; i++) {
      const yy = y + i - 1;
      if (yy < 0 || yy >= h) continue;
      for (let j = 0; j < 3; j++) {
        const xx = x + j - 1;
        if (xx < 0 || xx >= w) continue;
        const sp = (yy * w + xx) * cin, kw = (i * 3 + j) * cin;
        for (let c = 0; c < cin; c++) {
          const v = src[sp + c];
          if (v === 0) continue;
          const row = (kw + c) * cout;
          for (let k = 0; k < cout; k++) acc[k] += v * K[row + k];
        }
      }
    }
    const o = ((y >> 1) * ow + (x >> 1)) * cout;
    for (let k = 0; k < cout; k++) if (acc[k] > out[o + k]) out[o + k] = acc[k];
  }
  return out;
}

/** Предсказание цифры по серой вырезке всей клетки (CELL_W×CELL_H байт, как на фото: тёмные чернила) */
export function predictDigitNnCell(gray: Uint8Array): DigitNnPrediction {
  const { K1, c1, K2, c2, W1, b1, W2, b2 } = loadCellWeights();
  const { w, h, c1: C1, c2: C2, fc: F, out: OUT } = CELL_NN_CONFIG;

  // Нормировка как при обучении: фон (85-й процентиль яркости) → 0, самое тёмное → 1, размах не меньше 40
  const sorted = Array.from(gray).sort((a, b) => a - b);
  const pos = 0.85 * (sorted.length - 1), i0 = Math.floor(pos);
  const bg = sorted[i0] + (sorted[Math.min(sorted.length - 1, i0 + 1)] - sorted[i0]) * (pos - i0);
  const span = Math.max(40, bg - sorted[0]);
  const x0 = new Float32Array(w * h);
  for (let i = 0; i < x0.length; i++) x0[i] = Math.min(1, Math.max(0, (bg - gray[i]) / span));

  const p1 = convPool(x0, h, w, 1, K1, c1, C1);
  const p2 = convPool(p1, h >> 1, w >> 1, C1, K2, c2, C2);

  const hid = new Float32Array(F);
  hid.set(b1);
  for (let i = 0; i < p2.length; i++) {
    const v = p2[i];
    if (v === 0) continue;
    const row = i * F;
    for (let k = 0; k < F; k++) hid[k] += v * W1[row + k];
  }
  const z = new Float32Array(OUT);
  z.set(b2);
  for (let j = 0; j < F; j++) {
    if (hid[j] <= 0) continue;
    for (let k = 0; k < OUT; k++) z[k] += hid[j] * W2[j * OUT + k];
  }
  let maxZ = -Infinity;
  for (let k = 0; k < OUT; k++) if (z[k] > maxZ) maxZ = z[k];
  const probs = new Float32Array(OUT);
  let sumExp = 0;
  for (let k = 0; k < OUT; k++) { probs[k] = Math.exp(z[k] - maxZ); sumExp += probs[k]; }
  let digit = 0, prob = 0;
  for (let k = 0; k < OUT; k++) {
    probs[k] /= sumExp;
    if (probs[k] > prob) { prob = probs[k]; digit = k; }
  }
  return { digit, prob, unsure: prob < 0.65, probs };
}

/** Предсказание цифры по ячейке открытого вопроса: по серой вырезке всей клетки, а если её нет — по рисунку 14×14 */
export function predictDigitNnBox(box: Pick<OpenBox, 'cols' | 'rows' | 'bitmap' | 'gray'>): DigitNnPrediction {
  if (box.gray && box.gray.length === CELL_NN_CONFIG.w * CELL_NN_CONFIG.h) return predictDigitNnCell(box.gray);
  return predictDigitNnPix(boxToPix(box));
}
