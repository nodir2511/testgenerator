// Раскладка бланка (координаты в мм от левого верхнего угла полоски) и результат распознавания.
// Раскладки строит scripts/omr-blanks.mjs → layouts.generated.ts.

export interface OmrCircle { value: string | number; x: number; y: number; d: number }
export interface OmrLayout {
  id: string;
  /** Код бланка (3 бита в квадратиках внизу справа) */
  code: number;
  /** k18: 18 тестов + 2 соответствия + 7 открытых; k20: 20 + 4 + 2; k20c: 20 + 4 + 2 сжато («Биология ежедневный»); k12: 8 + 2 + 2 */
  kind: 'k18' | 'k20' | 'k20c' | 'k12';
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

/** gray — серая вырезка всей клетки с полем 0,5 мм (CELL_W×CELL_H, как на фото): по ней сеть читает цифру; есть только у клеток с цифрой */
export interface OpenBox { ink: number; hasDigit: boolean; heightMm: number; widthMm: number; cols: number; rows: number; bitmap: Uint8Array; gray?: Uint8Array }

export type OmrFail = 'markers' | 'shape' | 'homography';

export type OmrResult =
  | { ok: false; reason: OmrFail; missingHint?: string }
  | {
      ok: true;
      /** Код бланка совпал с раскладкой; иначе снимок нужно переснять */
      codeOk: boolean;
      /** На снимке целиком виден ещё хотя бы один бланк (прочитан только этот); ставит readGray */
      more?: true;
      missingHint?: string;
      /** Пикселей на мм бланка (чем больше, тем чётче), перекос: отношение противоположных сторон (1 — снято прямо), ring — насколько кружки бланка совпали с раскладкой (0…1) */
      quality: { pxPerMm: number; skew: number; ring: number };
      /** Во сколько градусов повёрнут снимок относительно бланка (0, 90, 180, 270) */
      rotation: number;
      /** Гомография «миллиметры бланка → пиксели снимка» (9 чисел): по ней снимок выпрямляется для показа */
      toPhoto: number[];
      variant: Picked;
      tests: Array<{ q: number } & Picked>;
      matching: Array<{ q: number; rows: Array<{ row: string } & Picked> }>;
      open: Array<{ q: number; boxes: OpenBox[] }>;
    };
