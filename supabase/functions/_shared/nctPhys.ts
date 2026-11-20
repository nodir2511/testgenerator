// Режим «по формату НЦТ» для физики: 27 заданий (18 тестов №1–18, 2 соответствия №19–20, 7 открытых №21–27), 40 баллов:
// тест 1 б., соответствие 4 б., открытое 2 б. Структура билета одинакова во всех 45 вариантах 2022–2026 (анализ НЦТ), поэтому
// раздел жёстко привязан к номеру: механика — тесты №1–8, соответствие №19, открытое №21; молекулярная физика и термодинамика — тест №9,
// открытые №22–23; электродинамика — тесты №10–15, соответствие №20, открытое №24; оптика — тест №16, открытое №25;
// физика атома и атомного ядра — тесты №17–18, открытые №26–27.
// Доли разделов — по баллам такого билета: механика 8+4+2=14, МКТ 1+4=5, электродинамика 6+4+2=12, оптика 1+2=3, атом 2+4=6 из 40
// (35 / 13 / 30 / 7 / 15 %; методом наибольших остатков из этих долей получаются именно 14 / 5 / 12 / 3 / 6 баллов).
// Только типы; импорт без «.ts» не нужен.
import type { NctConfig } from './nct';
import { NCT_SLOT_TYPES_PHYS, NCT_TYPE_SECTION_PHYS } from './nctSlotsPhys';

export const PHYS_SECTIONS: Array<{ key: string; name: string; share: number }> = [
  { key: 'mech', name: 'Механика', share: 35 },
  { key: 'mol', name: 'Молекулярная физика и термодинамика', share: 13 },
  { key: 'elec', name: 'Электродинамика', share: 30 },
  { key: 'opt', name: 'Оптика', share: 7 },
  { key: 'atom', name: 'Физика атома и атомного ядра', share: 15 },
];

type PhysSection = 'mech' | 'mol' | 'elec' | 'opt' | 'atom';

/**
 * Карта «глава банка → темы → раздел». Главы банка физики = уровни курса 1–10, темы главы идут по программе центра
 * (88 тем, сквозная нумерация: ур.1 — 1–8, ур.2 — 9–17, ур.3 — 18–26, ур.4 — 27–34, ур.5 — 35–41, ур.6 — 42–50, ур.7 — 51–58,
 * ур.8 — 59–68, ур.9 — 69–78, ур.10 — 79–88). Записи: [с темы, по тему, раздел]; номер темы — порядок в главе банка.
 *  ур.1 (введение, приборы, СИ, формулы), ур.2, ур.3 — механика;
 *  ур.4: 27–31 (макро/микро, концентрация, идеальный газ, ДВС, влажность) — МКТ, 32–34 (заряд, сила тока, сопротивление) — электродинамика;
 *  ур.5: 35–37 (отражение/преломление, фокус и увеличение линзы) — оптика, 38–41 (фотон, фотоэффект, состав атома, дефект массы) — атом;
 *  ур.6, ур.7 — механика; ур.8 — МКТ; ур.9 — электродинамика;
 *  ур.10: 79–81 — механика, 82–84 (переменный ток, ЭМ колебания, ЭМ волны) — электродинамика, 85–86 (свет и приборы, дифракция) — оптика, 87–88 — атом.
 * Главы 5–10 в банке появятся после импорта сборников; карта для них уже задана по программе.
 */
const PHYS_CHAPTERS: Record<number, Array<[number, number, PhysSection]>> = {
  1: [[1, 8, 'mech']],
  2: [[1, 9, 'mech']],
  // Глава 3 в банке — 8 тем, в программе (ур.3, темы 18–26) их 9: тема банка «Сила упругости и соединение пружин» объединяет программные 18–19.
  // Порядок тем — по банку (темы 1..8, см. PHYS_BANK_CH3); весь уровень — механика.
  3: [[1, 8, 'mech']],
  4: [[1, 5, 'mol'], [6, 8, 'elec']],
  5: [[1, 3, 'opt'], [4, 7, 'atom']],
  6: [[1, 9, 'mech']],
  7: [[1, 8, 'mech']],
  8: [[1, 10, 'mol']],
  9: [[1, 10, 'elec']],
  10: [[1, 3, 'mech'], [4, 6, 'elec'], [7, 8, 'opt'], [9, 10, 'atom']],
};

