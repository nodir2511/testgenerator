// Автоснимок: когда бланк сам виден в кадре целиком и неподвижно, снимать без нажатия (чистая логика, проверяется тестами).
import type { Ok } from './logic';

export type Corners = Array<[number, number]>;
export interface AutoState {
  /** Сколько проб подряд бланк виден и стоит на месте */
  good: number;
  /** Сколько проб подряд бланка в кадре нет */
  lost: number;
  /** Можно ли снимать: после снимка ждём, пока лист уберут */
  armed: boolean;
  last: Corners | null;
}

export const AUTO_START: AutoState = { good: 0, lost: 0, armed: true, last: null };
const NEED_GOOD = 2;
const NEED_LOST = 2;
/** Насколько углы могут сдвинуться между пробами (доля длинной стороны кадра) */
const STILL = 0.025;

export function moved(a: Corners, b: Corners): number {
  return Math.max(...a.map(([x, y], i) => Math.hypot(x - b[i][0], y - b[i][1])));
}

/** Шаг после каждой пробы кадра. snap = true — пора снимать */
export function autoStep(s: AutoState, corners: Corners | null, side: number): { state: AutoState; snap: boolean } {
  if (!corners) {
    const lost = s.lost + 1;
    return { state: { good: 0, lost, armed: s.armed || lost >= NEED_LOST, last: null }, snap: false };
  }
  const still = !!s.last && moved(s.last, corners) <= side * STILL;
  const good = still ? s.good + 1 : 1;
  if (s.armed && good >= NEED_GOOD) return { state: { good: 0, lost: 0, armed: false, last: corners }, snap: true };
  return { state: { good, lost: 0, armed: s.armed, last: corners }, snap: false };
}

/** После любого снимка (в том числе кнопкой) ждём, пока лист сменят */
export const autoTaken = (s: AutoState): AutoState => ({ ...s, good: 0, armed: false });

/** «Отпечаток» ответов: если новый автоснимок совпал с предыдущим, это, скорее всего, тот же лист */
export function fingerprint(r: Ok): string {
  return JSON.stringify([
    r.variant.answer,
    r.tests.map((t) => t.answer),
    r.matching.map((m) => m.rows.map((x) => x.answer)),
    r.open.map((o) => o.boxes.map((b) => b.hasDigit)),
  ]);
}
export const sameSheet = (a: Ok | undefined, b: Ok | undefined): boolean => !!a && !!b && fingerprint(a) === fingerprint(b);
