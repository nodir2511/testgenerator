// Черновик нового вопроса и пустые структуры формы вопроса (QuestionForm)
import type { QuestionType } from '../types/database';

export interface TestOptionState {
  id?: string;
  text: string;
  text_ru?: string;
  text_tg?: string;
  image_url?: string | null;
  is_correct?: boolean;
}

export interface MatchingItemState {
  id?: string;
  side: 'left' | 'right';
  text: string;
  text_ru?: string;
  text_tg?: string;
  image_url?: string | null;
  /** Только для левой колонки: индекс подходящего элемента правой колонки (ответ) */
  match?: number | null;
}

// Русское поле: если вопрос только на таджикском, base (= content) совпадает с таджикским текстом — в русское его не копируем
export const ruOf = (ru?: string | null, base?: string | null, tg?: string | null): string =>
  ru || (base && base !== tg ? base : '') || '';

// Пустые варианты для нового вопроса
export const emptyOptions = (): TestOptionState[] => [
  { text: '', text_ru: '', text_tg: '', is_correct: true },
  { text: '', text_ru: '', text_tg: '', is_correct: false },
  { text: '', text_ru: '', text_tg: '', is_correct: false },
  { text: '', text_ru: '', text_tg: '', is_correct: false },
];
export const emptySide = (side: 'left' | 'right', n: number): MatchingItemState[] =>
  Array.from({ length: n }, () => ({ side, text: '', text_ru: '', text_tg: '' }));

// Черновик нового вопроса: переживает случайное закрытие вкладки или перезагрузку
export const DRAFT_KEY = 'examiner_qf_draft';
export interface Draft { savedAt: number; type: QuestionType; contentRu: string; contentTg: string; imageUrl: string | null; correctNumeric: string; options: TestOptionState[]; leftItems: MatchingItemState[]; rightItems: MatchingItemState[]; passageId?: string; passageOrder?: string }
export const readDraft = (): Draft | null => {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return d && typeof d.savedAt === 'number' ? d : null;
  } catch {
    return null;
  }
};
