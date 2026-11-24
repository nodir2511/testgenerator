// Только браузер: файл фото → серое изображение для распознавания.
import type { GrayImage } from './types';

const MAX_SIDE = 1800;

export async function loadGrayImage(file: Blob | HTMLCanvasElement, maxSide = MAX_SIDE): Promise<GrayImage & { data: Uint8Array }> {
  // imageOrientation учитывает поворот из EXIF — снимки с телефона не лежат на боку
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Не удалось обработать фото');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
  return { w, h, data };
}

/** Картинка для подсказки: чёрное — то, что распознавание сочло тёмным; красные кружки — найденные угловые метки */
export function debugPicture(img: { w: number; h: number }, bin: Uint8Array, markers: Array<{ x: number; y: number }>): string {
  const k = Math.min(1, 640 / img.w);
  const c = document.createElement('canvas');
  c.width = Math.round(img.w * k);
  c.height = Math.round(img.h * k);
  const full = document.createElement('canvas');
  full.width = img.w;
  full.height = img.h;
  const fctx = full.getContext('2d');
  const ctx = c.getContext('2d');
  if (!fctx || !ctx) return '';
  const id = fctx.createImageData(img.w, img.h);
  for (let i = 0; i < img.w * img.h; i++) {
    const v = bin[i] ? 0 : 255;
    id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
  }
  fctx.putImageData(id, 0, 0);
  ctx.drawImage(full, 0, 0, c.width, c.height);
  ctx.strokeStyle = '#e11'; ctx.lineWidth = 3;
  for (const m of markers) { ctx.beginPath(); ctx.arc(m.x * k, m.y * k, 12, 0, Math.PI * 2); ctx.stroke(); }
  return c.toDataURL('image/jpeg', 0.7);
}
