// Режим «по формату НЦТ» для химии: 27 заданий (18 тестов, 2 соответствия, 7 открытых), 40 баллов.
// Раздел на номере билета постоянен (основные понятия → атом и ПЗ → растворы → …), баллы делятся
// между пройденными разделами как в таблице НЦТ. Тип задания внутри раздела не контролируется
// (в банке нет меток типов). Чистая логика; импорт без «.ts», поэтому пока только для сайта (для Deno-бота нужно «.ts»).
import { pickParallel, separateLinked, type ChapterTotals, type PickedTickets, type Rnd } from './ticketing';
import { NCT_SLOT_TYPES } from './nctSlots';

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

type Kind = 'test' | 'matching' | 'open';

/** Типы, которые в 1-м круге не даём (правила 1-го круга): «с чем реагирует», получение, электролиз, термохимия, избыток, выход, смеси с реакциями, многостадийные расчёты и цепочки */
export const NCT_BANNED = new Set([
  'REACT_WITH', 'OBTAIN', 'ELECTROLYSIS', 'THERMO', 'EXCESS', 'EXCESS_SALT', 'EXCESS_PIC', 'YIELD', 'ORG_YIELD',
  'MIX_ACID', 'MIX_SALT', 'MIX_METAL', 'EL_MULTISTEP', 'CHAIN', 'STOICH2', 'DISPLACE', 'EL_DECOMP_PCT', 'EL_IDENT_CALC', 'GASMIX_REACT',
]);

/** Сколько заданий каждого вида берём из сборника НЦТ (источник «ЦВЭ …»): 8 + 4 + 2×2 = 16 баллов из 40, то есть 40 % */
export const NCT_QUOTA: Record<Kind, number> = { test: 8, matching: 1, open: 2 };
export const NCT_QUOTA_POINTS = 16;

/** Типы по частоте на номерах раздела; «основные понятия» берут и типы химии элементов (степень окисления, ОВР — темы 42–43) */
export function typeWeights(section: NctSection, kind: Kind): Record<string, number> {
  const keys = section === 'basic' ? ['basic', 'elements'] : [section];
  let w: Record<string, number> = {};
  for (const k of keys) for (const [c, n] of Object.entries(NCT_SLOT_TYPES[`${k}:${kind}`] ?? {})) w[c] = (w[c] ?? 0) + n;
  if (Object.keys(w).length === 0) {
    // у раздела нет своего типа на этом виде (например, соответствие по растворам): типы всех разделов, кроме органики
    for (const key of Object.keys(NCT_SLOT_TYPES)) {
      if (!key.endsWith(`:${kind}`) || key.startsWith('organic')) continue;
      for (const [c, n] of Object.entries(NCT_SLOT_TYPES[key])) w[c] = (w[c] ?? 0) + n;
    }
  }
  return Object.fromEntries(Object.entries(w).filter(([c]) => !NCT_BANNED.has(c)));
}

/** Делит quota по разделам пропорционально числу заданий (метод наибольших остатков), не больше cap и want раздела */
function splitQuota(quota: number, counts: Array<{ k: NctSection; want: number; cap: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  const total = counts.reduce((a, c) => a + c.want, 0);
  if (total === 0 || quota <= 0) return out;
  const raw = counts.map((c) => ({ ...c, v: Math.min(c.cap, c.want, (quota * c.want) / total) }));
  let given = 0;
  for (const r of raw) { out[r.k] = Math.floor(r.v); given += out[r.k]; }
  for (const r of [...raw].sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)))) {
    if (given >= quota) break;
    if (out[r.k] < r.cap && out[r.k] < r.want) { out[r.k]++; given++; }
  }
  return out;
}

/**
 * Подбор билетов по формату НЦТ. Пул — «лёгкие» вопросы выбранных тем (у вопроса могут быть поля
 * nct_type — метка типа — и isNct — вопрос из сборника НЦТ). Вопросы тем вне уровней 1–3 в режим не попадают.
 * Задания каждого вида идут блоками разделов в порядке НЦТ. На каждое место выбирается тип по частоте
 * на номерах раздела и подбираются вопросы с этой меткой (во всех вариантах — один тип, как клоны); один тип
 * в билете не повторяется. Часть мест (NCT_QUOTA) берётся из сборника НЦТ. Нет вопросов с нужной меткой —
 * берутся неразмеченные вопросы раздела.
 */
