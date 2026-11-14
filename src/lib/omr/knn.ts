// Распознавание одной цифры методом ближайших соседей: сравниваем рисунок клетки 14×14 с примерами.
import { PIX, boxToPix, syntheticSamples } from './digits';
import type { OpenBox } from './types';

export interface DigitSample { d: number; px: Uint8Array }
export interface DigitGuess {
  digit: number;
  /** Доля голосов за выбранную цифру среди ближайших соседей (0…1) */
  share: number;
  /** Расстояние до самого близкого примера (чем меньше, тем лучше) */
  nearest: number;
  /** Не стоит доверять: голоса разошлись или рисунок не похож ни на один пример */
  unsure: boolean;
}

export const K = 5;
/** Расстояние (евклидово по пикселям 0…1), дальше которого рисунок считается «не похожим ни на что» */
export const FAR = 5.5;
const MIN_SHARE = 0.6;

export class DigitKnn {
  private xs: Float32Array[] = [];
  private ds: number[] = [];
  /** Сколько настоящих (собранных) примеров среди загруженных */
  real = 0;

  add(samples: DigitSample[], real = false) {
    for (const s of samples) {
      if (s.px.length !== PIX * PIX || s.d < 0 || s.d > 9) continue;
      this.xs.push(Float32Array.from(s.px, (v) => v / 255));
      this.ds.push(s.d);
      if (real) this.real++;
    }
  }

  get size() { return this.xs.length; }

  predictPix(px: Uint8Array): DigitGuess | null {
    if (!this.xs.length) return null;
    const x = Float32Array.from(px, (v) => v / 255);
    const best: Array<{ d: number; dist: number }> = [];
    for (let i = 0; i < this.xs.length; i++) {
      const y = this.xs[i];
      let s = 0;
      for (let j = 0; j < x.length; j++) { const t = x[j] - y[j]; s += t * t; }
      const dist = Math.sqrt(s);
      if (best.length < K || dist < best[best.length - 1].dist) {
        best.push({ d: this.ds[i], dist });
        best.sort((a, b) => a.dist - b.dist);
        if (best.length > K) best.pop();
      }
    }
    const votes = new Array<number>(10).fill(0);
    let total = 0;
    for (const b of best) { const w = 1 / (b.dist + 0.5); votes[b.d] += w; total += w; }
    let digit = 0;
    for (let d = 1; d < 10; d++) if (votes[d] > votes[digit]) digit = d;
    const share = votes[digit] / total;
    const nearest = best[0].dist;
    return { digit, share, nearest, unsure: share < MIN_SHARE || nearest > FAR };
  }

  predictBox(box: Pick<OpenBox, 'cols' | 'rows' | 'bitmap'>): DigitGuess | null {
    return this.predictPix(boxToPix(box));
  }
}

/** Классификатор только на синтетике (запасной вариант, пока нет собранных примеров) */
export function bootstrapKnn(): DigitKnn {
  const k = new DigitKnn();
  k.add(syntheticSamples());
  return k;
}
