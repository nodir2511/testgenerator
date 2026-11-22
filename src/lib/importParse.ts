// Разбор строк импорта вопросов (Word, Excel, CSV, текст): типы строк предпросмотра и чистые функции без интерфейса.
import type { QuestionType } from '../types/database';

export type ImportLang = 'ru' | 'tg';

export interface ParsedRow {
  rowNum: number;
  type: QuestionType;
  /** Язык, на котором написан content (и тексты вариантов); при contentTg — это русский */
  lang?: ImportLang;
  content: string;
  /** Таджикский текст (двуязычный импорт парой файлов) */
  contentTg?: string;
  warnings?: string[];
  imageUrl?: string | null;
  subjectName: string;
  chapterName: string;
  topicName: string;
  sourceName?: string;
  optionsText?: string;
  rawOptions?: { text: string; textTg?: string; imageUrl?: string | null }[];
  matchingText?: string;
  rawMatchingItems?: { side: 'left' | 'right'; text: string; text_tg?: string; image_url?: string | null; order_index: number }[];
  correctAnswer?: string;
  section?: string;
  errors: string[];
}

export function parseNumericAnswer(raw?: string): number | null {
  if (!raw) return null;
  const t = raw.trim().replace(/[−–—]/g, '-').replace(/\*+$/, '').replace(/(\d)\s+(?=\d{3}(?:\D|$))/g, '$1');
  const num = (x: string) => Number(x.replace(',', '.'));
  const frac = t.match(/^(-?\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
  if (frac) {
    const d = num(frac[2]);
    if (d) return num(frac[1]) / d;
  }
  const m = t.match(/^-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  // «12,04·10²³» — число со степенью десяти: не подменяем его мантиссой
  if (/^\s*[·x×*]\s*10/i.test(t.slice(m[0].length))) return null;
  return num(m[0]);
}

// Предупреждение, если у открытого вопроса ответ указан, но числом не распознан
export function answerWarning(type: QuestionType, answer?: string): string[] {
  return type === 'open' && answer && parseNumericAnswer(answer) === null
    ? [`Ответ «${answer}» не распознан как число — вопрос сохранится без ответа`]
    : [];
}

// Поля текста для базы по языку записи
export function langFields(lang: ImportLang | undefined, text: string, textTg?: string) {
  if (textTg !== undefined) return { text, text_ru: text || null, text_tg: textTg || null };
  return lang === 'tg' ? { text, text_ru: null, text_tg: text } : { text, text_ru: text, text_tg: null };
}

// Сравнение вопросов при защите от дублей: текст без тегов и лишних пробелов
export const normText = (x: string | null | undefined) => (x || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export function isCorrectLetter(answer: string | undefined, optionIndex: number): boolean {
  if (!answer) return false;
  // Допускаем кириллические двойники латинских букв (А, В, С, Е)
  const twin: Record<string, string> = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E' };
  const l = answer.trim().toUpperCase();
  return (twin[l] || l) === 'ABCDEF'[optionIndex];
}

export interface ImportReport {
  total: number;
  inserted: number;
  skipped: number;
  failed: { rowNum: number; message: string }[];
}
