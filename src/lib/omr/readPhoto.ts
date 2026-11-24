// Чтение одного фото бланка: общий путь для снимка с камеры и для фото из галереи.
// Без браузера (файл → серое изображение делает image.ts), поэтому проверяется тестами.
import { omrReadAny } from './recognize';
import type { GrayImage, OmrLayout, OmrResult } from './types';

type Ok = Extract<OmrResult, { ok: true }>;

export const FAIL_TEXT = 'Не видно четыре чёрных метки по углам бланка. Снимите бланк целиком при хорошем свете, чтобы все метки попали в кадр.';
export const CODE_TEXT = 'Не удалось определить вид бланка. Проверьте, что снят бланк нужного предмета, и переснимите: бланк целиком, без бликов и теней.';
export const OTHER_SUBJECT_TEXT = 'На фото бланк другого предмета: заданий столько же, но отметка вида бланка (квадратики внизу справа) другая. Возьмите бланк нужного предмета.';
export const NOT_IMAGE_TEXT = 'Это не фото. Выберите снимок бланка (картинку) из галереи.';
export const EMPTY_FILE_TEXT = 'Файл пустой. Выберите другое фото.';
export const DECODE_TEXT = 'Не удалось открыть фото. Выберите другой снимок (JPG или PNG) или сфотографируйте бланк заново.';

/** Что не так с выбранным файлом ещё до распознавания (null — можно читать). Тип бывает пустым: тогда решает попытка открыть. */
export function fileProblem(file: { type?: string; size: number }): string | null {
  if (!file.size) return EMPTY_FILE_TEXT;
  if (file.type && !file.type.toLowerCase().startsWith('image/')) return NOT_IMAGE_TEXT;
  return null;
}

const sizeOf = (l: OmrLayout) => `тестов: ${l.tests.length}, соответствий: ${l.matching.length}, открытых: ${l.open.length}`;

/** Сообщение «на фото бланк другого вида»: какой бланк на фото и какой нужен */
export function otherBlankText(found: OmrLayout, wanted: OmrLayout): string {
  if (sizeOf(found) === sizeOf(wanted)) return OTHER_SUBJECT_TEXT;
  return `На фото бланк другого вида (${sizeOf(found)}), а нужен бланк на ${wanted.tests.length + wanted.matching.length + wanted.open.length} заданий (${sizeOf(wanted)}). Возьмите нужный бланк.`;
}

/** Итог чтения: прочитанный бланк либо понятная причина отказа (layout — раскладка, по которой прочитано или искали) */
export type PhotoRead = { res: Ok; error?: undefined; layout: OmrLayout } | { res?: undefined; error: string; layout: OmrLayout };

/**
 * Читает бланк по серому изображению и переводит отказ в текст для пользователя:
 * нет угловых меток (не бланк, обрезан) — подсказка про метки; метки есть, но код бланка не сошёлся — подсказка про вид бланка.
 * Если фото не подошло, оно сверяется с остальными видами бланков (others): целый бланк другого вида называется прямо,
 * иначе подсказка «не виден угол» вводила бы в заблуждение. Если известно, какой угол не виден, говорится про него.
 */
export function readGray(img: GrayImage, layouts: OmrLayout[], others: OmrLayout[] = []): PhotoRead {
  const { res, layout } = omrReadAny(img, layouts);
  if (res.ok && res.codeOk) return { res, layout };
  // Совсем нет меток — это не бланк, сверять не с чем (и не тратим время на повторное чтение)
  const rest = !res.ok && res.reason === 'markers' ? [] : others.filter((o) => !layouts.includes(o));
  if (rest.length) {
    const alt = omrReadAny(img, rest);
    if (alt.res.ok && alt.res.codeOk) return { error: otherBlankText(alt.layout, layout), layout };
  }
  return { error: res.missingHint || (res.ok ? CODE_TEXT : FAIL_TEXT), layout };
}
