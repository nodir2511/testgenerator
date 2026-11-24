// Выпрямленный снимок полоски и его фрагменты: показать проверяющему, что именно отмечено на бумаге.
// Без браузера: работает над серым изображением, координаты — миллиметры раскладки бланка.
import { applyH } from './recognize';
import type { GrayImage, OmrLayout } from './types';

export const SHEET_PPM = 6;
export interface RectMm { x: number; y: number; w: number; h: number }

/** Серая полоска бланка без перекоса и поворота, ppm пикселей на миллиметр */
export function rectifyStrip(img: GrayImage, toPhoto: number[], strip: { w: number; h: number }, ppm = SHEET_PPM): GrayImage & { data: Uint8Array } {
  const w = Math.round(strip.w * ppm), h = Math.round(strip.h * ppm);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [fx, fy] = applyH(toPhoto, (x + 0.5) / ppm, (y + 0.5) / ppm);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= img.w || y0 + 1 >= img.h) { data[y * w + x] = 200; continue; }
      const ax = fx - x0, ay = fy - y0, i = y0 * img.w + x0;
      data[y * w + x] = Math.round(
        (img.data[i] * (1 - ax) + img.data[i + 1] * ax) * (1 - ay) + (img.data[i + img.w] * (1 - ax) + img.data[i + img.w + 1] * ax) * ay,
      );
    }
  }
  return { w, h, data };
}

/** Где на снимке лежат угловые метки (порядок раскладки: ЛВ, ПВ, ЛН, ПН) */
export const sheetCorners = (toPhoto: number[], layout: OmrLayout): Array<[number, number]> => layout.markers.map((m) => applyH(toPhoto, m.x, m.y));

export function cropSheet(sheet: GrayImage, r: RectMm, ppm = SHEET_PPM): GrayImage & { data: Uint8Array } {
  const x0 = Math.max(0, Math.round(r.x * ppm)), y0 = Math.max(0, Math.round(r.y * ppm));
  const x1 = Math.min(sheet.w, Math.round((r.x + r.w) * ppm)), y1 = Math.min(sheet.h, Math.round((r.y + r.h) * ppm));
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = sheet.data[(y0 + y) * sheet.w + x0 + x];
  return { w, h, data };
}

const clip = (l: OmrLayout, x0: number, y0: number, x1: number, y1: number): RectMm => {
  const a = Math.max(0, x0), b = Math.max(0, y0);
  return { x: a, y: b, w: Math.min(l.strip.w, x1) - a, h: Math.min(l.strip.h, y1) - b };
};
/** Прямоугольник вокруг ряда кружков; слева запас на напечатанный номер */
const around = (l: OmrLayout, options: Array<{ x: number; y: number; d: number }>, left: number, pad = 1.4): RectMm => clip(
  l,
  Math.min(...options.map((o) => o.x - o.d / 2)) - left,
  Math.min(...options.map((o) => o.y - o.d / 2)) - pad,
  Math.max(...options.map((o) => o.x + o.d / 2)) + pad,
  Math.max(...options.map((o) => o.y + o.d / 2)) + pad,
);

export const testRect = (l: OmrLayout, i: number): RectMm => around(l, l.tests[i].options, 7);
export const matchRect = (l: OmrLayout, i: number, row: number): RectMm => around(l, l.matching[i].rows[row].options, 5, 1);
export const variantRect = (l: OmrLayout): RectMm => around(l, l.variant, 2);
export function openRect(l: OmrLayout, i: number): RectMm {
  const b = l.open[i].boxes;
  return clip(l, Math.min(...b.map((c) => c.x)) - 1.2, Math.min(...b.map((c) => c.y)) - 1.2, Math.max(...b.map((c) => c.x + c.w)) + 1.2, Math.max(...b.map((c) => c.y + c.h)) + 1.2);
}
