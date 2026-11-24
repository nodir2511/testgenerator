// Вся тяжёлая работа над одним снимком: чтение, выпрямленная полоска, картинка «что видит программа».
// Без браузера: одинаково работает в фоновом потоке (omr.worker.ts), в основном потоке и в тестах.
import { OMR_LAYOUTS } from './layouts.generated';
import { readGray } from './readPhoto';
import { omrDebug, omrReadAny } from './recognize';
import { rectifyStrip, sheetCorners } from './rectify';
import type { GrayImage, OmrResult } from './types';

/** Выпрямленный снимок полоски и id раскладки, по которой берутся фрагменты */
export interface Sheet { layout: string; img: GrayImage & { data: Uint8Array } }
export interface ProcessOut {
  res?: Extract<OmrResult, { ok: true }>;
  sheet?: Sheet;
  error?: string;
  debug?: { w: number; h: number; bin: Uint8Array; markers: Array<{ x: number; y: number }> };
}

const pick = (ids: string[]) => ids.map((id) => OMR_LAYOUTS[id]).filter(Boolean);

export function processGray(img: GrayImage, layouts: string[]): ProcessOut {
  const r = readGray(img, pick(layouts), Object.values(OMR_LAYOUTS));
  if (r.res) return { res: r.res, sheet: { layout: r.layout.id, img: rectifyStrip(img, r.res.toPhoto, r.layout.strip) } };
  const d = omrDebug(img, r.layout);
  return { error: r.error, debug: { w: img.w, h: img.h, bin: d.bin, markers: d.markers } };
}

export interface ProbeOut { corners: Array<[number, number]>; layout: string; res: Extract<OmrResult, { ok: true }> }
/** Есть ли в кадре камеры нужный бланк: углы на кадре и прочитанное (для кружочков поверх камеры) или null */
export function probeGray(img: GrayImage, layouts: string[]): ProbeOut | null {
  const { res, layout } = omrReadAny(img, pick(layouts));
  return res.ok && res.codeOk ? { corners: sheetCorners(res.toPhoto, layout), layout: layout.id, res } : null;
}
