// Классификатор цифр для экрана проверки: микро-нейросеть + запасная синтетика + собранные примеры.
import { boxToPix, pixFromBase64, pixToBase64 } from './digits';
import { DigitKnn, bootstrapKnn, type DigitSample } from './knn';
import { predictDigitNnBox } from './digitNn';
import type { OmrResult } from './types';

type Open = Extract<OmrResult, { ok: true }>['open'][number];

export interface OpenHint { text: string; unsure: boolean; digits: Array<{ digit: number; unsure: boolean }> }

let cached: Promise<DigitKnn> | null = null;

/** Загружает собранные примеры один раз за сеанс; если не вышло — остаётся запасной набор */
export function loadDigitModel(fetchSamples: () => Promise<Array<{ d: number; px: string }>>): Promise<DigitKnn> {
  if (!cached) {
    cached = (async () => {
      const knn = bootstrapKnn();
      try {
        const real: DigitSample[] = [];
        for (const s of await fetchSamples()) {
          const px = pixFromBase64(s.px);
          if (px) real.push({ d: s.d, px });
        }
        knn.add(real, true);
      } catch { /* без сети — только запасной набор */ }
      return knn;
    })();
  }
  return cached;
}

/** Подсказка по одному открытому вопросу: микро-нейросеть + валидация через kNN */
export function guessOpen(knn: DigitKnn | null, o: Open): OpenHint | null {
  const digits: OpenHint['digits'] = [];
  for (const b of o.boxes) {
    if (!b.hasDigit) continue;
    const nnPred = predictDigitNnBox(b);
    let digit = nnPred.digit;
    let unsure = nnPred.unsure;

    if (knn) {
      const g = knn.predictBox(b);
      if (g) {
        if (!g.unsure && !nnPred.unsure && g.digit === nnPred.digit) {
          digit = g.digit;
          unsure = false;
        } else if (!nnPred.unsure && nnPred.prob > 0.82) {
          digit = nnPred.digit;
          unsure = false;
        } else if (!g.unsure && knn.real > 40) {
          digit = g.digit;
          unsure = g.digit !== nnPred.digit;
        }
      }
    }

    digits.push({ digit, unsure });
  }
  if (!digits.length) return null;
  return { text: digits.map((d) => d.digit).join(''), unsure: digits.some((d) => d.unsure), digits };
}

/**
 * Картинки цифр с метками для сбора. Метка — число, которое подтвердил проверяющий.
 * Если цифры подставлены подсказкой и не правились, берём только те, в которых подсказка была уверена.
 */
export function collectSamples(open: Open[], typed: string[], hints: Array<OpenHint | null>): Array<{ d: number; px: string }> {
  const out: Array<{ d: number; px: string }> = [];
  open.forEach((o, i) => {
    const boxes = o.boxes.filter((b) => b.hasDigit);
    const text = (typed[i] ?? '').trim();
    if (!boxes.length || text.length !== boxes.length || !/^\d+$/.test(text)) return;
    const h = hints[i];
    boxes.forEach((b, j) => {
      if (h && h.digits[j] && h.text === text && h.digits[j].unsure) return; // принято подсказкой «с сомнением» — не берём
      out.push({ d: Number(text[j]), px: pixToBase64(boxToPix(b)) });
    });
  });
  return out;
}

const COLLECT_KEY = 'omr_collect_v1';
export const collectEnabled = (): boolean => {
  try { return localStorage.getItem(COLLECT_KEY) !== '0'; } catch { return true; }
};
export const setCollectEnabled = (on: boolean) => {
  try { localStorage.setItem(COLLECT_KEY, on ? '1' : '0'); } catch { /* память недоступна */ }
};
