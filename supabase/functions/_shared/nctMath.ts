// Режим «по формату НЦТ» для математики: 27 заданий (18 тестов №1–18, 2 соответствия №19–20, 7 открытых №21–27), 40 баллов:
// тест 1 б., соответствие 4 б., открытое 2 б. (как у химии). Шесть официальных разделов НЦТ с долями баллов 18/21/13/13/17/18 (допуск ±2 берёт раскладка по баллам). Только типы; импорт без «.ts» не нужен.
import type { NctConfig } from './nct';
import { NCT_SLOT_TYPES_MATH, NCT_TYPE_SECTION_MATH } from './nctSlotsMath';

export const MATH_SECTIONS: Array<{ key: string; name: string; share: number }> = [
  { key: 'arith', name: 'Арифметика', share: 18 },
  { key: 'alg', name: 'Алгебра', share: 21 },
  { key: 'func', name: 'Функция', share: 13 },
  { key: 'trig', name: 'Тригонометрия', share: 13 },
  { key: 'anal', name: 'Анализ', share: 17 },
  { key: 'geo', name: 'Геометрия', share: 18 },
];

/**
 * Темы банка математики: главы 1–4 = части 1–4 сборников центра (темы 1–33 по порядку §):
 * часть 1 — §1–11 (числа и дроби), часть 2 — §1–8 (логика, степень, корень), часть 3 — §1–5 (алгебраические выражения),
 * часть 4 — §1–9 (уравнения и системы). Главы 5–8 — задания НЦТ 2022/2024/2026 по разделам: 5 «Функции» (5 тем по типам),
 * 6 «Тригонометрия» (4), 7 «Анализ» (4), 8 «Геометрия» (11); темы 34–57 по порядку.
 */
const MATH_TOPICS_IN_CHAPTER: Record<number, number> = { 1: 11, 2: 8, 3: 5, 4: 9, 5: 5, 6: 4, 7: 4, 8: 11 };
const MATH_CHAPTER_SECTION: Record<number, string> = { 1: 'arith', 2: 'arith', 3: 'alg', 4: 'alg', 5: 'func', 6: 'trig', 7: 'anal', 8: 'geo' };

/** Сквозной номер темы центра (1–57) по порядку главы и темы; null — вне режима */
export function mathTopicNumber(chapterOrder: number, topicOrder: number): number | null {
  const size = MATH_TOPICS_IN_CHAPTER[chapterOrder];
  if (!size || !Number.isFinite(topicOrder) || topicOrder < 1 || topicOrder > size) return null;
  let off = 0;
  for (let c = 1; c < chapterOrder; c++) off += MATH_TOPICS_IN_CHAPTER[c];
  return off + topicOrder;
}

/** Разделы, у которых в таблице слотов есть типы вида (соответствия и открытые бывают не везде) */
function sectionsWith(kind: string): string[] {
  return MATH_SECTIONS.map((x) => x.key).filter((k) => Object.keys(NCT_SLOT_TYPES_MATH[`${k}:${kind}`] ?? {}).length > 0);
}

export const MATH_CONFIG: NctConfig = {
  key: 'math',
  sections: MATH_SECTIONS,
  composition: { test: 18, matching: 2, open: 7, points: 40 },
  pointsPer: { test: 1, matching: 4, open: 2 },
  slotTypes: NCT_SLOT_TYPES_MATH,
  banned: new Set<string>(),
  // в билете 2024 г. 44 % заданий были в сборнике: 8 тестов + 1 соответствие + 3 открытых = 18 баллов
  quota: { test: 8, matching: 1, open: 3 },
  quotaPoints: 18,
  openDifficulty: [2, 3, 2],
  // главы 1–2 (числа, дроби, степень, корень) и §9 части 4 («Решение некоторых задач», текстовые задачи) — «Арифметика»; глава 3 (алгебраические выражения) и §1–8 главы 4 (уравнения и системы) — «Алгебра»;
  // главы 5–8 (НЦТ 2022/2024/2026) — «Функция», «Тригонометрия», «Анализ», «Геометрия»
  topicSection: (ch, tp) => {
    if (mathTopicNumber(ch, tp) === null) return null;
    return ch === 4 && tp === 9 ? 'arith' : MATH_CHAPTER_SECTION[ch];
  },
  // тип стоит ровно в одном разделе: размеченное задание идёт в раздел своего типа
  refineSection: (topicSection, nctType) => (topicSection && nctType && NCT_TYPE_SECTION_MATH[nctType]) || topicSection,
  // как в настоящих билетах, один тип встречается несколько раз (геометрия, производная); в «Анализе» всего два типа тестов
  kindSections: { matching: sectionsWith('matching'), open: sectionsWith('open') },
  maxTypeUse: 4,
  skipNote: 'из тем вне глав 1–8 банка математики',
};
