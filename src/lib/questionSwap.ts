// Подбор замен для вопросов в готовом наборе билетов. Чистая логика (без запросов к базе) — тестируется в Node.
// Правила: замена того же вида (тест / соответствие / открытый); вопрос, уже стоящий в любом билете набора,
// не берётся; предпочитаются реже использованные вопросы, затем порядок в сборнике; вопросы, связанные
// друг с другом (тест и открытый вопрос из него), в один билет не попадают.

import { PASSAGE_SIZE, toSnapshot, usageOf, type Settings } from '../../supabase/functions/_shared/ticketing';
import { CHEM_CONFIG, type NctConfig, type NctSection } from '../../supabase/functions/_shared/nct';

export type QType = 'test' | 'matching' | 'open';
export const TYPE_ORDER: QType[] = ['test', 'matching', 'open'];
export const TYPE_LABEL: Record<QType, string> = { test: 'тест', matching: 'соответствие', open: 'открытый' };

/** Вопрос банка в «лёгком» виде (поля loadLightPool) */
export interface PoolQ {
  id: string;
  type: QType;
  topic_id: string;
  chapter_id?: string | null;
  num?: number | null;
  seq?: number | null;
  created_at?: string;
  linked_ids?: string[] | null;
  usage?: unknown;
  /** Метка типа НЦТ и источник (поля лёгкого пула); isNct — вопрос из сборника НЦТ (проставляет вызывающий) */
  nct_type?: string | null;
  /** Сложность для НЦТ: 1 лёгкий, 2 средний, 3 сложный */
  nct_difficulty?: number | null;
  source_id?: string | null;
  isNct?: boolean;
  /** Вопрос к тексту (английский): id текста, номер вопроса в тексте и вид текста */
  passage_id?: string | null;
  passage_order?: number | null;
  passage?: { kind?: string | null } | null;
  chapter?: { order_index?: number | null } | null;
  topic?: { order_index?: number | null } | null;
}

/** Место вопроса в билете */
export interface Slot {
  tqId: string;
  ticketId: string;
  ticketNumber: number;
  orderIndex: number;
  questionId: string | null;
  type: QType;
  topicId: string | null;
  chapterId?: string | null;
  linked?: string[];
  /** Метка типа НЦТ, сложность и источник вопроса, стоящего на месте */
  nctType?: string | null;
  nctDifficulty?: number | null;
  sourceId?: string | null;
  /** Вопрос к тексту: id текста и его вид (чтение / пропуски); у обычного вопроса и пустого места — null */
  passageId?: string | null;
  passageKind?: PassageKindLite | null;
}
export type PassageKindLite = 'reading' | 'cloze';

// ---------- Пустое место ----------

/** Снимок «пустого места»: вопрос не нашёлся, место осталось свободным (в Word и ключах — красным) */
export function emptySnapshot(type: QType, topicName?: string | null) {
  return {
    empty: true, id: null, type, content: '', content_ru: '', content_tg: '', topic_name: topicName ?? undefined,
    options: [], matching_items: [], image_url: null, correct_numeric_answer: null,
  };
}
export const isEmptySnapshot = (s: any): boolean => Boolean(s && s.empty);

// ---------- Подбор кандидатов ----------

function bookOrder(a: PoolQ, b: PoolQ): number {
  const na = a.num ?? null, nb = b.num ?? null;
  if (na !== null && nb !== null && na !== nb) return Number(na) - Number(nb);
  const sa = a.seq ?? null, sb = b.seq ?? null;
  if (sa !== null && sb !== null && sa !== sb) return Number(sa) - Number(sb);
  const ca = a.created_at || '', cb = b.created_at || '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Сначала менее использованные, затем по порядку сборника */
export function rankFresh(list: PoolQ[]): PoolQ[] {
  return [...list].sort((a, b) => usageOf(a) - usageOf(b) || bookOrder(a, b));
}

/** Двусторонние связи вопросов: id → множество связанных id */
export function buildLinks(items: Array<{ id: string; linked_ids?: string[] | null }>): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!links.has(a)) links.set(a, new Set());
    links.get(a)!.add(b);
  };
  for (const q of items) for (const id of q.linked_ids ?? []) { add(q.id, id); add(id, q.id); }
  return links;
}

const clashes = (id: string, others: Iterable<string>, links: Map<string, Set<string>>): boolean => {
  const l = links.get(id);
  if (!l) return false;
  for (const o of others) if (l.has(o)) return true;
  return false;
};

