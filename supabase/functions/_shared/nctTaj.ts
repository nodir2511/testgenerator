// Режим «по формату НЦТ» для таджикского языка: 26 заданий (20 тестов №1–20, 4 соответствия №21–24, 2 открытых №25–26), 40 баллов:
// тест 1 б., соответствие 4 б., открытое 2 б. Предмет одноязычный. Восемь разделов — блоки билета по реальным билетам 2024–2026 (анализ НЦТ, 42 варианта):
// фонетика, графика, имло — тесты №1–3; лексика — №4–5; фразеология — №6–7; стилистика — №8; морфология — тесты №9–14, соответствие №21,
// открытое №25 (морфологический разбор); ибора (словосочетание) — тест №15, соответствие №22; синтаксис — тесты №16–19, соответствие №23,
// открытое №26 (порядок предложений в тексте); литература — тест №20 и соответствие №24 (смысл бейтов).
// Доли — по баллам такого билета: 3 / 2 / 2 / 1 / 12 / 5 / 10 / 5 из 40 (8 / 5 / 5 / 3 / 30 / 12 / 25 / 12 %; методом наибольших остатков
// из этих долей получаются именно такие баллы).
// В банке нет заданий по литературе (№20, №24): раздел «литература» необязательный (optionalSections) — без него его баллы и места
// переходят к остальным разделам в пределах kindRange. Сборника НЦТ в банке нет (источники — «Сборник таджикского языка (Часть N)»): квота 0.
// Открытые задания банка: «выбрать несколько из девяти» (в билет НЦТ не ставятся), морфологический разбор (№25), порядок предложений (№26).
// Только типы; импорт без «.ts» не нужен.
import type { NctConfig } from './nct';
import { NCT_SLOT_TYPES_TAJ, NCT_TYPE_SECTION_TAJ } from './nctSlotsTaj';

export const TAJ_SECTIONS: Array<{ key: string; name: string; share: number }> = [
  { key: 'phon', name: 'Фонетика, графика, имло', share: 8 },
  { key: 'lex', name: 'Лексика', share: 5 },
  { key: 'phr', name: 'Фразеология', share: 5 },
  { key: 'style', name: 'Стилистика', share: 3 },
  { key: 'morph', name: 'Морфология', share: 30 },
  { key: 'ibora', name: 'Ибора (словосочетание)', share: 12 },
  { key: 'synt', name: 'Синтаксис', share: 25 },
  { key: 'lit', name: 'Литература', share: 12 },
];

type TajSection = 'phon' | 'lex' | 'phr' | 'style' | 'morph' | 'ibora' | 'synt' | 'lit';

/**
 * Карта «глава банка → темы → раздел». Главы банка таджикского:
 *  1 (8 тем): 1 — введение (не берётся), 2–4 (алифбо, фонетика, имло) — фонетика, 5–8 (лексика, происхождение слов, значение слова, слова по звучанию и смыслу) — лексика;
 *  2 (11 тем): 1 — введение в грамматику (не берётся), 2–11 (словообразование, части речи, имя, прилагательное, глагол) — морфология;
 *  3 (14 тем): числительное, местоимение, наречие, предлоги, союзы, частицы, междометие — морфология;
 *  4 (10 тем): 1 — синтаксис, 2 (ибора и иборасозӣ) — ибора, 3–10 (предложение, члены предложения) — синтаксис;
 *  5 (12 тем): 1 — имло буквы «ӣ» (фонетика), 2 — лексикография (лексика), 3 — фразеология, 4–12 — стилистика;
 *  6 (10 тем): имло частей речи — фонетика, графика, имло.
 * Главы 7+ и темы вне этих границ в режим не берутся.
 */
const TAJ_CHAPTERS: Record<number, Array<[number, number, TajSection | null]>> = {
  1: [[1, 1, null], [2, 4, 'phon'], [5, 8, 'lex']],
  2: [[1, 1, null], [2, 11, 'morph']],
  3: [[1, 14, 'morph']],
  4: [[1, 1, 'synt'], [2, 2, 'ibora'], [3, 10, 'synt']],
  5: [[1, 1, 'phon'], [2, 2, 'lex'], [3, 3, 'phr'], [4, 12, 'style']],
  6: [[1, 10, 'phon']],
};

