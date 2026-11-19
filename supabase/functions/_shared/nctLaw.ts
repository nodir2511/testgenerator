// Режим «по формату НЦТ» для права: 26 заданий (20 тестов №1–20, 4 соответствия №21–24, 2 открытых №25–26), 40 баллов:
// тест 1 б., соответствие 4 б. (по 1 за пункт), открытое 2 б. Разделы и доли — официальная таблица центра
// (22 ± 2 / 40 ± 2 / 38 ± 2 %); глава 4 банка отнесена к разделу 3 (международные нормы).
// Типы по разделам подобраны так, чтобы билет 2026 года сошёлся с таблицей: теория и отрасли права → 1 (23 %),
// конституционное право + VOTE/MEDIA/FOREIGN → 2 (39 %), остальные права человека → 3 (38 %); тип стоит ровно в одном разделе. Только типы; импорт без «.ts» не нужен.
import type { NctConfig } from './nct';
import { NCT_SLOT_TYPES_LAW, NCT_TYPE_SECTION_LAW } from './nctSlotsLaw';

export const LAW_SECTIONS: Array<{ key: string; name: string; share: number }> = [
  { key: 'state', name: 'Государство и право. Отрасли права Таджикистана', share: 22 },
  { key: 'rights', name: 'Защита прав и свобод человека и гражданина в Таджикистане. Обязанности граждан', share: 40 },
  { key: 'intl', name: 'Международные нормы и средства защиты прав человека', share: 38 },
];

/** Темы банка права: главы 1–10 = части 1–10 тематического плана центра (темы 1–93); главы 11+ в режим не берутся */
const LAW_CHAPTER_SECTION: Record<number, string> = { 1: 'state', 2: 'rights', 3: 'state', 4: 'intl', 5: 'rights', 6: 'rights', 7: 'intl', 8: 'intl', 9: 'intl', 10: 'intl' };
const LAW_TOPICS_IN_CHAPTER: Record<number, number> = { 1: 14, 2: 11, 3: 11, 4: 8, 5: 8, 6: 8, 7: 8, 8: 8, 9: 9, 10: 8 };

/** Сквозной номер темы центра (1–93) по порядку главы и темы; null — вне режима */
export function lawTopicNumber(chapterOrder: number, topicOrder: number): number | null {
  const size = LAW_TOPICS_IN_CHAPTER[chapterOrder];
  if (!size || !Number.isFinite(topicOrder) || topicOrder < 1 || topicOrder > size) return null;
  let off = 0;
  for (let c = 1; c < chapterOrder; c++) off += LAW_TOPICS_IN_CHAPTER[c];
  return off + topicOrder;
}

export const LAW_CONFIG: NctConfig = {
  key: 'law',
  sections: LAW_SECTIONS,
  composition: { test: 20, matching: 4, open: 2, points: 40 },
  pointsPer: { test: 1, matching: 4, open: 2 },
  slotTypes: NCT_SLOT_TYPES_LAW,
  banned: new Set<string>(),
  // сборник ЦВЭ 2026: 8 тестов + 1 соответствие = 12 баллов (30 %); открытых в сборнике нет
  quota: { test: 8, matching: 1, open: 0 },
  quotaPoints: 12,
  openDifficulty: [1, 1, 0],
  topicSection: (ch, tp) => (lawTopicNumber(ch, tp) === null ? null : LAW_CHAPTER_SECTION[ch]),
  // тип стоит ровно в одном разделе: размеченное задание идёт в раздел своего типа, где бы ни лежало
  refineSection: (topicSection, nctType) => (topicSection && nctType && NCT_TYPE_SECTION_LAW[nctType]) || topicSection,
  // открытые бывают только на теории права (признаки) и конституционном праве (полномочия)
  kindSections: { open: ['state', 'rights'] },
  maxPerSection: { open: 1 },
  // типов у раздела мало (особенно у соответствий): больше заданий вида, чем типов, в билет не ставим
  maxByTypes: Object.fromEntries(Object.entries(NCT_SLOT_TYPES_LAW).map(([k, v]) => [k, Object.keys(v).length])),
  skipNote: 'из тем вне глав 1–10 банка права',
};