/** Кандидаты на замену: тот же вид, не использован в наборе, не связан с остальными вопросами билета */
export function candidatesFor(
  pool: PoolQ[], type: QType, used: Set<string>, ticketOthers: Iterable<string>, links: Map<string, Set<string>>,
): PoolQ[] {
  const others = [...ticketOthers];
  // вопросы к тексту поодиночке не ставятся: они меняются только вместе с текстом (blockCandidates)
  return rankFresh(pool.filter((q) => q.type === type && !q.passage_id && !used.has(q.id) && !clashes(q.id, others, links)));
}

// ---------- Тексты (английский): замена блоком ----------

/** Текст из пула: все его вопросы по порядку passage_order */
export interface PassageBlockQ { id: string; kind: PassageKindLite; topicId: string; questions: PoolQ[] }

/** Номера мест билета (в массиве slots), которые меняются вместе с местом index: весь текст или только оно само */
export function blockSlots(slots: Slot[], index: number): number[] {
  const s = slots[index];
  if (!s) return [];
  const mine = slots.map((x, i) => ({ x, i })).filter(({ x }) => x.ticketId === s.ticketId).sort((a, b) => a.x.orderIndex - b.x.orderIndex);
  let pid = s.passageId ?? null;
  if (!pid && !s.questionId) {
    // пустое место: оно в блоке, если слева и справа от него (среди непустых мест) стоит один и тот же текст
    const at = mine.findIndex(({ i }) => i === index);
    const filled = (from: number, step: number) => { for (let k = from; k >= 0 && k < mine.length; k += step) if (mine[k].x.questionId) return mine[k].x; return null; };
    const prev = filled(at - 1, -1), next = filled(at + 1, 1);
    if (prev?.passageId && prev.passageId === next?.passageId) pid = prev.passageId;
  }
  if (!pid) return [index];
  const own = mine.filter(({ x }) => x.passageId === pid);
  const lo = own[0].x.orderIndex, hi = own[own.length - 1].x.orderIndex;
  return mine.filter(({ x }) => x.orderIndex >= lo && x.orderIndex <= hi && (x.passageId === pid || !x.questionId)).map(({ i }) => i).sort((a, b) => a - b);
}

/** id текстов, уже стоящих в билетах набора */
export const usedPassageIds = (slots: Slot[]): Set<string> => new Set(slots.map((s) => s.passageId).filter((x): x is string => !!x));

/**
 * Тексты пула одного вида, которых нет в наборе: целые (ровно PASSAGE_SIZE вопросов-тестов), реже использованные первыми,
 * затем порядок сборника. Вопросы каждого текста идут по passage_order.
 */
export function blockCandidates(pool: PoolQ[], kind: PassageKindLite, usedPassages: Set<string>): PassageBlockQ[] {
  const groups = new Map<string, PoolQ[]>();
  for (const q of pool) {
    if (!q.passage_id || q.type !== 'test' || q.passage?.kind !== kind || usedPassages.has(q.passage_id)) continue;
    if (!groups.has(q.passage_id)) groups.set(q.passage_id, []);
    groups.get(q.passage_id)!.push(q);
  }
  const blocks: PassageBlockQ[] = [];
  for (const [id, list] of groups) {
    const questions = [...list].sort((a, b) => Number(a.passage_order) - Number(b.passage_order));
    if (questions.length !== PASSAGE_SIZE || !questions.every((q, i) => Number(q.passage_order) === i + 1)) continue;
    blocks.push({ id, kind, topicId: questions[0].topic_id, questions });
  }
  const load = (b: PassageBlockQ) => b.questions.reduce((n, q) => n + usageOf(q), 0);
  return blocks.sort((a, b) => load(a) - load(b) || bookOrder(a.questions[0], b.questions[0]));
}

/**
 * Убирает тексты, вопросы которых связаны (linked_ids) с вопросами, остающимися в том же билете
 * (места самого заменяемого текста — members — освобождаются и в счёт не идут).
 */
export function blocksWithoutLinkClash(blocks: PassageBlockQ[], slots: Slot[], members: Slot[]): PassageBlockQ[] {
  const memberIds = new Set(members.map((m) => m.tqId));
  const ticketIds = new Set(members.map((m) => m.ticketId));
  const staying = slots.filter((x) => ticketIds.has(x.ticketId) && x.questionId && !memberIds.has(x.tqId));
  const links = buildLinks([
    ...blocks.flatMap((b) => b.questions),
    ...staying.map((x) => ({ id: x.questionId!, linked_ids: x.linked })),
  ]);
  const stay = new Map<string, Set<string>>();
  for (const x of staying) {
    if (!stay.has(x.ticketId)) stay.set(x.ticketId, new Set());
    stay.get(x.ticketId)!.add(x.questionId!);
  }
  return blocks.filter((b) => [...ticketIds].every((t) => b.questions.every((q) => !clashes(q.id, stay.get(t) ?? [], links))));
}

