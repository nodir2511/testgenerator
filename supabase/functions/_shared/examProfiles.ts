// Реестр предметов, для которых есть режим «Билет по формату НЦТ». Химия, право, история, математика, английский, биология, физика и таджикский язык (движок: ./nct, настройки предмета — ./nctConfigs).
// Чтобы подключить предмет, нужны данные из docs/NCT_SUBJECTS.md; пока их нет, предмета в реестре нет,
// и режим для него не показывается. Файл без импортов — годится и для сайта, и для Deno.

export interface ExamProfile {
  /** ключ профиля (латиницей) */
  key: string;
  /** фрагменты названия предмета (в нижнем регистре), по которым профиль выбирается */
  subjectMatch: string[];
  /** состав билета и максимум баллов */
  composition: { test: number; matching: number; open: number; points: number };
  /** баллы за задание каждого вида */
  pointsPer: { test: number; matching: number; open: number };
  /** разделы экзамена и их доли, % (в порядке номеров билета) */
  sections: Array<{ key: string; name: string; share: number }>;
  /** регулярное выражение по названию источника: вопросы такого источника — сборник НЦТ */
  sourcePattern: RegExp;
  /** доля баллов из сборника НЦТ, % */
  collectionSharePct: number;
  /** режим работает (движок подключён) */
  ready: boolean;
}