/** Темы главы 3 банка (8 штук) → раздел; программные темы 18–26 (9 штук) целиком относятся к механике, объединение 18–19 на раздел не влияет */
export const PHYS_BANK_CH3: PhysSection[] = ['mech', 'mech', 'mech', 'mech', 'mech', 'mech', 'mech', 'mech'];

export function physTopicSection(chapterOrder: number, topicOrder: number): PhysSection | null {
  const ranges = PHYS_CHAPTERS[chapterOrder];
  if (!ranges || !Number.isInteger(topicOrder) || topicOrder < 1) return null;
  if (chapterOrder === 3) return PHYS_BANK_CH3[topicOrder - 1] ?? null;
  const r = ranges.find(([from, to]) => topicOrder >= from && topicOrder <= to);
  return r ? r[2] : null;
}

/** Типы, которые в НЦТ стоят в нескольких разделах (MATCH_F, MATCH_U, WAVE, RADIO, LIGHT_QUAL): раздел задания определяет тема, а не метка */
const MULTI_SECTION = new Set<string>();
{
  const secs = new Map<string, Set<string>>();
  for (const [key, list] of Object.entries(NCT_SLOT_TYPES_PHYS)) {
    for (const c of Object.keys(list)) { if (!secs.has(c)) secs.set(c, new Set()); secs.get(c)!.add(key.split(':')[0]); }
  }
  for (const [c, s] of secs) if (s.size > 1) MULTI_SECTION.add(c);
}

/**
 * Квота заданий из сборника НЦТ: как у химии, test 8 + matching 1 + open 2 = 16 баллов (40 %). Сборник — источники «ЦВЭ 2026 (Физика)»
 * и «НЦТ 2022…2026 (Физика)» (экзамены); учебные «Сборник НЦТ (Часть N)» в квоту не входят (см. sourcePattern профиля 'physics').
 * Квота делится по разделам пропорционально числу заданий сборника в разделе (не больше, чем их там есть).
 */
export const PHYS_QUOTA: { test: number; matching: number; open: number } = { test: 8, matching: 1, open: 2 };
export const PHYS_QUOTA_POINTS = 16;

export const PHYS_CONFIG: NctConfig = {
  key: 'physics',
  sections: PHYS_SECTIONS,
  composition: { test: 18, matching: 2, open: 7, points: 40 },
  pointsPer: { test: 1, matching: 4, open: 2 },
  slotTypes: NCT_SLOT_TYPES_PHYS,
  banned: new Set<string>(),
  quota: PHYS_QUOTA,
  quotaPoints: PHYS_QUOTA_POINTS,
  openDifficulty: [2, 3, 2],
  topicSection: (ch, tp) => physTopicSection(ch, tp),
  // размеченное задание идёт в раздел своего типа; тип, стоящий в нескольких разделах, раздел не меняет
  refineSection: (topicSection, nctType) => (topicSection && nctType && !MULTI_SECTION.has(nctType) && NCT_TYPE_SECTION_PHYS[nctType]) || topicSection,
  // соответствия — только механика (№19) и электродинамика (№20)
  kindSections: { matching: ['mech', 'elec'] },
  // жёсткая раскладка билета: тесты 8 / 1 / 6 / 1 / 2, соответствия 1 / 0 / 1 / 0 / 0, открытые 1 / 2 / 1 / 1 / 2
  kindRange: {
    mech: { test: [8, 8], matching: [1, 1], open: [1, 1] },
    mol: { test: [1, 1], matching: [0, 0], open: [2, 2] },
    elec: { test: [6, 6], matching: [1, 1], open: [1, 1] },
    opt: { test: [1, 1], matching: [0, 0], open: [1, 1] },
    atom: { test: [2, 2], matching: [0, 0], open: [2, 2] },
  },
  // одни и те же коды стоят и на тестах, и на открытых (ISO, OHM, EL_SERPAR …), в билете до двух раз
  maxTypeUse: 2,
  uiNote: 'Тип задания берётся по меткам (в билете тип встречается не более двух раз); в билете №1–8 механика, №9 молекулярная физика, №10–15 электродинамика, №16 оптика, №17–18 физика атома; соответствия — механика и электродинамика, открытые — по разделам (механика 1, молекулярная физика 2, электродинамика 1, оптика 1, атом 2). Берутся главы 1–10 банка (пока есть главы 1–4); квоты сборника НЦТ пока нет.',
  skipNote: 'из тем вне глав 1–10 банка физики',
};

export { NCT_TYPE_SECTION_PHYS };