/** Изменения для замены текста: места блока по порядку получают вопросы нового текста; block = null — пустые места */
export function blockSwapChanges(blockSlotList: Slot[], block: PassageBlockQ | null): PlanChange[] {
  const sorted = [...blockSlotList].sort((a, b) => a.orderIndex - b.orderIndex);
  return sorted.map((slot, i) => ({ slot, question: block?.questions[i] ?? null }));
}

// ---------- Выбор глав и тем при создании набора ----------

/**
 * Темы, из которых создавался набор (generation_params): заданы темы — они, иначе темы заданных глав;
 * null — весь предмет. Замена вопроса берёт вопросы только отсюда.
 */
export function scopeTopicIds(params: any, topics: Array<{ id: string; chapterId: string }>): Set<string> | null {
  const topicIds: string[] = Array.isArray(params?.topic_ids) ? params.topic_ids : [];
  if (topicIds.length) return new Set(topicIds);
  const chapterIds: string[] = Array.isArray(params?.chapter_ids) ? params.chapter_ids : [];
  if (chapterIds.length) { const ch = new Set(chapterIds); return new Set(topics.filter((t) => ch.has(t.chapterId)).map((t) => t.id)); }
  return null;
}

// ---------- Замена в билете по формату НЦТ ----------

/** Что за место в билете НЦТ: раздел, метка типа и из сборника ли НЦТ стоит вопрос */
export interface NctSlotInfo { section: NctSection | null; nctType: string | null; isNct: boolean; difficulty?: number | null }

/** Раздел НЦТ вопроса по порядку главы и темы (уровни 1–3); null — тема вне режима НЦТ */
export function sectionOfPoolQ(q: Pick<PoolQ, 'chapter' | 'topic'> & { nct_type?: string | null }, cfg: NctConfig = CHEM_CONFIG): NctSection | null {
  return cfg.refineSection(cfg.topicSection(Number(q.chapter?.order_index), Number(q.topic?.order_index)), q.nct_type);
}

/**
 * Кандидаты на замену в билете по формату НЦТ: из пула всего раздела (не одной темы), того же вида и типа.
 * - у вопроса на месте есть метка — берутся вопросы с той же меткой (клоны по типу);
 * - метки нет — берутся вопросы без метки или с ещё не стоящим в билете разрешённым типом;
 * - у вопроса на месте есть сложность — сначала берутся вопросы той же сложности, нет таких — любой сложности;
 * - вопрос из сборника НЦТ меняется на вопрос из сборника НЦТ, обычный — на обычный (anySource снимает ограничение);
 * - byType при метке на месте: подходит любой вопрос с этой меткой, раздел (по теме) не проверяется — вызывающий
 *   передаёт пул всего предмета, чтобы замена шла по типу задания, а не по теме.
 * Остальное — как у candidatesFor: нет в наборе, не связан с вопросами билета.
 */
export function nctCandidatesFor(
  pool: PoolQ[], type: QType, used: Set<string>, ticketOthers: Iterable<string>, links: Map<string, Set<string>>,
  info: NctSlotInfo, typesInTicket: Set<string>, anySource = false, cfg: NctConfig = CHEM_CONFIG, byType = false,
): PoolQ[] {
  if (!info.section) return [];
  const anyTopic = byType && !!info.nctType;
  const fits = pool.filter((q) => {
    if (!anyTopic && sectionOfPoolQ(q, cfg) !== info.section) return false;
    if (info.nctType) { if (q.nct_type !== info.nctType) return false; }
    else if (q.nct_type && (cfg.banned.has(q.nct_type) || typesInTicket.has(q.nct_type))) return false;
    if (!anySource && Boolean(q.isNct) !== info.isNct) return false;
    return true;
  });
  if (info.difficulty) {
    const same = candidatesFor(fits.filter((q) => q.nct_difficulty === info.difficulty), type, used, ticketOthers, links);
    if (same.length) return same;
  }
  return candidatesFor(fits, type, used, ticketOthers, links);
}

/** Ступень, с которой взяты кандидаты замены по типу задания */
export type NctTier = 'same' | 'related' | 'same-wide' | 'related-wide';

