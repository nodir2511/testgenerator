// Режим «по формату НЦТ» для английского языка: 26 заданий (20 тестов, 4 соответствия, 2 открытых), 40 баллов:
// тест 1 б., соответствие 4 б. (по 1 за пункт), открытое 2 б. (порядок слов / предложений, ответ — четыре цифры).
// Билет 2026 по номерам: № 1–8 — текст для чтения и 8 вопросов к нему; № 9–16 — текст с 8 пропусками; № 17–20 — отдельные
// тесты по грамматике и лексике; № 21–24 — соответствия 4 × 5; № 25–26 — порядок. Поэтому разделы здесь не «темы банка»
// (темы английского — юниты учебника и в раздел экзамена не складываются), а блоки билета: текст для чтения (8 б.),
// грамматика в тексте (8 б.), грамматика и лексика (24 б.: 4 теста, 4 соответствия, 2 открытых). Официальная таблица центра:
// Хониш 25 ± 2 % / грамматика и лексика 75 ± 2 %; знания 38 ± 2 % / умения 62 ± 2 % — для проверки состава заданий по меткам типов
// (скрипт разметки scratch/english/nct/classify.mjs), на сам подбор она не влияет. Доли разделов ниже — доли баллов билета 2026.
// Тексты берутся целиком (по 8 вопросов, passage_order 1–8) движком `pickNct` (ветка `textSections`, см. nct.ts).
import type { NctConfig } from './nct';
import { NCT_SLOT_TYPES_ENGLISH, NCT_TYPE_SECTION_ENGLISH } from './nctSlotsEnglish';

export const ENGLISH_SECTIONS: Array<{ key: string; name: string; share: number }> = [
  { key: 'read', name: 'Чтение: текст и вопросы к нему', share: 20 },
  { key: 'text', name: 'Грамматика в тексте: пропуски', share: 20 },
  { key: 'gl', name: 'Грамматика и лексика: тесты, соответствия, порядок', share: 60 },
];

export const ENGLISH_CONFIG: NctConfig = {
  key: 'english',
  sections: ENGLISH_SECTIONS,
  composition: { test: 20, matching: 4, open: 2, points: 40 },
  pointsPer: { test: 1, matching: 4, open: 2 },
  slotTypes: NCT_SLOT_TYPES_ENGLISH,
  banned: new Set<string>(),
  // сборника НЦТ в банке английского нет: все задания — из сборников English File
  quota: { test: 0, matching: 0, open: 0 },
  quotaPoints: 0,
  openDifficulty: [1, 1, 0],
  // юниты трёх уровней (главы 1–3 банка) в разделы экзамена не делятся: отдельные задания — раздел «грамматика и лексика»
  topicSection: (ch) => (Number.isFinite(ch) && ch >= 1 && ch <= 3 ? 'gl' : null),
  refineSection: (topicSection) => topicSection,
  // у соответствий и порядка по 2–6 типов: тип в билете не повторяем сверх числа типов
  maxByTypes: Object.fromEntries(Object.entries(NCT_SLOT_TYPES_ENGLISH).filter(([k]) => k.startsWith('gl:') && k !== 'gl:test').map(([k, v]) => [k, Object.keys(v).length])),
  textSections: { reading: 'read', cloze: 'text', rest: 'gl' },
  skipNote: 'из глав вне уровней Beginner, Elementary, Pre-Intermediate',
};

export { NCT_TYPE_SECTION_ENGLISH };
