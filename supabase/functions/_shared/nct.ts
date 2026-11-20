// Режим «по формату НЦТ» для химии: 27 заданий (18 тестов, 2 соответствия, 7 открытых), 40 баллов.
// Раздел на номере билета постоянен (основные понятия → атом и ПЗ → растворы → …), баллы делятся
// между пройденными разделами как в таблице НЦТ. Тип задания внутри раздела не контролируется
// (в банке нет меток типов). Чистая логика; импорт без «.ts», поэтому пока только для сайта (для Deno-бота нужно «.ts»).
import { pickParallel, separateLinked, passageBlocks, pickBlocks, PASSAGE_SIZE, type ChapterTotals, type PickedTickets, type Rnd } from './ticketing';
import { NCT_SLOT_TYPES } from './nctSlots';
import { CHEM_RELATED } from './nctRelated';

/** Ключ раздела экзамена: у химии 'basic' | 'atom' | 'solutions' | 'elements' | 'organic', у права 'state' | 'rights' | 'intl' */
export type NctSection = string;
type Kind = 'test' | 'matching' | 'open';

/**
 * Настройки режима НЦТ предмета. Движок (planNct, pickNct …) читает всё предметное отсюда;
 * по умолчанию везде химия (CHEM_CONFIG), поэтому её поведение не зависит от других предметов.
 */
export interface NctConfig {
  key: string;
  /** разделы по порядку блоков в билете; share — доля баллов, % */
  sections: Array<{ key: string; name: string; share: number }>;
  composition: { test: number; matching: number; open: number; points: number };
  pointsPer: { test: number; matching: number; open: number };
  /** типы по частоте: 'раздел:вид' → код → число сессий */
  slotTypes: Record<string, Record<string, number>>;
  /** типы, которых в 1-м круге не даём */
  banned: ReadonlySet<string>;
  /** сколько заданий каждого вида берём из сборника НЦТ, и баллы за них */
  quota: Record<Kind, number>;
  quotaPoints: number;
  /** открытые: сколько лёгких, средних, сложных (в сумме composition.open) */
  openDifficulty: [number, number, number];
  /** раздел темы по порядку главы и темы; null — тема в режим не входит */
  topicSection: (chapterOrder: number, topicOrder: number) => NctSection | null;
  /** уточнение раздела по метке типа (органические типы химии; у права — раздел, к которому тип относится) */
  refineSection: (topicSection: NctSection | null, nctType?: string | null) => NctSection | null;
  /** какие типы слотов раздела берутся вместе (у химии «основные понятия» берут и типы химии элементов) */
  weightSections?: Record<string, string[]>;
  /** при отсутствии типов у раздела на виде: разделы, чьи типы НЕ берутся */
  fallbackExclude?: string[];
  /** на каких разделах бывает вид (если не указано — на любых) */
  kindSections?: Partial<Record<Kind, string[]>>;
  /** не больше стольких заданий вида в одном разделе (у права открытые: по одному, на ТГП и КП) */
  maxPerSection?: Partial<Record<Kind, number>>;
  /** Предел заданий вида в разделе — число его типов (ключ «раздел:вид»; тип в билете не повторяется) */
  maxByTypes?: Record<string, number>;
  /** границы числа заданий вида в разделе [мин, макс] (у истории: всеобщая — ровно 5 тестов и 1 соответствие; без границ раздел может остаться без тестов) */
  kindRange?: Record<string, Partial<Record<Kind, [number, number]>>>;
  /** разделы, для которых в банке может не быть заданий (таджикский: литература): их отсутствие не делает подбор «частичным», жёсткая раскладка kindRange остаётся */
  optionalSections?: string[];
  /** сколько раз один тип может встретиться в билете (по умолчанию 1: тип не повторяется; у истории 2 — в настоящих билетах типы повторяются) */
  maxTypeUse?: number;
  /**
   * Английский: билет начинается с целых текстов — один текст для чтения (его 8 вопросов — первые тесты), затем один текст
   * с пропусками (ещё 8), остальное — обычный подбор по разделу `rest`. Значения — ключи разделов из `sections`.
   * В composition.test входят и вопросы текстов (20 = 8 + 8 + 4 отдельных теста).
   */
  textSections?: { reading: string; cloze: string; rest: string };
  /** пояснение в заметках про темы вне режима */
  skipNote: string;
  /** фраза для подсказки у галочки режима в «Составе билета» (после слов про блоки разделов); нет — стандартный текст химии */
  uiNote?: string;
  /** Близкие типы заданий: код → коды, которыми можно заменить, если вопросов нужного типа нет (nctRelated.ts) */
  related?: Record<string, string[]>;
}