export function tajTopicSection(chapterOrder: number, topicOrder: number): TajSection | null {
  const ranges = TAJ_CHAPTERS[chapterOrder];
  if (!ranges || !Number.isInteger(topicOrder) || topicOrder < 1) return null;
  const r = ranges.find(([from, to]) => topicOrder >= from && topicOrder <= to);
  return r ? r[2] : null;
}

/** Типы, которые в НЦТ стоят в нескольких разделах: раздел задания определяет тема, а не метка (в анализе таких нет, множество оставлено для единообразия) */
const MULTI_SECTION = new Set<string>();
{
  const secs = new Map<string, Set<string>>();
  for (const [key, list] of Object.entries(NCT_SLOT_TYPES_TAJ)) {
    for (const c of Object.keys(list)) { if (!secs.has(c)) secs.set(c, new Set()); secs.get(c)!.add(key.split(':')[0]); }
  }
  for (const [c, s] of secs) if (s.size > 1) MULTI_SECTION.add(c);
}

/** Сборника НЦТ в банке нет — квоты нет */
export const TAJ_QUOTA: { test: number; matching: number; open: number } = { test: 0, matching: 0, open: 0 };
export const TAJ_QUOTA_POINTS = 0;

export const TAJ_CONFIG: NctConfig = {
  key: 'taj',
  sections: TAJ_SECTIONS,
  composition: { test: 20, matching: 4, open: 2, points: 40 },
  pointsPer: { test: 1, matching: 4, open: 2 },
  slotTypes: NCT_SLOT_TYPES_TAJ,
  banned: new Set<string>(),
  quota: TAJ_QUOTA,
  quotaPoints: TAJ_QUOTA_POINTS,
  openDifficulty: [0, 2, 0],
  topicSection: (ch, tp) => tajTopicSection(ch, tp),
  // размеченное задание идёт в раздел своего типа (морфологический разбор из любой главы — в морфологию)
  refineSection: (topicSection, nctType) => (topicSection && nctType && !MULTI_SECTION.has(nctType) && NCT_TYPE_SECTION_TAJ[nctType]) || topicSection,
  // соответствия — морфология (№21), ибора (№22), синтаксис (№23), литература (№24); открытые — морфология (№25) и синтаксис (№26)
  kindSections: { matching: ['morph', 'ibora', 'synt', 'lit'], open: ['morph', 'synt'] },
  // раскладка билета: тесты 3 / 2 / 2 / 1 / 6 / 1 / 4 / 1, соответствия 0 / 0 / 0 / 0 / 1 / 1 / 1 / 1, открытые 0 / 0 / 0 / 0 / 1 / 0 / 1 / 0;
  // пределы шире на единицу там, где место литературы переходит к другим разделам (в банке литературы нет)
  kindRange: {
    phon: { test: [3, 3], matching: [0, 0], open: [0, 0] },
    lex: { test: [2, 2], matching: [0, 0], open: [0, 0] },
    phr: { test: [2, 2], matching: [0, 0], open: [0, 0] },
    style: { test: [1, 1], matching: [0, 0], open: [0, 0] },
    morph: { test: [6, 7], matching: [1, 2], open: [1, 1] },
    ibora: { test: [1, 2], matching: [1, 2], open: [0, 0] },
    synt: { test: [4, 5], matching: [1, 2], open: [1, 1] },
    lit: { test: [1, 1], matching: [1, 1], open: [0, 0] },
  },
  optionalSections: ['lit'],
  uiNote: 'Задания идут блоками разделов, как в НЦТ: фонетика и имло → лексика → фразеология → стилистика → морфология → ибора → синтаксис (литература — когда в банке появятся задания по ней); соответствия — по морфологии, ибора и синтаксису, открытые — морфологический разбор и порядок предложений. Тип задания берётся по меткам, если они есть. Берутся главы 1–6; введения глав 1 и 2 не берутся.',
  skipNote: 'из тем вне глав 1–6 банка таджикского языка и вводных тем',
};

export { NCT_TYPE_SECTION_TAJ };