/**
 * Замена места с меткой типа — по ступеням: 1) та же метка в темах выбора набора; 2) близкие типы (cfg.related) там же;
 * 3) та же метка во всём предмете; 4) близкие типы во всём предмете. Возвращает первую непустую ступень.
 * scope — темы выбора набора (null — весь предмет: ступени 3–4 совпадают с 1–2 и пропускаются).
 */
export function nctTieredCandidates(
  pool: PoolQ[], type: QType, used: Set<string>, ticketOthers: Iterable<string>, links: Map<string, Set<string>>,
  info: NctSlotInfo, typesInTicket: Set<string>, anySource: boolean, cfg: NctConfig, scope: Set<string> | null,
): { cands: PoolQ[]; tier: NctTier | null } {
  if (!info.nctType) return { cands: [], tier: null };
  const others = [...ticketOthers];
  const same = (list: PoolQ[]) => nctCandidatesFor(list, type, used, others, links, info, typesInTicket, anySource, cfg, true);
  const near = (list: PoolQ[]) => {
    const seen = new Set<string>();
    const out: PoolQ[] = [];
    for (const r of cfg.related?.[info.nctType!] ?? []) {
      for (const q of nctCandidatesFor(list, type, used, others, links, { ...info, nctType: r }, typesInTicket, anySource, cfg, true)) {
        if (!seen.has(q.id)) { seen.add(q.id); out.push(q); }
      }
    }
    return rankFresh(out);
  };
  const inScope = scope ? pool.filter((q) => scope.has(q.topic_id)) : pool;
  const steps: Array<[NctTier, () => PoolQ[]]> = [['same', () => same(inScope)], ['related', () => near(inScope)]];
  if (scope) steps.push(['same-wide', () => same(pool)], ['related-wide', () => near(pool)]);
  for (const [tier, run] of steps) { const c = run(); if (c.length) return { cands: c, tier }; }
  return { cands: [], tier: null };
}

/**
 * Тип задания на позиции — один во всех вариантах (как при создании набора НЦТ). Если на место `slot` выбран вопрос
 * другого типа (`chosen.nct_type` ≠ `slot.nctType`), в остальных вариантах на том же месте (orderIndex, вид) ставятся
 * свободные вопросы этого же типа: сначала из тем выбора набора (`scope`), затем из остальных; реже бравшиеся первыми;
 * не стоящие в наборе и не связанные с вопросами своего варианта. В переставленных наборах (`permuted`) варианты
 * той же чётности — пары: их не трогаем здесь (изменения повторит mirrorChanges). Вариант без подходящего вопроса — в missing.
 */
export function sameTypeElsewhere(
  slots: Slot[], slot: Slot, chosen: PoolQ, pool: PoolQ[], scope: Set<string> | null, links: Map<string, Set<string>>, permuted = false,
): { changes: PlanChange[]; missing: number[] } {
  const type = chosen.nct_type;
  if (!type || type === slot.nctType) return { changes: [], missing: [] };
  const used = new Set<string>(slots.map((s) => s.questionId).filter((x): x is string => !!x));
  used.add(chosen.id);
  const fit = rankFresh(pool.filter((q) => q.type === slot.type && q.nct_type === type && !q.passage_id && !used.has(q.id)));
  const ordered = scope ? [...fit.filter((q) => scope.has(q.topic_id)), ...fit.filter((q) => !scope.has(q.topic_id))] : fit;
  const parity = (n: number) => n % 2;
  const done = new Set<number>(permuted ? [parity(slot.ticketNumber)] : []);
  const targets = slots
    .filter((s) => s.ticketId !== slot.ticketId && s.orderIndex === slot.orderIndex && s.type === slot.type)
    .sort((a, b) => a.ticketNumber - b.ticketNumber);
  const changes: PlanChange[] = [];
  const missing: number[] = [];
  for (const t of targets) {
    if (permuted) { if (done.has(parity(t.ticketNumber))) continue; done.add(parity(t.ticketNumber)); }
    if (t.nctType === type) continue;
    const others = slots.filter((x) => x.ticketId === t.ticketId && x.tqId !== t.tqId && x.questionId).map((x) => x.questionId!);
    const pick = ordered.find((q) => !used.has(q.id) && !clashes(q.id, others, links));
    if (!pick) { missing.push(t.ticketNumber); continue; }
    used.add(pick.id);
    changes.push({ slot: t, question: pick });
  }
  return { changes, missing };
}

// ---------- Убрать тему из набора ----------

export interface PlanChange { slot: Slot; question: PoolQ | null }
export interface RemovalPlan {
  changes: PlanChange[];
  /** Сколько вопросов пришло из каждой темы */
  fromTopic: Record<string, number>;
  /** Сколько мест осталось пустыми, по видам */
  missing: Record<QType, number>;
}