export const NCT_SECTIONS: NctSection[] = ['basic', 'atom', 'solutions', 'elements', 'organic'];
export const NCT_SECTION_NAMES: Record<string, string> = {
  basic: 'Основные понятия и законы',
  atom: 'Строение атома и ПЗ',
  solutions: 'Растворы',
  elements: 'Химия элементов',
  organic: 'Органика',
};
/** Доли разделов в экзамене НЦТ, % */
export const NCT_SHARES: Record<NctSection, number> = { basic: 20, atom: 12, solutions: 12, elements: 20, organic: 36 };

export const NCT_COMPOSITION = { test: 18, matching: 2, open: 7, points: 40 };
export const NCT_POINTS_PER = { test: 1, matching: 4, open: 2 };

/** Темы центра в уровнях 1–3: число тем в главе (сквозная нумерация 1–49) */
const CHEM_LEVEL_SIZES = [21, 12, 16];

/**
 * Темы выше уровня 3 получают номер «база + номер темы» и раздел НЦТ:
 * глава 4 (химия элементов) → «Химия элементов», кроме расчётных тем 4.5, 4.10, 4.15 → «Основные понятия»; глава 5 (органика) → «Органика»;
 * глава 6: темы 1–8 (свойства классов) → «Химия элементов»; расчёты: 6.9, 6.11, 6.12, 6.16 → «Основные понятия»,
 * 6.10, 6.13–6.15, 6.17, 6.18 → «Химия элементов» (раздел темы выбран по типам заданий, которые в ней размечены);
 * глава 7: темы 4–12 (растворимость, кристаллогидраты, реакции и расчёты в растворах) → «Растворы».
 * Остальные темы глав 7 и выше в режим не берутся.
 */
const EXTRA_RANGES: Array<{ chapter: number; from: number; to: number; base: number; section: NctSection }> = [
  { chapter: 4, from: 1, to: 4, base: 300, section: 'elements' },
  { chapter: 4, from: 5, to: 5, base: 300, section: 'basic' }, // «Расчётные задачи по неорганической химии»
  { chapter: 4, from: 6, to: 9, base: 300, section: 'elements' },
  { chapter: 4, from: 10, to: 10, base: 300, section: 'basic' },
  { chapter: 4, from: 11, to: 14, base: 300, section: 'elements' },
  { chapter: 4, from: 15, to: 15, base: 300, section: 'basic' },
  { chapter: 5, from: 1, to: 17, base: 400, section: 'organic' },
  { chapter: 6, from: 1, to: 8, base: 500, section: 'elements' },
  { chapter: 6, from: 9, to: 9, base: 500, section: 'basic' }, // количество вещества
  { chapter: 6, from: 10, to: 10, base: 500, section: 'elements' }, // стехиометрия: цепочки, получение, ОВР
  { chapter: 6, from: 11, to: 12, base: 500, section: 'basic' }, // термохимия, избыток
  { chapter: 6, from: 13, to: 15, base: 500, section: 'elements' }, // кислые соли, выход, смеси
  { chapter: 6, from: 16, to: 16, base: 500, section: 'basic' }, // смеси газов
  { chapter: 6, from: 17, to: 18, base: 500, section: 'elements' }, // примеси, формулы
  { chapter: 7, from: 4, to: 12, base: 200, section: 'solutions' },
];

/**
 * Раздел НЦТ по теме центра (сквозной номер). Основные понятия — 1–33, 42, 43; атом и ПЗ — 34–41;
 * растворы — 44–49; номера 200+ — темы глав 4–7 (см. EXTRA_RANGES); остальное — null, в режиме НЦТ не берётся.
 */
export function sectionOfTopicNumber(n: number): NctSection | null {
  if (n >= 1 && n <= 33) return 'basic';
  if (n >= 34 && n <= 41) return 'atom';
  if (n === 42 || n === 43) return 'basic';
  if (n >= 44 && n <= 49) return 'solutions';
  const r = EXTRA_RANGES.find((x) => n >= x.base + x.from && n <= x.base + x.to);
  return r ? r.section : null;
}

/** Сквозной номер темы по порядку главы (уровня) и параграфа; null, если тема не входит в режим */
export function topicNumber(chapterOrder: number, topicOrder: number): number | null {
  const r = EXTRA_RANGES.find((x) => x.chapter === chapterOrder && topicOrder >= x.from && topicOrder <= x.to);
  if (r) return r.base + topicOrder;
  if (!Number.isFinite(chapterOrder) || !Number.isFinite(topicOrder) || chapterOrder < 1 || chapterOrder > CHEM_LEVEL_SIZES.length) return null;
  if (topicOrder < 1 || topicOrder > CHEM_LEVEL_SIZES[chapterOrder - 1]) return null;
  let offset = 0;
  for (let i = 0; i < chapterOrder - 1; i++) offset += CHEM_LEVEL_SIZES[i];
  return offset + topicOrder;
}

/**
 * Раздел задания: по теме, но задание с органической меткой (ORG_…, OM_…) всегда «Органика» — даже если лежит
 * в общей теме (например, вывод формулы углеводорода в теме 2.10). Тема вне режима даёт null при любой метке.
 */
