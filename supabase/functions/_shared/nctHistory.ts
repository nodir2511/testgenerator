// Режим «по формату НЦТ» для истории: 26 заданий (20 тестов №1–20, 4 соответствия №21–24, 2 открытых №25–26), 40 баллов:
// тест 1 б., соответствие 4 б. (по 1 за пункт), открытое 2 б. Четыре официальных раздела НЦТ (порядок блоков в билете):
// история таджикского народа до конца XV века (27 %), с конца XV века (21 %), с 1920 года (27 %) и всеобщая история
// с 1918 года до начала XXI века (25 %). Периоды таджикской истории в реальных билетах перемешаны по номерам, поэтому разделы 1–3
// различаются темой (периодом содержания), а один код типа может стоять в нескольких разделах. В банке нет отдельных глав всеобщей
// истории: вопрос раздела 4 определяет метка типа с префиксом W_ (см. nctSlotsHistory.ts), любая тема.
// Только типы; импорт без «.ts» не нужен.
import type { NctConfig } from './nct';
import { NCT_SLOT_TYPES_HISTORY, NCT_TYPE_SECTION_HISTORY } from './nctSlotsHistory';

export const HISTORY_SECTIONS: Array<{ key: string; name: string; share: number }> = [
  { key: 'p1', name: 'История таджикского народа (до конца XV века)', share: 27 },
  { key: 'p2', name: 'История таджикского народа (с конца XV века)', share: 21 },
  { key: 'p3', name: 'История таджикского народа (с 1920 года)', share: 27 },
  { key: 'world', name: 'Всеобщая история (с 1918 года до начала XXI века)', share: 25 },
];

/** Раздел таджикской темы по периоду: гл. 1–2 и темы 3.1–3.3 (XIV–XV вв., Тимур и Тимуриды) — до конца XV в.; остальное гл. 3 (до 1920 г.) — с конца XV в.; гл. 4–5 — с 1920 г. */
export function historyTopicPeriod(chapterOrder: number, topicOrder: number): 'p1' | 'p2' | 'p3' | null {
  if (historyTopicNumber(chapterOrder, topicOrder) === null) return null;
  if (chapterOrder <= 2) return 'p1';
  if (chapterOrder === 3) return topicOrder <= 3 ? 'p1' : 'p2';
  return 'p3';
}

/**
 * Главы банка истории = книги 1–5 центра. Сквозной номер темы программы (158 тем): книга 1 — 1–13 (§14 — итоговый урок, в банке нет),
 * книга 2 — 15–33, книга 3 — 34–51, книга 4 — 52–65, книга 5 — 66–79. Обобщающие §15 книг 4 и 5 в программу центра не внесены.
 */
const HISTORY_BASE: Record<number, number> = { 1: 0, 2: 14, 3: 33, 4: 51, 5: 65 };
const HISTORY_TOPICS_IN_CHAPTER: Record<number, number> = { 1: 13, 2: 19, 3: 18, 4: 14, 5: 14 };

/** Сквозной номер темы центра по порядку главы и темы; null — вне режима (главы 6+ и обобщающие уроки глав 4–5) */
export function historyTopicNumber(chapterOrder: number, topicOrder: number): number | null {
  const size = HISTORY_TOPICS_IN_CHAPTER[chapterOrder];
  if (!size || !Number.isFinite(topicOrder) || topicOrder < 1 || topicOrder > size) return null;
  return HISTORY_BASE[chapterOrder] + topicOrder;
}

export const HISTORY_CONFIG: NctConfig = {
  key: 'history',
  sections: HISTORY_SECTIONS,
  composition: { test: 20, matching: 4, open: 2, points: 40 },
  pointsPer: { test: 1, matching: 4, open: 2 },
  slotTypes: NCT_SLOT_TYPES_HISTORY,
  banned: new Set<string>(),
  // из сборника ЦВЭ 2026 («Образец экзамена ЦВЭ 2026 (История, компонент А)») есть только открытые: 2 × 2 = 4 балла (10 %)
  quota: { test: 0, matching: 0, open: 2 },
  quotaPoints: 4,
  openDifficulty: [1, 1, 0],
  // раздел темы — по периоду; вопрос с меткой W_… — всеобщая история при любой теме; остальные метки раздел не меняют
  topicSection: (ch, tp) => historyTopicPeriod(ch, tp),
  refineSection: (topicSection, nctType) => (topicSection && nctType && NCT_TYPE_SECTION_HISTORY[nctType] === 'world' ? 'world' : topicSection),
  // открытые — на таджикской истории; во всеобщей только «определите термины/события периода» (W_SELECT; в CSV 3 открытых из 22). Не больше одного в разделе
  kindSections: { open: ['p1', 'p2', 'p3', 'world'] },
  maxPerSection: { open: 1 },
  // в реальных билетах всеобщая история — тесты №16–20 и соответствие №24; таджикские разделы получают по ≥3 теста (иначе раскладка по баллам оставляла раздел без тестов)
  kindRange: {
    p1: { test: [3, 7], matching: [0, 2] },
    p2: { test: [3, 7], matching: [0, 2] },
    p3: { test: [3, 7], matching: [0, 2] },
    world: { test: [5, 5], matching: [1, 1], open: [0, 1] },
  },
  // в настоящих билетах тип повторяется (личность — 3–6 раз): разрешаем до двух раз
  maxTypeUse: 2,
  skipNote: 'из тем вне глав 1–5 банка истории (и обобщающих уроков глав 4–5)',
};
