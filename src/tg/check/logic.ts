// Чистая логика раздела «Проверка работ» мини-приложения (без React и браузера) — проверяется тестами.
import { MATCHING_ROWS, type Answers, type Composition, type Score, type TicketKey } from '../../../supabase/functions/_shared/omrScore';
import { doubts, qualityWarnings, type Doubt } from '../../lib/omr/answers';
import type { OmrResult } from '../../lib/omr/types';

export type Ok = Extract<OmrResult, { ok: true }>;

export const LETTERS = ['A', 'B', 'C', 'D'];
export const DIGITS = ['1', '2', '3', '4', '5'];
export const VARIANTS = ['1', '2', '3', '4'];

// ---------- слова и числа ----------
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  return b >= 2 && b <= 4 ? few : many;
}
export const count = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`;

export const percent = (score: number, max: number) => (max > 0 ? Math.round((score / max) * 100) : 0);
export type Tone = 'good' | 'mid' | 'low';
/** Цвет результата — по тем же порогам, что оценка в ведомости Excel: 70 % и выше, 50 % и выше, ниже */
export function tone(score: number, max: number): Tone {
  const p = percent(score, max);
  return p >= 70 ? 'good' : p >= 50 ? 'mid' : 'low';
}

export const compText = (c: Composition) => [
  count(c.test, 'тест', 'теста', 'тестов'),
  c.matching ? count(c.matching, 'соответствие', 'соответствия', 'соответствий') : '',
  c.open ? count(c.open, 'открытый', 'открытых', 'открытых') : '',
].filter(Boolean).join(', ');

// ---------- ответы ----------
/** Номера заданий на бланке: тесты, за ними соответствия, за ними открытые */
export function questionNumbers(c: Composition) {
  const seq = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
  return { tests: seq(1, c.test), matching: seq(c.test + 1, c.matching), open: seq(c.test + c.matching + 1, c.open) };
}

export function emptyAnswers(c: Composition): Answers {
  return {
    tests: Array.from({ length: c.test }, () => null),
    matching: Array.from({ length: c.matching }, () => Array.from({ length: MATCHING_ROWS }, () => null)),
    open: Array.from({ length: c.open }, () => ''),
  };
}

export function answersOfKey(k: TicketKey): Answers {
  return { tests: [...k.tests], matching: k.matching.map((r) => [...r]), open: k.open.map((x) => x ?? '') };
}

/** Сколько мест в ключе ещё не заполнено */
export function missingCount(a: Answers): number {
  return a.tests.filter((x) => x === null).length + a.matching.flat().filter((x) => x === null).length + a.open.filter((x) => x.trim() === '').length;
}

export const setTest = (a: Answers, i: number, v: string | null): Answers => ({ ...a, tests: a.tests.map((x, j) => (j === i ? v : x)) });
export const setMatch = (a: Answers, i: number, r: number, v: string | null): Answers => ({ ...a, matching: a.matching.map((row, j) => (j === i ? row.map((x, k) => (k === r ? v : x)) : row)) });
export const setOpen = (a: Answers, i: number, v: string, max: number): Answers => ({ ...a, open: a.open.map((x, j) => (j === i ? v.replace(/\D/g, '').slice(0, max) : x)) });

/** Ошибочные задания номерами бланка: «3, 19B, 22» */
export function wrongList(s: Pick<Score, 'tests' | 'matching' | 'open'>): string[] {
  const n = questionNumbers({ test: s.tests.length, matching: s.matching.length, open: s.open.length });
  return [
    ...s.tests.flatMap((ok, i) => (ok ? [] : [String(n.tests[i])])),
    ...s.matching.flatMap((row, i) => row.flatMap((ok, r) => (ok ? [] : [`${n.matching[i]}${LETTERS[r]}`]))),
    ...s.open.flatMap((ok, i) => (ok ? [] : [String(n.open[i])])),
  ];
}

// ---------- сомнения ----------
export type CellId = string;
export const testId = (i: number): CellId => `t${i}`;
export const matchId = (i: number, r: number): CellId => `m${i}.${r}`;

export interface DoubtRow { id: CellId; kind: 'test' | 'matching'; index: number; row: number; why: Doubt['why']; label: string }

export const WHY: Record<Doubt['why'], string> = {
  multi: 'отмечено несколько',
  unsure: 'бледная отметка',
  empty: 'не отмечено',
  digit: 'цифры',
};

/** Сомнительные ответы в порядке бланка. withEmpty — считать ли пустые (в ключе пустых быть не должно, у ученика пустой ответ — обычное дело) */
export function doubtRows(res: Ok, withEmpty: boolean): DoubtRow[] {
  const out: DoubtRow[] = [];
  for (const d of doubts(res)) {
    if (d.kind !== 'test' && d.kind !== 'matching') continue;
    if (d.why === 'empty' && !withEmpty) continue;
    if (d.kind === 'test') {
      const index = res.tests.findIndex((t) => t.q === d.q);
      out.push({ id: testId(index), kind: 'test', index, row: 0, why: d.why, label: `${d.q}` });
    } else {
      const index = res.matching.findIndex((m) => m.q === d.q);
      const row = res.matching[index].rows.findIndex((r) => r.row === d.row);
      out.push({ id: matchId(index, row), kind: 'matching', index, row, why: d.why, label: `${d.q}${LETTERS[row]}` });
    }
  }
  return out;
}

// ---------- стопка снимков ----------
export interface QItem<T = unknown> { id: number; name: string; res?: Ok; error?: string; debug?: string; sheet?: T }
export type QStatus = 'ok' | 'warn' | 'error';

export function queueStatus(i: Pick<QItem, 'res' | 'error'>): QStatus {
  if (!i.res) return 'error';
  return qualityWarnings(i.res).length ? 'warn' : 'ok';
}

/** Что сказать о снимке в стопке одной строкой */
export function queueNote(i: Pick<QItem, 'res' | 'error'>): string {
  if (!i.res) return i.error || 'Не прочитан';
  const v = typeof i.res.variant.answer === 'number' ? `Вариант ${i.res.variant.answer}` : 'Вариант не отмечен';
  if (qualityWarnings(i.res).length) return `${v}, снимок читается ненадёжно`;
  const n = doubtRows(i.res, false).length;
  return n ? `${v}, проверить ${count(n, 'ответ', 'ответа', 'ответов')}` : `${v}, всё читается`;
}

/** Следующий прочитанный снимок после текущего (по кругу); null — больше нет */
export function nextReady<T>(queue: Array<QItem<T>>, afterId: number): QItem<T> | null {
  const at = queue.findIndex((i) => i.id === afterId);
  const order = at < 0 ? queue : [...queue.slice(at + 1), ...queue.slice(0, at)];
  return order.find((i) => i.res) ?? null;
}

/** Имя в стопке: у снимков с телефона имя файла ничего не говорит, поэтому просто «Бланк N» */
export const queueName = (n: number) => `Бланк ${n}`;

// ---------- результаты ----------
export interface SavedCheck { id: string; created_at: string; student: string; ticket_number: number | null; score: number; max_score: number }

export function filterChecks<T extends SavedCheck>(rows: T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) => `${r.student || 'без имени'} ${r.ticket_number ? `вариант ${r.ticket_number}` : ''} ${new Date(r.created_at).toLocaleDateString('ru-RU')}`.toLowerCase().includes(s));
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function dayLabel(d: Date, now: Date): string {
  if (dayKey(d) === dayKey(now)) return 'Сегодня';
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return 'Вчера';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

/** Список результатов по дням, порядок строк сохраняется */
export function groupByDay<T extends SavedCheck>(rows: T[], now: Date): Array<{ key: string; label: string; rows: T[] }> {
  const out: Array<{ key: string; label: string; rows: T[] }> = [];
  for (const r of rows) {
    const d = new Date(r.created_at), key = dayKey(d);
    const g = out.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else out.push({ key, label: dayLabel(d, now), rows: [r] });
  }
  return out;
}

/** Подробности сохранённой проверки из базы. Старые или чужие по форме записи — null: показываем только балл */
export function parseDetails(d: unknown): { answers: Answers; key: TicketKey } | null {
  const x = d as { answers?: Answers; key?: TicketKey } | null;
  const a = x?.answers, k = x?.key;
  if (!a || !k) return null;
  const arr = (v: unknown): v is unknown[] => Array.isArray(v);
  if (![a.tests, a.matching, a.open, k.tests, k.matching, k.open].every(arr)) return null;
  if (a.tests.length !== k.tests.length || a.matching.length !== k.matching.length || a.open.length !== k.open.length) return null;
  if (![...a.matching, ...k.matching].every((r) => arr(r) && r.length === MATCHING_ROWS)) return null;
  return { answers: a, key: k };
}

// ---------- с чего продолжить ----------
export interface LastSource { kind: 'set' | 'custom'; id: string; title: string }
export function parseLastSource(raw: string | null): LastSource | null {
  try {
    const v = JSON.parse(raw || 'null');
    if (v && (v.kind === 'set' || v.kind === 'custom') && typeof v.id === 'string' && typeof v.title === 'string' && v.id) return { kind: v.kind, id: v.id, title: v.title };
  } catch { /* испорченная запись */ }
  return null;
}