export function pickNct(pool: any[], ticketCount: number, rnd: Rnd = Math.random, _totals?: ChapterTotals): NctPicked {
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

  const usedIds = new Set<string>();
  const usedTypes = new Set<string>();
  const nctPicked: Record<Kind, number> = { test: 0, matching: 0, open: 0 };
  const typePicked: Record<Kind, number> = { test: 0, matching: 0, open: 0 };

  const attempt = (pool: any[], section: NctSection, kind: Kind): { rows: any[]; code: string | null } | null => {
    const w = typeWeights(section, kind);
    const cands = Object.keys(w).filter((c) => !usedTypes.has(c) && pool.filter((q) => q.nct_type === c).length >= T);
    if (cands.length) {
      let r = rnd() * cands.reduce((a, c) => a + w[c], 0);
      let code = cands[cands.length - 1];
      for (const c of cands) { r -= w[c]; if (r < 0) { code = c; break; } }
      const col = pickParallel(pool.filter((q) => q.nct_type === code), 1, T, rnd);
      if (col.every((t) => t.length === 1)) return { rows: col.map((t) => t[0]), code };
    }
    // нет подходящей метки: неразмеченные вопросы и вопросы ещё не использованных разрешённых типов
    const loose = pool.filter((q) => !q.nct_type || (!NCT_BANNED.has(q.nct_type) && !usedTypes.has(q.nct_type)));
    const col = pickParallel(loose, 1, T, rnd);
    if (col.every((t) => t.length === 1)) {
      const code = col[0][0].nct_type ?? null;
      return { rows: col.map((t) => t[0]), code: code && col.every((t) => t[0].nct_type === code) ? code : null };
    }
    return null;
  };

  const pickOne = (list: any[], section: NctSection, kind: Kind, wantNct: boolean): any[] | null => {
    const free = list.filter((q) => q.type === kind && !usedIds.has(q.id));
    const nctFree = free.filter((q) => q.isNct);
    const own = free.filter((q) => !q.isNct);
    for (const pool of wantNct ? [nctFree, own] : [own, nctFree]) {
      const got = attempt(pool, section, kind);
      if (!got) continue;
      got.rows.forEach((q) => usedIds.add(q.id));
      if (got.code) typePicked[kind]++;
      for (const q of got.rows) if (q.nct_type) usedTypes.add(q.nct_type);
      if (got.rows[0].isNct) nctPicked[kind]++;
      return got.rows;
    }
    return null;
  };

  const fill = (dst: any[][], kind: Kind) => {
    const counts = NCT_SECTIONS
      .map((k) => ({ k, want: plan[k]?.[kind] ?? 0, cap: (bySection.get(k) ?? []).filter((q) => q.isNct && q.type === kind).length }))
      .filter((c) => c.want > 0);
    const quota = splitQuota(NCT_QUOTA[kind], counts);
    for (const { k, want } of counts) {
      // места раздела, на которых берём задание из сборника НЦТ: случайные
      const flags = Array.from({ length: want }, (_, i) => i < (quota[k] ?? 0));
      for (let i = flags.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [flags[i], flags[j]] = [flags[j], flags[i]]; }
      let got = 0;
      for (let i = 0; i < want; i++) {
        const rows = pickOne(bySection.get(k) ?? [], k, kind, flags[i]);
        if (!rows) continue;
        got++;
        for (let t = 0; t < T; t++) dst[t].push(rows[t]);
      }
      if (got < want) notes.push(`${NCT_SECTION_NAMES[k]}: заданий вида «${kind}» ${got} из ${want} — не хватило вопросов`);
    }
  };
  fill(tests, 'test');
  fill(matching, 'matching');
  fill(open, 'open');
  separateLinked([tests, matching, open], pool, rnd);

  const nctPoints = nctPicked.test + 4 * nctPicked.matching + 2 * nctPicked.open;
  if (nctPoints < NCT_QUOTA_POINTS) notes.push(`Из сборника НЦТ набрано ${nctPoints} баллов из ${NCT_QUOTA_POINTS} (в выбранных темах мало таких вопросов)`);
  const total = tests[0].length + matching[0].length + open[0].length;
  if (total > 0 && typePicked.test + typePicked.matching + typePicked.open < total / 2) notes.push('Меток типа НЦТ у вопросов этих тем мало: типы заданий выдерживаются лишь частично');
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
