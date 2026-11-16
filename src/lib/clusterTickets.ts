// Книжка экзамена-кластера из готовых билетов: по одному билету на предмет — из архива наборов
// или из пары файлов Word (RU + TJ). Здесь только логика без браузера и базы: снимки вопросов,
// ответы, их правка вручную и проверка состава. Экран — components/ClusterFromTickets.tsx.
import type { PairedQuestion } from './docxPair';
import { testAnswer, matchingAnswer, openAnswer } from './answerKey';

export type Snap = Record<string, any>;

const TYPE_ORDER: Record<string, number> = { test: 0, matching: 1, open: 2 };
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
// Ответ теста: кириллические двойники латинских букв (А, В, С, Е — как в сборниках)
const TWIN: Record<string, string> = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E' };
// Строка соответствия: латинские A–D или русские А, Б, В, Г (здесь «В» — третья строка)
const ROW: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, 'А': 0, 'Б': 1, 'В': 2, 'Г': 3 };

/** Вопросы в порядке книжки: тесты, соответствия, открытые; внутри вида — как в билете */
export function orderByType(snaps: Snap[]): Snap[] {
  return snaps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (TYPE_ORDER[a.s.type] ?? 9) - (TYPE_ORDER[b.s.type] ?? 9) || a.i - b.i)
    .map(({ s }) => s);
}

/** Число из ответа открытого вопроса: «12», «-3,5», «1/4»; не число — null */
export function parseNumber(raw?: string | null): number | null {
  const t = (raw ?? '').trim().replace(/[−–—]/g, '-').replace(/\s+/g, '');
  if (!t) return null;
  const frac = t.match(/^(-?\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/);
  const num = (x: string) => Number(x.replace(',', '.'));
  if (frac) return num(frac[2]) ? num(frac[1]) / num(frac[2]) : null;
  return /^-?\d+(?:[.,]\d+)?$/.test(t) ? num(t) : null;
}

/** Ключ соответствия: «1352», «1-3-5-2», «А-1, Б-3, В-5, Г-2» → номера правых элементов по строкам A–D */
export function parseMatchKey(raw: string | null | undefined, rows = 4): Array<number | null> {
  const t = (raw ?? '').trim();
  const out: Array<number | null> = Array.from({ length: rows }, () => null);
  if (!t) return out;
  const pairs = [...t.matchAll(/([A-DАБВГ])\s*[-–—:=)]?\s*(\d)/gi)];
  if (pairs.length) {
    for (const [, l, d] of pairs) {
      const i = ROW[l.toUpperCase()] ?? -1;
      if (i >= 0 && i < rows) out[i] = Number(d);
    }
    return out;
  }
  const digits = t.replace(/\D/g, '');
  for (let i = 0; i < Math.min(rows, digits.length); i++) out[i] = Number(digits[i]) || null;
  return out;
}

/** Снимок вопроса (формат ticket_questions.question_snapshot) из пары RU+TJ, разобранной из Word */
export function snapshotFromPaired(p: PairedQuestion, key: string): Snap {
  const base: Snap = {
    id: null,
    type: p.type,
    content: p.content || p.contentTg,
    content_ru: p.content || p.contentTg,
    content_tg: p.contentTg || p.content,
    image_url: p.imageUrl ?? null,
    correct_numeric_answer: null,
    from_file: true,
  };
  if (p.type === 'test') {
    const a = (p.correctAnswer || '').trim().toUpperCase().charAt(0);
    const letter = TWIN[a] ?? a;
    base.options = (p.options || []).map((o, i) => ({
      id: `${key}-o${i + 1}`,
      text: o.text,
      text_ru: o.text || o.textTg,
      text_tg: o.textTg || o.text,
      image_url: o.imageUrl ?? null,
      is_correct: LETTERS[i] === letter,
      order_index: i + 1,
    }));
  } else if (p.type === 'matching') {
    const items = p.matchingItems || [];
    const left = items.filter((m) => m.side === 'left').sort((a, b) => a.orderIndex - b.orderIndex);
    const right = items.filter((m) => m.side === 'right').sort((a, b) => a.orderIndex - b.orderIndex);
    const rightSnaps = right.map((m, i) => ({
      id: `${key}-r${i + 1}`, side: 'right', text: m.text, text_ru: m.text || m.textTg, text_tg: m.textTg || m.text,
      image_url: m.imageUrl ?? null, correct_match_id: null, order_index: i + 1,
    }));
    const keyDigits = parseMatchKey(p.correctAnswer, left.length);
    const leftSnaps = left.map((m, i) => ({
      id: `${key}-l${i + 1}`, side: 'left', text: m.text, text_ru: m.text || m.textTg, text_tg: m.textTg || m.text,
      image_url: m.imageUrl ?? null,
      correct_match_id: keyDigits[i] ? rightSnaps[keyDigits[i]! - 1]?.id ?? null : null,
      order_index: i + 1,
    }));
    base.matching_items = [...leftSnaps, ...rightSnaps];
  } else {
    base.correct_numeric_answer = parseNumber(p.correctAnswer);
  }
  return base;
}

