// Режим «по формату НЦТ» для химии: 27 заданий (18 тестов, 2 соответствия, 7 открытых), 40 баллов.
// Раздел на номере билета постоянен (основные понятия → атом и ПЗ → растворы → …), баллы делятся
// между пройденными разделами как в таблице НЦТ. Тип задания внутри раздела не контролируется
// (в банке нет меток типов). Чистая логика; импорт без «.ts», поэтому пока только для сайта (для Deno-бота нужно «.ts»).
import { pickParallel, separateLinked, totalsOf, type ChapterTotals, type PickedTickets, type Rnd } from './ticketing';

export type NctSection = 'basic' | 'atom' | 'solutions' | 'elements' | 'organic';

export const NCT_SECTIONS: NctSection[] = ['basic', 'atom', 'solutions', 'elements', 'organic'];
export const NCT_SECTION_NAMES: Record<NctSection, string> = {
  basic: 'Основные понятия и законы',
  atom: 'Строение атома и ПЗ',
  solutions: 'Растворы',
  elements: 'Химия элементов',
  organic: 'Органика',
};
/** Доли разделов в экзамене НЦТ, % */
export const NCT_SHARES: Record<NctSection, number> = { basic: 20, atom: 12, solutions: 12, elements: 20, organic: 36 };

export const NCT_COMPOSITION = { test: 18, matching: 2, open: 7, points: 40 };

/** Темы центра в уровнях 1–3: число тем в главе (сквозная нумерация 1–49) */
const CHEM_LEVEL_SIZES = [21, 12, 16];

/**
 * Раздел НЦТ по теме центра (сквозной номер). Основные понятия — 1–33, 42, 43; атом и ПЗ — 34–41;
 * растворы — 44–49. Темы 50+ (уровни 4–6) ещё не распределены: null — в режиме НЦТ не берутся.
 */
export function sectionOfTopicNumber(n: number): NctSection | null {
  if (n >= 1 && n <= 33) return 'basic';
  if (n >= 34 && n <= 41) return 'atom';
  if (n === 42 || n === 43) return 'basic';
  if (n >= 44 && n <= 49) return 'solutions';
  return null;
}

/** Сквозной номер темы по порядку главы (уровня) и параграфа; null, если уровень за пределами 1–3 */
export function topicNumber(chapterOrder: number, topicOrder: number): number | null {
  if (!Number.isFinite(chapterOrder) || !Number.isFinite(topicOrder) || chapterOrder < 1 || chapterOrder > CHEM_LEVEL_SIZES.length) return null;
  if (topicOrder < 1 || topicOrder > CHEM_LEVEL_SIZES[chapterOrder - 1]) return null;
  let offset = 0;
  for (let i = 0; i < chapterOrder - 1; i++) offset += CHEM_LEVEL_SIZES[i];
  return offset + topicOrder;
}

export function sectionOfQuestion(q: any): NctSection | null {
  const n = topicNumber(q?.chapter?.order_index, q?.topic?.order_index);
  return n === null ? null : sectionOfTopicNumber(n);
}

/** Баллы по разделам: 40 × доля / сумма долей пройденных; целые, в сумме 40 (метод наибольших остатков) */
export function sectionPoints(present: NctSection[], total = NCT_COMPOSITION.points): Record<string, number> {
  const sum = present.reduce((s, k) => s + NCT_SHARES[k], 0);
  const raw = present.map((k) => ({ k, v: (total * NCT_SHARES[k]) / sum }));
  const out: Record<string, number> = {};
  let given = 0;
  for (const r of raw) { out[r.k] = Math.floor(r.v); given += out[r.k]; }
  [...raw].sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v))).slice(0, total - given).forEach((r) => { out[r.k]++; });
  return out;
}

export interface NctSlot { test: number; matching: number; open: number }
export type NctPlan = Record<string, NctSlot>;

/** Сколько вопросов каждого вида доступно в разделе (вопросов, не билетов) */
export type NctHave = Record<string, { test: number; matching: number; open: number }>;

/**
 * Раскладка 18 тестов + 2 соответствий (по 4 балла) + 7 открытых (по 2 балла) по разделам так,
 * чтобы баллы раздела отличались от нормы не больше чем на 1. Перебор; среди лучших — случайный.
 * Сначала ограничиваем число заданий тем, что хватит на все варианты без повторов, потом тем, что есть,
 * потом без ограничения.
 */