/**
 * Убирает тему из набора: вопросы этой темы во всех билетах заменяются вопросами других тем набора поровну —
 * каждый раз выбирается тема, из которой в билетах стоит меньше всего вопросов. Позиция «вопрос №k этого вида»
 * берётся из одной темы во всех билетах, если в ней хватает свободных вопросов. Чего не хватило — пустое место.
 *
 * slots — все вопросы набора; pool — вопросы оставшихся тем (банк); order — порядок тем при равенстве (по id).
 */
export function planTopicRemoval(slots: Slot[], removedTopicId: string, pool: PoolQ[], topicOrder: string[] = []): RemovalPlan {
  const plan: RemovalPlan = { changes: [], fromTopic: {}, missing: { test: 0, matching: 0, open: 0 } };
  const targets = slots.filter((s) => s.topicId === removedTopicId);
  if (targets.length === 0) return plan;

  const topicIds = [...new Set(slots.map((s) => s.topicId).filter((t): t is string => !!t && t !== removedTopicId))];
  const count = new Map<string, number>(topicIds.map((t) => [t, 0]));
  for (const s of slots) if (s.topicId && count.has(s.topicId)) count.set(s.topicId, count.get(s.topicId)! + 1);

  // Занятые вопросы: все, что стоят в билетах (вопросы убираемой темы освобождаются, но в пуле их и нет)
  const used = new Set<string>(slots.map((s) => s.questionId).filter((x): x is string => !!x));
  const links = buildLinks([...pool, ...slots.filter((s) => s.questionId).map((s) => ({ id: s.questionId!, linked_ids: s.linked }))]);
  const inTicket = new Map<string, Set<string>>(); // ticketId -> id вопросов в билете
  for (const s of slots) {
    if (!s.questionId || s.topicId === removedTopicId) continue;
    if (!inTicket.has(s.ticketId)) inTicket.set(s.ticketId, new Set());
    inTicket.get(s.ticketId)!.add(s.questionId);
  }

  const byTopic = new Map<string, PoolQ[]>();
  for (const q of pool) {
    if (q.topic_id === removedTopicId || !count.has(q.topic_id) || q.passage_id) continue;
    if (!byTopic.has(q.topic_id)) byTopic.set(q.topic_id, []);
    byTopic.get(q.topic_id)!.push(q);
  }
  const ranked = new Map<string, PoolQ[]>([...byTopic].map(([t, l]) => [t, rankFresh(l)]));
  const freeOf = (t: string, type: QType) => (ranked.get(t) ?? []).filter((q) => q.type === type && !used.has(q.id));
  const ord = (t: string) => { const i = topicOrder.indexOf(t); return i < 0 ? 1e9 : i; };

  // Тексты (английский): текст убираемой темы меняется целиком на текст другой темы набора, по одному на билет
  const blockTargets = targets.filter((s) => s.passageId);
  const singleTargets = targets.filter((s) => !s.passageId);
  if (blockTargets.length) {
    const usedP = usedPassageIds(slots);
    const usablePool = pool.filter((q) => q.topic_id !== removedTopicId && count.has(q.topic_id));
    const done = new Set<string>();
    for (const t of [...blockTargets].sort((a, b) => a.ticketNumber - b.ticketNumber || a.orderIndex - b.orderIndex)) {
      if (done.has(t.tqId)) continue;
      const members = blockSlots(slots, slots.indexOf(t)).map((i) => slots[i]);
      for (const m of members) done.add(m.tqId);
      const memberIds = new Set(members.map((m) => m.tqId));
      const others = new Set<string>();
      for (const s of slots) if (s.ticketId === t.ticketId && s.questionId && !memberIds.has(s.tqId) && s.topicId !== removedTopicId) others.add(s.questionId);
      const cands = blockCandidates(usablePool, t.passageKind ?? 'reading', usedP)
        .filter((b) => !b.questions.some((q) => clashes(q.id, others, links)));
      const best = [...cands].sort((a, b) => (count.get(a.topicId)! - count.get(b.topicId)!) || (ord(a.topicId) - ord(b.topicId)))[0] ?? null;
      if (best) {
        usedP.add(best.id);
        for (const q of best.questions) used.add(q.id);
        count.set(best.topicId, count.get(best.topicId)! + best.questions.length);
        plan.fromTopic[best.topicId] = (plan.fromTopic[best.topicId] ?? 0) + best.questions.length;
      }
      const changes = blockSwapChanges(members, best);
      for (const c of changes) if (!c.question) plan.missing.test++;
      plan.changes.push(...changes);
    }
  }

  // Группы: (вид, номер среди вопросов этого вида убираемой темы в билете) — по одной на «позицию» в билетах
  const groups = new Map<string, Slot[]>();
  const rankIn = new Map<string, number>();
  for (const s of [...singleTargets].sort((a, b) => a.ticketNumber - b.ticketNumber || a.orderIndex - b.orderIndex)) {
    const key = `${s.ticketId}:${s.type}`;
    const r = rankIn.get(key) ?? 0;
    rankIn.set(key, r + 1);
    const gk = `${TYPE_ORDER.indexOf(s.type)}:${String(r).padStart(4, '0')}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk)!.push(s);
  }

  for (const gk of [...groups.keys()].sort()) {
    let remaining = groups.get(gk)!;
    const type = remaining[0].type;
    const dead = new Set<string>(); // темы, из которых для этой группы больше взять нечего
    while (remaining.length > 0) {
      const live = topicIds.filter((t) => !dead.has(t) && freeOf(t, type).length > 0);
      if (live.length === 0) break;
      // Тема, которой хватает на всю группу, предпочтительнее; среди них — где в билетах меньше вопросов
      const full = live.filter((t) => freeOf(t, type).length >= remaining.length);
      const from = full.length ? full : live;
      from.sort((a, b) => (count.get(a)! - count.get(b)!) || (freeOf(b, type).length - freeOf(a, type).length) || (ord(a) - ord(b)));
      const topic = from[0];
      const left: Slot[] = [];
      let filled = 0;
      for (const slot of remaining) {
        const others = inTicket.get(slot.ticketId) ?? new Set<string>();
        const pick = freeOf(topic, type).find((q) => !clashes(q.id, others, links));
        if (!pick) { left.push(slot); continue; }
        used.add(pick.id);
        others.add(pick.id);
        inTicket.set(slot.ticketId, others);
        count.set(topic, count.get(topic)! + 1);
        plan.fromTopic[topic] = (plan.fromTopic[topic] ?? 0) + 1;
        plan.changes.push({ slot, question: pick });
        filled++;
      }
      if (filled === 0) dead.add(topic);
      remaining = left;
    }
    for (const slot of remaining) {
      plan.changes.push({ slot, question: null });
      plan.missing[type]++;
    }
  }
  return plan;
}

/**
 * Убрать тему из билетов по формату НЦТ. Каждое место убираемой темы заменяется вопросом, подходящим именно
 * этому месту (nctCandidatesFor: тот же раздел, вид и тип задания, тот же источник — сборник НЦТ или банк),
 * из остальных тем набора; предпочитается тема, из которой в билетах стоит меньше вопросов. Если с тем же
 * источником нет — пробуется любой; нет подходящего вообще — пустое место.
 *
 * slots — все вопросы набора; pool — вопросы остальных тем набора (поле isNct проставляет вызывающий);
 * sectionOf — раздел НЦТ темы по её id (для мест убираемой темы).
 */
export function planNctTopicRemoval(
  slots: Slot[], removedTopicId: string, pool: PoolQ[], sectionOf: (topicId: string) => NctSection | null,
  isNctSource: (sourceId: string | null | undefined) => boolean, topicOrder: string[] = [], cfg: NctConfig = CHEM_CONFIG,
): RemovalPlan {
  const plan: RemovalPlan = { changes: [], fromTopic: {}, missing: { test: 0, matching: 0, open: 0 } };
  const targets = slots.filter((s) => s.topicId === removedTopicId);
  if (targets.length === 0) return plan;

  const topicIds = [...new Set(slots.map((s) => s.topicId).filter((t): t is string => !!t && t !== removedTopicId))];
  const count = new Map<string, number>(topicIds.map((t) => [t, 0]));
  for (const s of slots) if (s.topicId && count.has(s.topicId)) count.set(s.topicId, count.get(s.topicId)! + 1);

  const used = new Set<string>(slots.map((s) => s.questionId).filter((x): x is string => !!x));
  const links = buildLinks([...pool, ...slots.filter((s) => s.questionId).map((s) => ({ id: s.questionId!, linked_ids: s.linked }))]);
  const inTicket = new Map<string, Set<string>>();
  const typesIn = new Map<string, Set<string>>();
  for (const s of slots) {
    if (!s.questionId || s.topicId === removedTopicId) continue;
    if (!inTicket.has(s.ticketId)) inTicket.set(s.ticketId, new Set());
    inTicket.get(s.ticketId)!.add(s.questionId);
    if (s.nctType) {
      if (!typesIn.has(s.ticketId)) typesIn.set(s.ticketId, new Set());
      typesIn.get(s.ticketId)!.add(s.nctType);
    }
  }
  const usable = pool.filter((q) => q.topic_id !== removedTopicId && count.has(q.topic_id));
  const ord = (t: string) => { const i = topicOrder.indexOf(t); return i < 0 ? 1e9 : i; };

  for (const slot of [...targets].sort((a, b) => a.ticketNumber - b.ticketNumber || a.orderIndex - b.orderIndex)) {
    const info: NctSlotInfo = { section: slot.topicId ? cfg.refineSection(sectionOf(slot.topicId), slot.nctType) : null, nctType: slot.nctType ?? null, isNct: isNctSource(slot.sourceId), difficulty: slot.nctDifficulty ?? null };
    const others = inTicket.get(slot.ticketId) ?? new Set<string>();
    const types = typesIn.get(slot.ticketId) ?? new Set<string>();
    let cands = nctCandidatesFor(usable, slot.type, used, others, links, info, types, false, cfg);
    if (cands.length === 0) cands = nctCandidatesFor(usable, slot.type, used, others, links, info, types, true, cfg);
    if (cands.length === 0) {
      plan.changes.push({ slot, question: null });
      plan.missing[slot.type]++;
      continue;
    }
    // из кандидатов — тема, где в билетах меньше вопросов; при равенстве — порядок тем, затем «свежесть»
    const best = [...cands].sort((a, b) => (count.get(a.topic_id)! - count.get(b.topic_id)!) || (ord(a.topic_id) - ord(b.topic_id)))[0];
    used.add(best.id);
    others.add(best.id);
    inTicket.set(slot.ticketId, others);
    if (best.nct_type) { types.add(best.nct_type); typesIn.set(slot.ticketId, types); }
    count.set(best.topic_id, count.get(best.topic_id)! + 1);
    plan.fromTopic[best.topic_id] = (plan.fromTopic[best.topic_id] ?? 0) + 1;
    plan.changes.push({ slot, question: best });
  }
  return plan;
}

// ---------- «Переставленные варианты» (НЦТ) ----------

/** Набор НЦТ с «переставленными вариантами»: варианты одной чётности (1, 3, 5… и 2, 4, 6…) — одни и те же задания */
export const isPermutedBatch = (params: any): boolean => Boolean(params?.nct && params?.nct_perm);

const byOrder = (a: Slot, b: Slot) => a.orderIndex - b.orderIndex;

/**
 * Места-двойники места slot в вариантах той же чётности: где стоит то же задание.
 * Пустое место — k-е пустое место того же вида в другом варианте, если пустых мест этого вида там столько же.
 */
export function twinSlots(slots: Slot[], slot: Slot): Slot[] {
  const tickets = new Map<string, Slot[]>();
  for (const s of slots) {
    if (s.ticketId === slot.ticketId || s.ticketNumber % 2 !== slot.ticketNumber % 2) continue;
    if (!tickets.has(s.ticketId)) tickets.set(s.ticketId, []);
    tickets.get(s.ticketId)!.push(s);
  }
  const out: Slot[] = [];
  if (slot.questionId) {
    for (const list of tickets.values()) { const t = list.find((s) => s.questionId === slot.questionId); if (t) out.push(t); }
    return out;
  }
  const emptyOf = (list: Slot[]) => list.filter((s) => !s.questionId && s.type === slot.type).sort(byOrder);
  const mine = emptyOf(slots.filter((s) => s.ticketId === slot.ticketId));
  const k = mine.findIndex((s) => s.tqId === slot.tqId);
  for (const list of tickets.values()) { const their = emptyOf(list); if (k >= 0 && their.length === mine.length) out.push(their[k]); }
  return out;
}

/** Повторяет каждое изменение на местах-двойниках (то же задание в вариантах той же чётности); места не дублируются */
export function mirrorChanges(slots: Slot[], changes: PlanChange[]): PlanChange[] {
  const out = [...changes];
  const taken = new Set(changes.map((c) => c.slot.tqId));
  for (const c of changes) {
    for (const t of twinSlots(slots, c.slot)) {
      if (taken.has(t.tqId)) continue;
      taken.add(t.tqId);
      out.push({ slot: t, question: c.question });
    }
  }
  return out;
}

/** План снятия темы с повтором на двойниках: итоги (по темам, пустые места) пересчитываются по всем изменениям */
export function mirrorPlan(slots: Slot[], plan: RemovalPlan): RemovalPlan {
  const changes = mirrorChanges(slots, plan.changes);
  const out: RemovalPlan = { changes, fromTopic: {}, missing: { test: 0, matching: 0, open: 0 } };
  for (const c of changes) {
    if (c.question) out.fromTopic[c.question.topic_id] = (out.fromTopic[c.question.topic_id] ?? 0) + 1;
    else out.missing[c.slot.type]++;
  }
  return out;
}

/** Для снятия темы: места этой темы, у которых есть двойник в варианте с меньшим номером, не планируются (их повторит mirrorChanges) */
export function withoutTwins(slots: Slot[], topicId: string): Slot[] {
  return slots.filter((s) => s.topicId !== topicId || !twinSlots(slots, s).some((t) => t.ticketNumber < s.ticketNumber));
}

// ---------- Сборка изменений для базы ----------

export interface RowChange { ticket_question_id: string; question_id: string | null; question_snapshot: any }

/** Снимки для записи: полные вопросы банка (с вариантами и парами) → снимок билета с прежним перемешиванием */
export function buildRowChanges(
  changes: PlanChange[], full: Map<string, any>, shuffle: Pick<Settings, 'shuffleOptions' | 'shuffleMatching'>,
  topicName: (id: string | null) => string | undefined, rnd: () => number = Math.random,
): RowChange[] {
  return changes.map(({ slot, question }) => {
    if (!question) {
      return { ticket_question_id: slot.tqId, question_id: null, question_snapshot: emptySnapshot(slot.type, topicName(slot.topicId)) };
    }
    const q = full.get(question.id);
    if (!q) throw new Error('Вопрос для замены не найден в банке — повторите попытку');
    return { ticket_question_id: slot.tqId, question_id: q.id, question_snapshot: toSnapshot(q, shuffle, rnd) };
  });
}

/** Темы набора с числом вопросов (пустые места не считаются) */
export function topicCounts(slots: Slot[]): Array<{ topicId: string; count: number }> {
  const m = new Map<string, number>();
  for (const s of slots) if (s.topicId && s.questionId) m.set(s.topicId, (m.get(s.topicId) ?? 0) + 1);
  return [...m].map(([topicId, count]) => ({ topicId, count }));
}

const topicSet = (slots: Slot[]) => new Set(slots.filter((s) => s.questionId).map((s) => s.topicId).filter((t): t is string => !!t));

/**
 * Параметры набора после замены. Если набор тем в билетах изменился, темы и главы записываются явно —
 * ровно те, что теперь стоят в билетах (архив покажет актуальный охват). Если не изменился, выбор не трогаем
 * (например, «Весь предмет» остаётся).
 */
export function paramsAfterEdit(params: any, before: Slot[], after: Slot[]): any {
  const a = topicSet(before), b = topicSet(after);
  const same = a.size === b.size && [...a].every((t) => b.has(t));
  const base = { ...(params ?? {}), edited: true };
  if (same) return base;
  const chapters = [...new Set(after.filter((s) => s.questionId).map((s) => s.chapterId).filter((t): t is string => !!t))];
  return { ...base, topic_ids: [...b], chapter_ids: chapters.length ? chapters : params?.chapter_ids ?? [] };
}

/** Применяет изменения к списку мест (локально, без базы) */
export function applyToSlots(slots: Slot[], rows: RowChange[], meta: Map<string, { topicId: string | null; chapterId?: string | null; linked?: string[]; nctType?: string | null; nctDifficulty?: number | null; sourceId?: string | null; passageId?: string | null; passageKind?: PassageKindLite | null }>): Slot[] {
  const byId = new Map(rows.map((r) => [r.ticket_question_id, r]));
  return slots.map((s) => {
    const r = byId.get(s.tqId);
    if (!r) return s;
    const m = r.question_id ? meta.get(r.question_id) : undefined;
    // Пустое место ни к какой теме не относится
    if (!r.question_id) return { ...s, questionId: null, topicId: null, chapterId: null, linked: undefined, nctType: null, nctDifficulty: null, sourceId: null, passageId: null, passageKind: null };
    return { ...s, questionId: r.question_id, topicId: m?.topicId ?? s.topicId, chapterId: m?.chapterId ?? s.chapterId, linked: m?.linked, nctType: m?.nctType ?? null, nctDifficulty: m?.nctDifficulty ?? null, sourceId: m?.sourceId ?? null, passageId: m?.passageId ?? null, passageKind: m?.passageKind ?? null };
  });
}