export function sectionOfTopic(topicSection: NctSection | null, nctType?: string | null): NctSection | null {
  if (topicSection && nctType && (nctType.startsWith('ORG_') || nctType.startsWith('OM_'))) return 'organic';
  return topicSection;
}

export function sectionOfQuestion(q: any, cfg: NctConfig = CHEM_CONFIG): NctSection | null {
  return cfg.refineSection(cfg.topicSection(Number(q?.chapter?.order_index), Number(q?.topic?.order_index)), q?.nct_type);
}

/** Баллы по разделам: 40 × доля / сумма долей пройденных; целые, в сумме 40 (метод наибольших остатков) */
export function sectionPoints(present: NctSection[], total0?: number, cfg: NctConfig = CHEM_CONFIG): Record<string, number> {
  const total = total0 ?? cfg.composition.points;
  const share = (k: string) => cfg.sections.find((x) => x.key === k)?.share ?? 0;
  const sum = present.reduce((s, k) => s + share(k), 0);
  const raw = present.map((k) => ({ k, v: (total * share(k)) / sum }));
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
export function planNct(present: NctSection[], have: NctHave, ticketCount: number, rnd: Rnd = Math.random, cfg: NctConfig = CHEM_CONFIG): NctPlan | null {
  const { test: TEST, matching: MATCH, open: OPEN } = cfg.composition;
  const { matching: PM, open: PO } = cfg.pointsPer;
  if (present.length === 0) return null;
  const target = sectionPoints(present, undefined, cfg);
  const allowed = (k: NctSection, t: Kind) => !cfg.kindSections?.[t] || cfg.kindSections[t]!.includes(k);
  const n = present.length;

  const run = (cap0: (k: NctSection, type: Kind) => number, tol: number): NctPlan | null => {
    // Если выбрана только часть разделов экзамена (например, одна глава или несколько тем),
    // лимиты полного экзамена (kindRange, maxPerSection, maxByTypes) не должны блокировать подбор:
    const isSubset = cfg.sections.some((x) => !present.includes(x.key) && !(cfg.optionalSections ?? []).includes(x.key));
    const rng = (k: NctSection, t: Kind): [number, number] => (isSubset ? [0, Infinity] : (cfg.kindRange?.[k]?.[t] ?? [0, Infinity]));
    const cap = (k: NctSection, t: Kind) => {
      if (t !== 'test' && !allowed(k, t) && !isSubset) return 0;
      const maxPer = isSubset ? Infinity : (cfg.maxPerSection?.[t] ?? Infinity);
      const maxTypes = isSubset ? Infinity : (cfg.maxByTypes?.[`${k}:${t}`] ?? Infinity);
      return Math.min(cap0(k, t), maxPer, maxTypes, rng(k, t)[1]);
    };
    const floor = (k: NctSection, t: Kind) => Math.min(rng(k, t)[0], cap(k, t));
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
        if (m.some((v, i) => v < floor(present[i], 'matching')) || o.some((v, i) => v < floor(present[i], 'open'))) continue;
        const c = present.map((k, i) => target[k] - PM * m[i] - PO * o[i]);
        // c — «идеальные» тесты; корректируем в пределах ±1 балла так, чтобы сумма тестов была TEST
        const base = c.map((v, i) => Math.max(floor(present[i], 'test'), cfg.kindRange ? Math.min(v, cap(present[i], 'test')) : v));
        let diff = TEST - base.reduce((a, b) => a + b, 0);
        const tests = [...base];
        const order = tests.map((_, i) => i);
        let guard = 0;
        while (diff !== 0 && guard++ < 100) {
          const i = order[guard % n];
          if (diff > 0 && tests[i] < cap(present[i], 'test')) { tests[i]++; diff--; }
          else if (diff < 0 && tests[i] > floor(present[i], 'test')) { tests[i]--; diff++; }
        }
        if (diff !== 0 || tests.some((v, i) => v > cap(present[i], 'test'))) continue;
        let dev = 0;
        let ok = true;
        present.forEach((k, i) => {
          const pts = tests[i] + PM * m[i] + PO * o[i];
          const d = Math.abs(pts - target[k]);
          if (d > tol) ok = false;
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
  // допуск по баллам раздела: сначала ±1 (как у химии), при невозможности — шире
  for (const tol of [1, 2, 3, 5, 10, 40]) {
    const got = run((k, t) => Math.floor((have[k]?.[t] ?? 0) / T), tol) ?? run((k, t) => have[k]?.[t] ?? 0, tol) ?? run(() => 1000, tol);
    if (got) return got;
  }
  return null;
}

export interface NctPicked extends PickedTickets {
  plan: NctPlan;
  sections: NctSection[];
  notes: string[];
}

/** Типы, которые в 1-м круге не даём (правила 1-го круга): «с чем реагирует», получение, электролиз, термохимия, избыток, выход, смеси с реакциями, многостадийные расчёты и цепочки */
export const NCT_BANNED = new Set([
  'REACT_WITH', 'OBTAIN', 'ELECTROLYSIS', 'THERMO', 'EXCESS', 'EXCESS_SALT', 'EXCESS_PIC', 'YIELD', 'ORG_YIELD',
  'MIX_ACID', 'MIX_SALT', 'MIX_METAL', 'EL_MULTISTEP', 'CHAIN', 'STOICH2', 'DISPLACE', 'EL_DECOMP_PCT', 'EL_IDENT_CALC', 'GASMIX_REACT',
]);

/** Доли сложности (в процентах, сумма 100) для тестов и соответствий билета НЦТ */
export interface NctDifficultyShares { easy: number; medium: number; hard: number }
export const NCT_DEFAULT_DIFFICULTY: NctDifficultyShares = { easy: 50, medium: 40, hard: 10 };
/** Открытые задачи — всегда столько лёгких, средних и сложных (из 7) */
export const NCT_OPEN_DIFFICULTY: [number, number, number] = [2, 3, 2];

/** Раскладывает count мест по сложности 1/2/3 по долям (метод наибольших остатков) и перемешивает */
export function difficultyTargets(count: number, shares: NctDifficultyShares, rnd: Rnd = Math.random): number[] {
  const raw = [shares.easy, shares.medium, shares.hard].map((p) => (Math.max(0, p) * count) / 100);
  const n = raw.map((v) => Math.floor(v));
  let left = Math.min(count, Math.round(raw.reduce((a, v) => a + v, 0))) - n.reduce((a, v) => a + v, 0);
  for (const i of [0, 1, 2].sort((a, b) => (raw[b] - n[b]) - (raw[a] - n[a]))) { if (left <= 0) break; n[i]++; left--; }
  const out = [1, 2, 3].flatMap((d, i) => Array<number>(n[i]).fill(d));
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** Сколько заданий каждого вида берём из сборника НЦТ (источник «ЦВЭ …»): 8 + 4 + 2×2 = 16 баллов из 40, то есть 40 % */
export const NCT_QUOTA: Record<Kind, number> = { test: 8, matching: 1, open: 2 };
export const NCT_QUOTA_POINTS = 16;

/** Типы по частоте на номерах раздела; «основные понятия» берут и типы химии элементов (степень окисления, ОВР — темы 42–43) */
export function typeWeights(section: NctSection, kind: Kind, cfg: NctConfig = CHEM_CONFIG): Record<string, number> {
  const keys = cfg.weightSections?.[section] ?? [section];
  const slotTypes = cfg.slotTypes;
  let w: Record<string, number> = {};
  for (const k of keys) for (const [c, n] of Object.entries(slotTypes[`${k}:${kind}`] ?? {})) w[c] = (w[c] ?? 0) + n;
  if (Object.keys(w).length === 0) {
    // у раздела нет своего типа на этом виде (например, соответствие по растворам): типы всех разделов, кроме исключённых
    for (const key of Object.keys(slotTypes)) {
      if (!key.endsWith(`:${kind}`) || (cfg.fallbackExclude ?? []).some((x) => key.startsWith(`${x}:`))) continue;
      for (const [c, n] of Object.entries(slotTypes[key])) w[c] = (w[c] ?? 0) + n;
    }
  }
  return Object.fromEntries(Object.entries(w).filter(([c]) => !cfg.banned.has(c)));
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
 * nct_type — метка типа — и isNct — вопрос из сборника НЦТ). Вопросы тем, не распределённых по разделам (EXTRA_RANGES), в режим не попадают.
 * Задания каждого вида идут блоками разделов в порядке НЦТ. На каждое место выбирается тип по частоте
 * на номерах раздела и подбираются вопросы с этой меткой (во всех вариантах — один тип, как клоны); один тип
 * в билете не повторяется. Часть мест (NCT_QUOTA) берётся из сборника НЦТ. Нет вопросов с нужной меткой —
 * берутся неразмеченные вопросы раздела. Темы стараются не повторяться в билете: на каждое место предпочтительны
 * вопросы тем, из которых в билете ещё ничего не взято (а при нехватке — наименее использованных).
 */
export function pickNct(pool: any[], ticketCount: number, rnd: Rnd = Math.random, _totals?: ChapterTotals, difficulty: NctDifficultyShares = NCT_DEFAULT_DIFFICULTY, cfg: NctConfig = CHEM_CONFIG): NctPicked {
  if (cfg.textSections) return pickNctText(pool, ticketCount, rnd, difficulty, cfg);
  const SECTION_KEYS = cfg.sections.map((x) => x.key);
  const NAME = (k: string) => cfg.sections.find((x) => x.key === k)?.name ?? k;
  const notes: string[] = [];
  const bySection = new Map<NctSection, any[]>();
  let skipped = 0;
  for (const q of pool) {
    const s = sectionOfQuestion(q, cfg);
    if (!s) { skipped++; continue; }
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s)!.push(q);
  }
  if (skipped > 0) notes.push(`${skipped} вопросов ${cfg.skipNote}, в билеты не взяты`);

  const have: NctHave = {};
  for (const [k, list] of bySection) {
    have[k] = {
      test: list.filter((q) => q.type === 'test').length,
      matching: list.filter((q) => q.type === 'matching').length,
      open: list.filter((q) => q.type === 'open').length,
    };
  }
  // Раздел считается пройденным, если в нём есть тесты (без них нет ни одного номера 1–18)
  let present = SECTION_KEYS.filter((k) => (have[k]?.test ?? 0) > 0);
  if (present.length === 0 && pool.length > 0) {
    // Вопросы выбранных тем не попали в официальную карту разделов (или нет тестов в сопоставленных разделах) —
    // объединяем доступные вопросы под первым разделом, чтобы билеты всё равно сгенерировались
    const fallbackSec = SECTION_KEYS[0];
    bySection.set(fallbackSec, [...pool]);
    have[fallbackSec] = {
      test: pool.filter((q) => q.type === 'test').length,
      matching: pool.filter((q) => q.type === 'matching').length,
      open: pool.filter((q) => q.type === 'open').length,
    };
    present = [fallbackSec];
    notes.push('Темы вне разделов НЦТ: задания сформированы из доступных вопросов банка');
  }
  const plan = present.length ? planNct(present, have, ticketCount, rnd, cfg) : null;

  const T = ticketCount;
  const empty = () => Array.from({ length: T }, () => [] as any[]);
  const tests = empty(), matching = empty(), open = empty();
  if (!plan) return { kinds: [tests, matching, open], ticketCount: T, plan: {}, sections: present, notes: [...notes, 'В выбранных темах нет тестов из разделов НЦТ'] };

  const usedIds = new Set<string>();
  const usedTypes = new Map<string, number>(); // тип → сколько раз уже взят в билет
  const maxUse = cfg.maxTypeUse ?? 1;
  const typeFree = (c: string) => (usedTypes.get(c) ?? 0) < maxUse;
  const nctPicked: Record<Kind, number> = { test: 0, matching: 0, open: 0 };
  const typePicked: Record<Kind, number> = { test: 0, matching: 0, open: 0 };
  const exactPicked: Record<Kind, number> = { test: 0, matching: 0, open: 0 };
  const relatedPicked: Record<Kind, number> = { test: 0, matching: 0, open: 0 };
  // все вопросы выбранных тем, попавшие в разделы НЦТ
  const scoped = [...bySection.values()].flat();

  // Разнообразие тем: сколько раз тема уже встретилась в билете (счёт по всему билету, а не по разделу)
  const topicUse = new Map<string, number>();
  const useOf = (q: any) => topicUse.get(q.topic_id) ?? 0;
  /** Оставляет вопросы наименее использованных тем, где хватает вопросов для всех билетов (T штук в одной теме) */
  const freshest = (cands: any[]): any[] => {
    const levels = enoughTopicsUse(cands);
    return levels.length ? cands.filter((q) => useOf(q) <= levels[0]) : cands;
  };
  /** Использования тем (по возрастанию), в которых хватает вопросов для всех билетов */
  const enoughTopicsUse = (cands: any[]): number[] => {
    const byTopic = new Map<string, any[]>();
    for (const q of cands) { const k = q.topic_id ?? '—'; if (!byTopic.has(k)) byTopic.set(k, []); byTopic.get(k)!.push(q); }
    return [...new Set([...byTopic.values()].filter((g) => g.length >= T).map((g) => useOf(g[0])))].sort((a, b) => a - b);
  };

  /** Выбор типа по весам среди тех, где хватает вопросов на все билеты; затем — столбец вопросов этого типа */
  const pickTyped = (pool: any[], w: Record<string, number>): { rows: any[]; code: string } | null => {
    const byCode = (c: string) => pool.filter((q) => q.nct_type === c);
    let cands = Object.keys(w).filter((c) => typeFree(c) && byCode(c).length >= T);
    if (!cands.length) return null;
    // из типов предпочитаем те, у которых есть вопросы ещё не использованной (или наименее использованной) темы
    const lvl = new Map(cands.map((c) => [c, enoughTopicsUse(byCode(c))[0] ?? Infinity]));
    const best = Math.min(...lvl.values());
    cands = cands.filter((c) => lvl.get(c) === best);
    let r = rnd() * cands.reduce((a, c) => a + w[c], 0);
    let code = cands[cands.length - 1];
    for (const c of cands) { r -= w[c]; if (r < 0) { code = c; break; } }
    const col = pickParallel(freshest(byCode(code)), 1, T, rnd);
    return col.every((t) => t.length === 1) ? { rows: col.map((t) => t[0]), code } : null;
  };

  const attempt = (pool: any[], section: NctSection, kind: Kind, wide: any[] = []): { rows: any[]; code: string | null } | null => {
    const w = typeWeights(section, kind, cfg);
    const exact = pickTyped(pool, w);
    if (exact) { exactPicked[kind]++; return exact; }
    // нужного типа нет: близкие типы (семьи из nctRelated) — сначала в разделе, затем в выбранных темах других разделов
    if (cfg.related) {
      const rw: Record<string, number> = {};
      for (const [c, n] of Object.entries(w)) for (const r of cfg.related[c] ?? []) if (!(r in w) && !cfg.banned.has(r)) rw[r] = (rw[r] ?? 0) + n;
      const near = pickTyped(pool, rw) ?? (wide.length ? pickTyped(wide, rw) : null);
      if (near) { relatedPicked[kind]++; return near; }
    }
    // нет подходящей метки: неразмеченные вопросы и вопросы ещё не использованных разрешённых типов
    const loose = pool.filter((q) => !q.nct_type || (!cfg.banned.has(q.nct_type) && typeFree(q.nct_type)));
    let col = pickParallel(freshest(loose), 1, T, rnd);
    if (col.every((t) => t.length === 1)) {
      const code = col[0][0].nct_type ?? null;
      return { rows: col.map((t) => t[0]), code: code && col.every((t) => t[0].nct_type === code) ? code : null };
    }
    // если по свежести темы не вышло, пробуем без фильтра freshest:
    col = pickParallel(loose, 1, T, rnd);
    if (col.every((t) => t.length === 1)) {
      const code = col[0][0].nct_type ?? null;
      return { rows: col.map((t) => t[0]), code: code && col.every((t) => t[0].nct_type === code) ? code : null };
    }
    // запасной вариант: любые доступные вопросы пула нужного вида
    col = pickParallel(pool, 1, T, rnd);
    if (col.every((t) => t.length === 1)) {
      return { rows: col.map((t) => t[0]), code: null };
    }
    return null;
  };

  const diffHit: Record<Kind, number> = { test: 0, matching: 0, open: 0 };
  const diffMiss: Record<Kind, number> = { test: 0, matching: 0, open: 0 };
  const pickOne = (list: any[], section: NctSection, kind: Kind, wantNct: boolean, diff: number): any[] | null => {
    const free = list.filter((q) => q.type === kind && !usedIds.has(q.id));
    // вопросы того же вида из всех разделов выбранных тем — для близких типов из других разделов
    const wideAll = scoped.filter((q) => q.type === kind && !usedIds.has(q.id));
    // сначала нужная сложность, затем ближайшие; вопросы без оценки сложности — в последнюю очередь
    const levels: Array<number | null> = [diff, ...[1, 2, 3].filter((d) => d !== diff).sort((a, b) => Math.abs(a - diff) - Math.abs(b - diff)), null];
    for (const lvl of levels) {
      const byLvl = lvl === null ? free.filter((q) => !q.nct_difficulty) : free.filter((q) => q.nct_difficulty === lvl);
      if (byLvl.length < T) continue;
      const nctFree = byLvl.filter((q) => q.isNct);
      const own = byLvl.filter((q) => !q.isNct);
      const wide = lvl === null ? wideAll.filter((q) => !q.nct_difficulty) : wideAll.filter((q) => q.nct_difficulty === lvl);
      const got = tryPools(wantNct ? [nctFree, own] : [own, nctFree], section, kind, wide);
      if (!got) continue;
      if (lvl === diff) diffHit[kind]++; else if (lvl !== null) diffMiss[kind]++;
      return got;
    }
    // Если по отдельным уровням сложности не набралось T штук, пробуем любые свободные вопросы этого вида:
    if (free.length >= T) {
      const nctFree = free.filter((q) => q.isNct);
      const own = free.filter((q) => !q.isNct);
      const got = tryPools(wantNct ? [nctFree, own] : [own, nctFree], section, kind, wideAll);
      if (got) {
        diffMiss[kind]++;
        return got;
      }
    }
    return null;
  };
  const tryPools = (pools: any[][], section: NctSection, kind: Kind, wide: any[] = []): any[] | null => {
    for (const pool of pools) {
      const got = attempt(pool, section, kind, wide);
      if (!got) continue;
      got.rows.forEach((q) => usedIds.add(q.id));
      for (const tid of new Set(got.rows.map((q) => q.topic_id))) topicUse.set(tid, (topicUse.get(tid) ?? 0) + 1);
      if (got.code) typePicked[kind]++;
      for (const c of new Set<string>(got.rows.map((q) => q.nct_type).filter(Boolean))) usedTypes.set(c, (usedTypes.get(c) ?? 0) + 1);
      if (got.rows[0].isNct) nctPicked[kind]++;
      return got.rows;
    }
    return null;
  };

  const fill = (dst: any[][], kind: Kind) => {
    const counts = SECTION_KEYS
      .map((k) => ({ k, want: plan[k]?.[kind] ?? 0, cap: (bySection.get(k) ?? []).filter((q) => q.isNct && q.type === kind).length }))
      .filter((c) => c.want > 0);
    const quota = splitQuota(cfg.quota[kind], counts);
    const nPlaces = counts.reduce((a, c) => a + c.want, 0);
    const targets = kind === 'open'
      ? difficultyTargets(nPlaces, { easy: (100 * cfg.openDifficulty[0]) / cfg.composition.open, medium: (100 * cfg.openDifficulty[1]) / cfg.composition.open, hard: (100 * cfg.openDifficulty[2]) / cfg.composition.open }, rnd)
      : difficultyTargets(nPlaces, difficulty, rnd);
    let place = 0;
    for (const { k, want } of counts) {
      // места раздела, на которых берём задание из сборника НЦТ: случайные
      const flags = Array.from({ length: want }, (_, i) => i < (quota[k] ?? 0));
      for (let i = flags.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [flags[i], flags[j]] = [flags[j], flags[i]]; }
      let got = 0;
      for (let i = 0; i < want; i++) {
        const rows = pickOne(bySection.get(k) ?? [], k, kind, flags[i], targets[place++] ?? 2);
        if (!rows) continue;
        got++;
        for (let t = 0; t < T; t++) dst[t].push(rows[t]);
      }
      if (got < want) notes.push(`${NAME(k)}: заданий вида «${kind}» ${got} из ${want} — не хватило вопросов`);
    }
  };
  fill(tests, 'test');
  fill(matching, 'matching');
  fill(open, 'open');
  separateLinked([tests, matching, open], pool, rnd);

  const relTotal = relatedPicked.test + relatedPicked.matching + relatedPicked.open;
  if (relTotal > 0) notes.push(`Нужного типа задания не нашлось для ${relTotal} мест — взяты близкие типы (например, вывод формулы из неорганики вместо органики)`);
  const missTotal = diffMiss.test + diffMiss.matching + diffMiss.open;
  if (missTotal > 0) notes.push(`Нужной сложности не хватило для ${missTotal} заданий — взята ближайшая`);
  const nctPoints = cfg.pointsPer.test * nctPicked.test + cfg.pointsPer.matching * nctPicked.matching + cfg.pointsPer.open * nctPicked.open;
  if (nctPoints < cfg.quotaPoints) notes.push(`Из сборника НЦТ набрано ${nctPoints} баллов из ${cfg.quotaPoints} (в выбранных темах мало таких вопросов)`);
  const total = tests[0].length + matching[0].length + open[0].length;
  if (total > 0 && typePicked.test + typePicked.matching + typePicked.open < total / 2) notes.push('Меток типа НЦТ у вопросов этих тем мало: типы заданий выдерживаются лишь частично');
  return { kinds: [tests, matching, open], ticketCount: T, plan, sections: present, notes };
}

/**
 * Билет НЦТ с текстами (английский): № 1–8 — текст для чтения целиком, № 9–16 — текст с пропусками целиком (у разных
 * вариантов тексты разные; у параллельных вариантов — тексты одной темы, пока хватает), затем отдельные тесты, соответствия
 * и открытые обычным подбором (pickNct на пуле без вопросов к текстам). Для текстов тип места не выбирается:
 * типы заданий внутри текста задаёт сам текст. Не хватило текста — места остаются пустыми и добираются обычными тестами
 * (TicketGenerator), в заметках об этом сказано.
 */
function pickNctText(pool: any[], T: number, rnd: Rnd, difficulty: NctDifficultyShares, cfg: NctConfig): NctPicked {
  const ts = cfg.textSections!;
  const notes: string[] = [];
  const blocks = passageBlocks(pool.filter((q) => q.type === 'test'));
  const takeOne = (list: ReturnType<typeof passageBlocks>['reading']) => {
    const m = pickBlocks(list, 1, T, rnd);
    return m.length === T && m.every((t) => t.length === 1) ? m.map((t) => t[0]) : null;
  };
  const rd = takeOne(blocks.reading);
  if (!rd) notes.push('Не нашлось текста для чтения (8 вопросов) в выбранных темах');
  // текст с пропусками предпочтительно из другой темы, чем текст для чтения
  const usedTopics = new Set((rd ?? []).map((b) => b.topic_id));
  const otherTopic = blocks.cloze.filter((b) => !usedTopics.has(b.topic_id));
  const cl = takeOne(otherTopic.length >= T ? otherTopic : blocks.cloze);
  if (!cl) notes.push('Не нашлось текста с пропусками (8 вопросов) в выбранных темах');
  const restTest = Math.max(0, cfg.composition.test - 2 * PASSAGE_SIZE);
  const { test: pt, matching: pm, open: po } = cfg.pointsPer;
  const restCfg: NctConfig = {
    ...cfg,
    textSections: undefined,
    sections: [{ key: ts.rest, name: cfg.sections.find((x) => x.key === ts.rest)?.name ?? ts.rest, share: 100 }],
    composition: { test: restTest, matching: cfg.composition.matching, open: cfg.composition.open, points: pt * restTest + pm * cfg.composition.matching + po * cfg.composition.open },
    topicSection: () => ts.rest,
    refineSection: (s) => s,
    quota: { test: 0, matching: 0, open: 0 },
    quotaPoints: 0,
    kindSections: undefined,
    maxPerSection: undefined,
    kindRange: undefined,
  };
  const rest = pickNct(pool.filter((q) => !q.passage_id), T, rnd, undefined, difficulty, restCfg);
  notes.push(...rest.notes);
  const tests = Array.from({ length: T }, () => [] as any[]);
  for (let t = 0; t < T; t++) tests[t] = [...(rd?.[t].questions ?? []), ...(cl?.[t].questions ?? []), ...(rest.kinds[0][t] ?? [])];
  const plan: NctPlan = {};
  if (rd) plan[ts.reading] = { test: PASSAGE_SIZE, matching: 0, open: 0 };
  if (cl) plan[ts.cloze] = { test: PASSAGE_SIZE, matching: 0, open: 0 };
  if (rest.plan[ts.rest]) plan[ts.rest] = rest.plan[ts.rest];
  const sections = cfg.sections.map((x) => x.key).filter((k) => plan[k]);
  return { kinds: [tests, rest.kinds[1], rest.kinds[2]], ticketCount: T, plan, sections, notes };
}

/** Настройки химии: прежние константы файла */
export const CHEM_CONFIG: NctConfig = {
  key: 'chemistry',
  sections: NCT_SECTIONS.map((k) => ({ key: k, name: NCT_SECTION_NAMES[k], share: NCT_SHARES[k] })),
  composition: NCT_COMPOSITION,
  pointsPer: NCT_POINTS_PER,
  slotTypes: NCT_SLOT_TYPES,
  related: CHEM_RELATED,
  banned: NCT_BANNED,
  quota: NCT_QUOTA,
  quotaPoints: NCT_QUOTA_POINTS,
  openDifficulty: NCT_OPEN_DIFFICULTY,
  topicSection: (ch, tp) => { const n = topicNumber(ch, tp); return n === null ? null : sectionOfTopicNumber(n); },
  refineSection: sectionOfTopic,
  weightSections: { basic: ['basic', 'elements'] },
  fallbackExclude: ['organic'],
  skipNote: 'из тем, не распределённых по разделам НЦТ (главы 7–10, кроме тем 7.4–7.12)',
};

/** Короткое описание плана для интерфейса: «Основные понятия 18 б. (6+1+4) · …» */
export function describePlan(plan: NctPlan, cfg: NctConfig = CHEM_CONFIG): string {
  return cfg.sections.filter((s) => plan[s.key]).map(({ key: k, name }) => {
    const p = plan[k];
    const pts = p.test * cfg.pointsPer.test + cfg.pointsPer.matching * p.matching + cfg.pointsPer.open * p.open;
    return `${name} — ${pts} б. (${p.test} тест. + ${p.matching} соотв. + ${p.open} откр.)`;
  }).join('; ');
}

/** Случайная перестановка длины n; при n > 1 ни один элемент не остаётся на своём месте (беспорядок) */
function derangement(n: number, rnd: Rnd): number[] {
  const id = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return id;
  for (let attempt = 0; attempt < 200; attempt++) {
    const p = [...id];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    if (p.every((v, i) => v !== i)) return p;
  }
  return id.map((_, i) => (i + 1) % n); // сдвиг — всегда беспорядок
}

/**
 * «Переставленные варианты»: picked содержит 2 разных варианта (1 и 2). Возвращает `total` вариантов:
 * варианты 1 и 2 — как есть, вариант 3 — вариант 1 с переставленными заданиями, вариант 4 — вариант 2 и т. д.
 * (нечётные — от 1-го, чётные — от 2-го). Тесты переставляются только среди тестовых мест, соответствия —
 * среди мест соответствий, открытые — среди открытых; каждое задание уходит со своего места.
 * Перестановки одного исходного варианта различаются между собой, пока это возможно.
 */
export function expandPermuted<T extends PickedTickets>(picked: T, total: number, rnd: Rnd = Math.random): T {
  if (picked.ticketCount !== 2 || total < 2) return picked;
  const kinds = picked.kinds.map((byTicket) => byTicket.map((row) => [...row]));
  const seen = new Map<string, true>();
  for (let t = 2; t < total; t++) {
    const base = t % 2;
    kinds.forEach((byTicket, k) => {
      const src = picked.kinds[k][base];
      let perm = derangement(src.length, rnd);
      for (let a = 0; a < 20 && src.length > 2 && seen.has(`${base}:${k}:${perm.join(',')}`); a++) perm = derangement(src.length, rnd);
      seen.set(`${base}:${k}:${perm.join(',')}`, true);
      byTicket.push(perm.map((i) => src[i]));
    });
  }
  return { ...picked, kinds, ticketCount: total } as T;
}