export function planNct(present: NctSection[], have: NctHave, ticketCount: number, rnd: Rnd = Math.random): NctPlan | null {
  const { test: TEST, matching: MATCH, open: OPEN } = NCT_COMPOSITION;
  if (present.length === 0) return null;
  const target = sectionPoints(present);
  const n = present.length;

  const run = (cap: (k: NctSection, type: 'test' | 'matching' | 'open') => number): NctPlan | null => {
    let best = Infinity;
    let bestPlans: NctPlan[] = [];
    // m — соответствия по разделам (всего MATCH), o — открытые (всего OPEN)
    const enumerate = (total: number, idx: number, limit: (i: number) => number, acc: number[], out: number[][]) => {
      if (idx === n - 1) {
        const left = total - acc.reduce((a, b) => a + b, 0);
        if (left >= 0 && left <= limit(idx)) out.push([...acc, left]);
        return;
      }
      const used = acc.reduce((a, b) => a + b, 0);
      for (let v = 0; v <= Math.min(limit(idx), total - used); v++) {
        acc.push(v);
        enumerate(total, idx + 1, limit, acc, out);
        acc.pop();
      }
    };
    const ms: number[][] = [];
    const os: number[][] = [];
    enumerate(MATCH, 0, (i) => cap(present[i], 'matching'), [], ms);
    enumerate(OPEN, 0, (i) => cap(present[i], 'open'), [], os);
    for (const m of ms) {
      for (const o of os) {
        const c = present.map((k, i) => target[k] - 4 * m[i] - 2 * o[i]);
        // c — «идеальные» тесты; корректируем в пределах ±1 балла так, чтобы сумма тестов была TEST
        const base = c.map((v) => Math.max(0, v));
        let diff = TEST - base.reduce((a, b) => a + b, 0);
        const tests = [...base];
        const order = tests.map((_, i) => i);
        let guard = 0;
        while (diff !== 0 && guard++ < 100) {
          const i = order[guard % n];
          if (diff > 0 && tests[i] < cap(present[i], 'test')) { tests[i]++; diff--; }
          else if (diff < 0 && tests[i] > 0) { tests[i]--; diff++; }
        }
        if (diff !== 0 || tests.some((v, i) => v > cap(present[i], 'test'))) continue;
        let dev = 0;
        let ok = true;
        present.forEach((k, i) => {
          const pts = tests[i] + 4 * m[i] + 2 * o[i];
          const d = Math.abs(pts - target[k]);
          if (d > 1) ok = false;
          dev += d;
        });
        if (!ok) continue;
        const plan: NctPlan = {};
        present.forEach((k, i) => { plan[k] = { test: tests[i], matching: m[i], open: o[i] }; });
        if (dev < best) { best = dev; bestPlans = [plan]; } else if (dev === best) bestPlans.push(plan);
      }
    }
    return bestPlans.length ? bestPlans[Math.floor(rnd() * bestPlans.length)] : null;
  };

  const T = Math.max(1, ticketCount);
  return (
    run((k, t) => Math.floor((have[k]?.[t] ?? 0) / T)) ??
    run((k, t) => have[k]?.[t] ?? 0) ??
    run(() => 1000)
  );
}

export interface NctPicked extends PickedTickets {
  plan: NctPlan;
  sections: NctSection[];
  notes: string[];
}

/**
 * Подбор билетов по формату НЦТ. Пул — «лёгкие» вопросы выбранных тем. Вопросы тем вне уровней 1–3
 * в режим не попадают. Задания каждого вида идут блоками разделов в порядке НЦТ.
 */
export function pickNct(pool: any[], ticketCount: number, rnd: Rnd = Math.random, totals?: ChapterTotals): NctPicked {
  const notes: string[] = [];
  const bySection = new Map<NctSection, any[]>();
  let skipped = 0;
  for (const q of pool) {
    const s = sectionOfQuestion(q);
    if (!s) { skipped++; continue; }
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s)!.push(q);
  }
  if (skipped > 0) notes.push(`${skipped} вопросов из тем, не распределённых по разделам НЦТ (уровни 4 и выше), в билеты не взяты`);

  const have: NctHave = {};
  for (const [k, list] of bySection) {
    have[k] = {
      test: list.filter((q) => q.type === 'test').length,
      matching: list.filter((q) => q.type === 'matching').length,
      open: list.filter((q) => q.type === 'open').length,
    };
  }
  // Раздел считается пройденным, если в нём есть тесты (без них нет ни одного номера 1–18)
  const present = NCT_SECTIONS.filter((k) => (have[k]?.test ?? 0) > 0);
  const plan = present.length ? planNct(present, have, ticketCount, rnd) : null;

  const T = ticketCount;
  const empty = () => Array.from({ length: T }, () => [] as any[]);
  const tests = empty(), matching = empty(), open = empty();
  if (!plan) return { kinds: [tests, matching, open], ticketCount: T, plan: {}, sections: present, notes: [...notes, 'В выбранных темах нет тестов из разделов НЦТ'] };

  const fill = (dst: any[][], type: 'test' | 'matching' | 'open', key: 'test' | 'matching' | 'open') => {
    for (const k of NCT_SECTIONS) {
      const want = plan[k]?.[key] ?? 0;
      if (!want) continue;
      const part = pickParallel((bySection.get(k) ?? []).filter((q) => q.type === type), want, T, rnd, totalsOf(totals, type));
      if (part[0] && part[0].length < want) notes.push(`${NCT_SECTION_NAMES[k]}: заданий вида «${type}» ${part[0].length} из ${want} — не хватило вопросов`);
      for (let t = 0; t < T; t++) dst[t].push(...part[t]);
    }
  };
  fill(tests, 'test', 'test');
  fill(matching, 'matching', 'matching');
  fill(open, 'open', 'open');
  separateLinked([tests, matching, open], pool, rnd);
  return { kinds: [tests, matching, open], ticketCount: T, plan, sections: present, notes };
}

/** Короткое описание плана для интерфейса: «Основные понятия 18 б. (6+1+4) · …» */
export function describePlan(plan: NctPlan): string {
  return NCT_SECTIONS.filter((k) => plan[k]).map((k) => {
    const p = plan[k];
    const pts = p.test + 4 * p.matching + 2 * p.open;
    return `${NCT_SECTION_NAMES[k]} — ${pts} б. (${p.test} тест. + ${p.matching} соотв. + ${p.open} откр.)`;
  }).join('; ');
}
