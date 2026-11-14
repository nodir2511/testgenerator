// Только браузер: файл фото → серое изображение для распознавания.
import type { GrayImage } from './types';

const MAX_SIDE = 1800;

export async function loadGrayImage(file: Blob): Promise<GrayImage> {
  // imageOrientation учитывает поворот из EXIF — снимки с телефона не лежат на боку
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
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
