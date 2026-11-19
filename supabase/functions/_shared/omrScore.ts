// Проверка бланков: состав билета ↔ вид бланка, разбор введённого ключа и подсчёт баллов.
// Модуль без импортов: сайт подключает его напрямую, Edge Function tg-app — тоже.
// Баллы: тест — 1; соответствие — по 1 за каждый пункт A–D; открытый вопрос — 2.

export interface Composition { test: number; matching: number; open: number }

/** Какие раскладки бланков подходят составу билета. У химии и физики раскладка одна, коды бланков разные. */
export const BLANKS: Array<{ layouts: string[]; comp: Composition; label: string }> = [
  { layouts: ['chem', 'phys'], comp: { test: 18, matching: 2, open: 7 }, label: 'Химия / Физика / Математика (27 заданий)' },
  { layouts: ['bio', 'taj'], comp: { test: 20, matching: 4, open: 2 }, label: 'Биология / Таджикский язык / История / Право / Английский язык (26 заданий)' },
  { layouts: ['chemphys'], comp: { test: 8, matching: 2, open: 2 }, label: 'Химия / Физика (12 заданий)' },
];

export const POINTS = { test: 1, matchingRow: 1, open: 2 } as const;
export const MATCHING_ROWS = 4;

export const sameComposition = (a: Composition, b: Composition) => a.test === b.test && a.matching === b.matching && a.open === b.open;

export function blankFor(comp: Composition) {
  return BLANKS.find((b) => sameComposition(b.comp, comp)) ?? null;
}

export function maxPoints(c: Composition): number {
  return c.test * POINTS.test + c.matching * MATCHING_ROWS * POINTS.matchingRow + c.open * POINTS.open;
}

/** Ключ одного варианта: тест — буква A–D, соответствие — цифра 1–5 по каждому из пунктов A–D, открытый — целое число */
export interface TicketKey {
  tests: Array<string | null>;
  matching: Array<Array<string | null>>;
  open: Array<string | null>;
}

/** Ответы ученика после просмотра: пусто и «несколько отметок» — null */
export interface Answers {
  tests: Array<string | null>;
  matching: Array<Array<string | null>>;
  open: string[];
}

export interface Score {
  score: number;
  max: number;
  tests: boolean[];
  matching: boolean[][];
  open: boolean[];
}

const normOpen = (s: string | null | undefined) => (s ?? '').trim().replace(/^0+(?=\d)/, '');

export function scoreAnswers(key: TicketKey, ans: Answers): Score {
  const tests = key.tests.map((k, i) => k !== null && ans.tests[i] === k);
  const matching = key.matching.map((row, q) => row.map((k, r) => k !== null && ans.matching[q]?.[r] === k));
  const open = key.open.map((k, i) => k !== null && normOpen(k) !== '' && normOpen(ans.open[i]) === normOpen(k));
  const score = tests.filter(Boolean).length * POINTS.test
    + matching.flat().filter(Boolean).length * POINTS.matchingRow
    + open.filter(Boolean).length * POINTS.open;
  const comp = { test: key.tests.length, matching: key.matching.length, open: key.open.length };
  return { score, max: maxPoints(comp), tests, matching, open };
}

// ---------- ключ, введённый вручную ----------
type Parsed<T> = { value: T } | { error: string };

export function parseTestsKey(text: string, n: number): Parsed<string[]> {
  const s = text.toUpperCase().replace(/[\s,.;]+/g, '').replace(/[АВСЕ]/g, (c) => ({ А: 'A', В: 'B', С: 'C', Е: 'E' } as Record<string, string>)[c]);
  if (!/^[A-D]*$/.test(s)) return { error: 'В ключе тестов допустимы только буквы A, B, C, D' };
  if (s.length !== n) return { error: `Ключ тестов: нужно ${n} букв, введено ${s.length}` };
  return { value: s.split('') };
}

/** «3124 2541»: по четыре цифры 1–5 на задание (ответы для пунктов A, B, C, D) */
export function parseMatchingKey(text: string, n: number): Parsed<string[][]> {
  const groups = text.split(/[\s,;]+/).filter(Boolean);
  if (groups.length !== n) return { error: `Ключ соответствий: нужно ${n} групп по ${MATCHING_ROWS} цифры, введено ${groups.length}` };
  const out: string[][] = [];
  for (const g of groups) {
    if (!new RegExp(`^[1-5]{${MATCHING_ROWS}}$`).test(g)) return { error: `Группа «${g}»: нужно ${MATCHING_ROWS} цифры от 1 до 5` };
    out.push(g.split(''));
  }
  return { value: out };
}

/** «12 5 700»: целые числа через пробел, не длиннее пяти цифр (пять клеток — у бланков таджикского и английского) */
export function parseOpenKey(text: string, n: number): Parsed<string[]> {
  const items = text.split(/[\s,;]+/).filter(Boolean);
  if (items.length !== n) return { error: `Ключ открытых: нужно ${n} чисел, введено ${items.length}` };
  for (const it of items) if (!/^\d{1,5}$/.test(it)) return { error: `Ответ «${it}»: нужно целое число до пяти цифр` };
  return { value: items.map((x) => normOpen(x)) };
}

export function parseKey(text: { tests: string; matching: string; open: string }, comp: Composition): Parsed<TicketKey> {
  const t = parseTestsKey(text.tests, comp.test);
  if ('error' in t) return t;
  const m = comp.matching ? parseMatchingKey(text.matching, comp.matching) : { value: [] as string[][] };
  if ('error' in m) return m;
  const o = comp.open ? parseOpenKey(text.open, comp.open) : { value: [] as string[] };
  if ('error' in o) return o;
  return { value: { tests: t.value, matching: m.value, open: o.value } };
}

/** Обратное: ключ → три строки для показа и правки */
export function keyToText(key: TicketKey): { tests: string; matching: string; open: string } {
  return {
    tests: key.tests.map((x) => x ?? '?').join(''),
    matching: key.matching.map((r) => r.map((x) => x ?? '?').join('')).join(' '),
    open: key.open.map((x) => x ?? '?').join(' '),
  };
}
