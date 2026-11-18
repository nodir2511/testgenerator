// Микро-нейросеть (196 -> 48 -> 10) для классификации рукописных цифр в клетках открытых ответов.
// Работает полностью автономно в браузере за < 1 мс, без внешних библиотек и без интернета.
import { DIGIT_NN_CONFIG, DIGIT_NN_WEIGHTS_BASE64 } from './digitWeights.generated';
import { boxToPix } from './digits';
import type { OpenBox } from './types';

export interface DigitNnPrediction {
  digit: number;
  prob: number;
  unsure: boolean;
  probs: Float32Array;
}

let cachedWeights: {
  W1: Float32Array;
  b1: Float32Array;
  W2: Float32Array;
  b2: Float32Array;
} | null = null;

function loadWeights() {
  if (cachedWeights) return cachedWeights;
  const binaryString = atob(DIGIT_NN_WEIGHTS_BASE64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);

  const { in: IN, hid: HID, out: OUT } = DIGIT_NN_CONFIG;
  let offset = 0;
  const W1 = f32.subarray(offset, offset + IN * HID); offset += IN * HID;
  const b1 = f32.subarray(offset, offset + HID); offset += HID;
  const W2 = f32.subarray(offset, offset + HID * OUT); offset += HID * OUT;
  const b2 = f32.subarray(offset, offset + OUT); offset += OUT;

  cachedWeights = { W1, b1, W2, b2 };
  return cachedWeights;
}

/** Предсказание цифры по картинке 14x14 (196 байт) */
export function predictDigitNnPix(pix: Uint8Array): DigitNnPrediction {
  const { W1, b1, W2, b2 } = loadWeights();
  const { in: IN, hid: HID, out: OUT } = DIGIT_NN_CONFIG;

  // Layer 1: Linear + ReLU
  const h = new Float32Array(HID);
  for (let j = 0; j < HID; j++) {
    let sum = b1[j];
    for (let i = 0; i < IN; i++) {
      if (pix[i] > 0) sum += (pix[i] / 255) * W1[i * HID + j];
    }
    h[j] = sum > 0 ? sum : 0;
  }

  // Layer 2: Linear + Softmax
  const z = new Float32Array(OUT);
  let maxZ = -Infinity;
  for (let k = 0; k < OUT; k++) {
    let sum = b2[k];
    for (let j = 0; j < HID; j++) {
      if (h[j] > 0) sum += h[j] * W2[j * OUT + k];
    }
    z[k] = sum;
    if (sum > maxZ) maxZ = sum;
  }

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

/** Предсказание цифры по ячейке открытого вопроса */
export function predictDigitNnBox(box: Pick<OpenBox, 'cols' | 'rows' | 'bitmap'>): DigitNnPrediction {
  return predictDigitNnPix(boxToPix(box));
}
