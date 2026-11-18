// Реестр предметов, для которых есть режим «Билет по формату НЦТ». Сейчас — только химия (движок: ./nct).
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
    sourcePattern: /ЦВЭ/i,
    collectionSharePct: 40,
    ready: true,
  },
];

/** Профиль по названию предмета; null — режима НЦТ для предмета нет */
export function examProfileFor(subjectName: string | null | undefined): ExamProfile | null {
  const n = (subjectName ?? '').toLowerCase();
  return EXAM_PROFILES.find((p) => p.ready && p.subjectMatch.some((m) => n.includes(m))) ?? null;
}