export const EXAM_PROFILES: ExamProfile[] = [
  {
    key: 'chemistry',
    subjectMatch: ['хим'],
    composition: { test: 18, matching: 2, open: 7, points: 40 },
    pointsPer: { test: 1, matching: 4, open: 2 },
    sections: [
      { key: 'basic', name: 'Основные понятия и законы', share: 20 },
      { key: 'atom', name: 'Строение атома и ПЗ', share: 12 },
      { key: 'solutions', name: 'Растворы', share: 12 },
      { key: 'elements', name: 'Химия элементов', share: 20 },
      { key: 'organic', name: 'Органика', share: 36 },
    ],
    sourcePattern: /ЦВЭ|НЦТ/i,
    collectionSharePct: 40,
    ready: true,
  },
  {
    key: 'law',
    subjectMatch: ['прав', 'ҳуқуқ'],
    composition: { test: 20, matching: 4, open: 2, points: 40 },
    pointsPer: { test: 1, matching: 4, open: 2 },
    sections: [
      { key: 'state', name: 'Государство и право. Отрасли права Таджикистана', share: 22 },
      { key: 'rights', name: 'Защита прав и свобод человека и гражданина в Таджикистане. Обязанности граждан', share: 40 },
      { key: 'intl', name: 'Международные нормы и средства защиты прав человека', share: 38 },
    ],
    sourcePattern: /ЦВЭ|НЦТ/i,
    collectionSharePct: 30,
    ready: true,
  },
  {
    key: 'history',
    subjectMatch: ['истор', 'таърих'],
    composition: { test: 20, matching: 4, open: 2, points: 40 },
    pointsPer: { test: 1, matching: 4, open: 2 },
    sections: [
      { key: 'p1', name: 'История таджикского народа (до конца XV века)', share: 27 },
      { key: 'p2', name: 'История таджикского народа (с конца XV века)', share: 21 },
      { key: 'p3', name: 'История таджикского народа (с 1920 года)', share: 27 },
      { key: 'world', name: 'Всеобщая история (с 1918 года до начала XXI века)', share: 25 },
    ],
    sourcePattern: /ЦВЭ|НЦТ/i,
    collectionSharePct: 10,
    ready: true,
  },
  {
    key: 'math',
    subjectMatch: ['матем', 'риёз'],
    composition: { test: 18, matching: 2, open: 7, points: 40 },
    pointsPer: { test: 1, matching: 4, open: 2 },
    sections: [
      { key: 'arith', name: 'Арифметика', share: 18 },
      { key: 'alg', name: 'Алгебра', share: 21 },
      { key: 'func', name: 'Функция', share: 13 },
      { key: 'trig', name: 'Тригонометрия', share: 13 },
      { key: 'anal', name: 'Анализ', share: 17 },
      { key: 'geo', name: 'Геометрия', share: 18 },
    ],
    sourcePattern: /ЦВЭ|НЦТ/i,
    collectionSharePct: 44,
    ready: true,
  },
  {
    key: 'english',
    subjectMatch: ['англи', 'english'],
    composition: { test: 20, matching: 4, open: 2, points: 40 },
    pointsPer: { test: 1, matching: 4, open: 2 },
    // блоки билета 2026: № 1–8 чтение, № 9–16 грамматика в тексте, № 17–26 грамматика и лексика (доли — по баллам билета)
    sections: [
      { key: 'read', name: 'Чтение: текст и вопросы к нему', share: 20 },
      { key: 'text', name: 'Грамматика в тексте: пропуски', share: 20 },
      { key: 'gl', name: 'Грамматика и лексика: тесты, соответствия, порядок', share: 60 },
    ],
    sourcePattern: /ЦВЭ|НЦТ/i,
    collectionSharePct: 0,
    ready: true,
  },
  {
    key: 'biology',
    subjectMatch: ['биол'],
    composition: { test: 20, matching: 4, open: 2, points: 40 },
    pointsPer: { test: 1, matching: 4, open: 2 },
    // блоки билета 2024–2026: тесты №1–5 / 6–10 / 11–14 / 15–19 / 20, соответствия №21–24, открытые №25–26 (доли — по баллам такого билета)
    sections: [
      { key: 'gen', name: 'Общая биология', share: 33 },
      { key: 'bot', name: 'Ботаника (растения, грибы, лишайники, бактерии, вирусы)', share: 22 },
      { key: 'zoo', name: 'Зоология', share: 20 },
      { key: 'anat', name: 'Анатомия человека', share: 12 },
      { key: 'eco', name: 'Экология', share: 13 },
    ],
    sourcePattern: /ЦВЭ|НЦТ/i,
    collectionSharePct: 0,
    ready: true,
  },
  {
    key: 'physics',
    subjectMatch: ['физ'],
    composition: { test: 18, matching: 2, open: 7, points: 40 },
    pointsPer: { test: 1, matching: 4, open: 2 },
    // блоки билета 2022–2026: тесты №1–8 / 9 / 10–15 / 16 / 17–18, соответствия №19–20, открытые №21–27 (доли — по баллам такого билета: 14 / 5 / 12 / 3 / 6 из 40)
    sections: [
      { key: 'mech', name: 'Механика', share: 35 },
      { key: 'mol', name: 'Молекулярная физика и термодинамика', share: 13 },
      { key: 'elec', name: 'Электродинамика', share: 30 },
      { key: 'opt', name: 'Оптика', share: 7 },
      { key: 'atom', name: 'Физика атома и атомного ядра', share: 15 },
    ],
    // сборник — «ЦВЭ 2026 (Физика)» и экзамены «НЦТ 2022…2026 (Физика)»; учебные «Сборник НЦТ (Часть N)» не в счёт
    sourcePattern: /ЦВЭ|НЦТ 20\d\d/i,
    collectionSharePct: 40,
    ready: true,
  },
  {
    key: 'taj',
    subjectMatch: ['таджик', 'тоҷик'],
    composition: { test: 20, matching: 4, open: 2, points: 40 },
    pointsPer: { test: 1, matching: 4, open: 2 },
    // блоки билета 2024–2026: тесты №1–3 / 4–5 / 6–7 / 8 / 9–14 / 15 / 16–19 / 20, соответствия №21–24, открытые №25–26 (доли — по баллам такого билета: 3 / 2 / 2 / 1 / 12 / 5 / 10 / 5 из 40)
    sections: [
      { key: 'phon', name: 'Фонетика, графика, имло', share: 8 },
      { key: 'lex', name: 'Лексика', share: 5 },
      { key: 'phr', name: 'Фразеология', share: 5 },
      { key: 'style', name: 'Стилистика', share: 3 },
      { key: 'morph', name: 'Морфология', share: 30 },
      { key: 'ibora', name: 'Ибора (словосочетание)', share: 12 },
      { key: 'synt', name: 'Синтаксис', share: 25 },
      { key: 'lit', name: 'Литература', share: 12 },
    ],
    // сборника НЦТ в банке нет (источники — «Сборник таджикского языка (Часть N)»)
    sourcePattern: /ЦВЭ|НЦТ 20\d\d/i,
    collectionSharePct: 0,
    ready: true,
  },
];

/** Профиль по названию предмета; null — режима НЦТ для предмета нет */
export function examProfileFor(subjectName: string | null | undefined): ExamProfile | null {
  const n = (subjectName ?? '').toLowerCase();
  return EXAM_PROFILES.find((p) => p.ready && p.subjectMatch.some((m) => n.includes(m))) ?? null;
}
