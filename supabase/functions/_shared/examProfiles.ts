// Реестр предметов, для которых есть режим «Билет по формату НЦТ». Химия, право, история и математика (движок: ./nct, настройки предмета — ./nctConfigs).
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
];

/** Профиль по названию предмета; null — режима НЦТ для предмета нет */
export function examProfileFor(subjectName: string | null | undefined): ExamProfile | null {
  const n = (subjectName ?? '').toLowerCase();
  return EXAM_PROFILES.find((p) => p.ready && p.subjectMatch.some((m) => n.includes(m))) ?? null;
}
