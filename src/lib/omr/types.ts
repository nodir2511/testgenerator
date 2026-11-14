// Раскладка бланка (координаты в мм от левого верхнего угла полоски) и результат распознавания.
// Раскладки строит scripts/omr-blanks.mjs → layouts.generated.ts.

export interface OmrCircle { value: string | number; x: number; y: number; d: number }
export interface OmrLayout {
  id: string;
  /** Код бланка (3 бита в квадратиках внизу справа) */
  code: number;
  /** k18: 18 тестов + 2 соответствия + 7 открытых; k20: 20 + 4 + 2; k12: 8 + 2 + 2 */
  kind: 'k18' | 'k20' | 'k12';
  strip: { w: number; h: number };
  /** Порядок: левый верхний, правый верхний, левый нижний, правый нижний */
  markers: Array<{ x: number; y: number; size: number }>;
  codeCells: Array<{ x: number; y: number; size: number; bit: number }>;
  variant: OmrCircle[];
  tests: Array<{ q: number; options: OmrCircle[] }>;
  matching: Array<{ q: number; frame: { x: number; y: number; w: number; h: number }; rows: Array<{ row: string; options: OmrCircle[] }> }>;
  open: Array<{ q: number; boxes: Array<{ x: number; y: number; w: number; h: number }> }>;
}

export interface GrayImage { w: number; h: number; data: ArrayLike<number> }

/** Ответ на одну клетку-группу: буква/цифра, null — не отмечено, 'multi' — отмечено несколько */
export interface Picked {
  answer: string | number | null;
  unsure: boolean;
  fills: number[];
  candidates?: Array<string | number>;
}

export interface OpenBox { ink: number; hasDigit: boolean; heightMm: number; widthMm: number; cols: number; rows: number; bitmap: Uint8Array }

export type OmrFail = 'markers' | 'shape' | 'homography';

export type OmrResult =
  | { ok: false; reason: OmrFail }
  | {
      ok: true;
      /** Код бланка совпал с раскладкой; иначе снимок нужно переснять */
      codeOk: boolean;
      /** Пикселей на мм бланка (чем больше, тем чётче) и перекос: отношение противоположных сторон (1 — снято прямо) */
      quality: { pxPerMm: number; skew: number };
      /** Во сколько градусов повёрнут снимок относительно бланка (0, 90, 180, 270) */
      rotation: number;
      variant: Picked;
      tests: Array<{ q: number } & Picked>;
      matching: Array<{ q: number; rows: Array<{ row: string } & Picked> }>;
      open: Array<{ q: number; boxes: OpenBox[] }>;
    };