/** Ответ задания текстом для таблицы: «B», «1352» (пропуск — «·»), «12,5»; нет ответа — '' */
export function answerText(s: Snap): string {
  if (s.type === 'test') return testAnswer(s) ?? '';
  if (s.type === 'matching') {
    const a = matchingAnswer(s);
    return a.every((x) => x === null) ? '' : a.map((x) => x ?? '·').join('');
  }
  return openAnswer(s) ?? '';
}

/** Ответ задания указан полностью */
export function hasAnswer(s: Snap): boolean {
  if (s.empty) return false;
  if (s.type === 'test') return testAnswer(s) !== null;
  if (s.type === 'matching') {
    const a = matchingAnswer(s);
    return a.length > 0 && a.every((x) => x !== null);
  }
  return openAnswer(s) !== null;
}

/** Снимок с ответом, введённым вручную. Неверный ввод — ответ стирается (клетка остаётся красной) */
export function withAnswer(s: Snap, raw: string): Snap {
  const v = raw.trim();
  if (s.type === 'test') {
    const a = v.toUpperCase().charAt(0);
    const letter = TWIN[a] ?? a;
    const opts = [...(s.options || [])].sort((x: any, y: any) => (x.order_index || 0) - (y.order_index || 0));
    const idx = LETTERS.indexOf(letter);
    return { ...s, options: opts.map((o: any, i: number) => ({ ...o, is_correct: idx >= 0 && i === idx })) };
  }
  if (s.type === 'matching') {
    const items = s.matching_items || [];
    const byOrder = (a: any, b: any) => (a.order_index || 0) - (b.order_index || 0);
    const left = items.filter((m: any) => m.side === 'left').sort(byOrder);
    const right = items.filter((m: any) => m.side === 'right').sort(byOrder);
    const digits = parseMatchKey(v, left.length);
    const target = new Map(left.map((m: any, i: number) => [m.id, digits[i] ? right[digits[i]! - 1]?.id ?? null : null]));
    return { ...s, matching_items: items.map((m: any) => (m.side === 'left' ? { ...m, correct_match_id: target.get(m.id) ?? null } : m)) };
  }
  return { ...s, correct_numeric_answer: parseNumber(v) };
}

export interface SlotCheck {
  counts: { test: number; matching: number; open: number };
  /** Ответов не хватает у заданий (номера в книжке) */
  missing: number[];
  /** Состав отличается от стандарта книжки — это не ошибка, книжка всё равно собирается */
  notes: string[];
}

/** Проверка билета предмета: состав и ответы */
export function checkSlot(snaps: Snap[], want: { test: number; matching: number; open: number }): SlotCheck {
  const counts = { test: 0, matching: 0, open: 0 };
  for (const s of snaps) if (s.type in counts) counts[s.type as keyof typeof counts]++;
  const missing = snaps.map((s, i) => (hasAnswer(s) ? 0 : i + 1)).filter(Boolean);
  const names = { test: 'тестов', matching: 'соответствий', open: 'открытых' } as const;
  const notes = (Object.keys(counts) as Array<keyof typeof counts>)
    .filter((k) => counts[k] !== want[k])
    .map((k) => `${names[k]} ${counts[k]} вместо ${want[k]}`);
  return { counts, missing, notes };
}

/** Короткий текст задания для таблицы ответов */
export function shortText(s: Snap, max = 90): string {
  const t = String(s.content_ru || s.content || s.content_tg || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return s.image_url ? '[рисунок]' : '—';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
