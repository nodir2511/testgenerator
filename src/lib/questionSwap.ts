// Подбор замен для вопросов в готовом наборе билетов. Чистая логика (без запросов к базе) — тестируется в Node.
// Правила: замена того же вида (тест / соответствие / открытый); вопрос, уже стоящий в любом билете набора,
// не берётся; предпочитаются реже использованные вопросы, затем порядок в сборнике; вопросы, связанные
// друг с другом (тест и открытый вопрос из него), в один билет не попадают.

import { toSnapshot, usageOf, type Settings } from '../../supabase/functions/_shared/ticketing';
import { NCT_BANNED, sectionOfTopic, sectionOfTopicNumber, topicNumber, type NctSection } from '../../supabase/functions/_shared/nct';

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
}

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
  return rankFresh(pool.filter((q) => q.type === type && !used.has(q.id) && !clashes(q.id, others, links)));
}

// ---------- Замена в билете по формату НЦТ ----------

/** Что за место в билете НЦТ: раздел, метка типа и из сборника ли НЦТ стоит вопрос */
export interface NctSlotInfo { section: NctSection | null; nctType: string | null; isNct: boolean; difficulty?: number | null }

/** Раздел НЦТ вопроса по порядку главы и темы (уровни 1–3); null — тема вне режима НЦТ */
export function sectionOfPoolQ(q: Pick<PoolQ, 'chapter' | 'topic'> & { nct_type?: string | null }): NctSection | null {
  const n = topicNumber(Number(q.chapter?.order_index), Number(q.topic?.order_index));
  return sectionOfTopic(n === null ? null : sectionOfTopicNumber(n), q.nct_type);
}

/**
 * Кандидаты на замену в билете по формату НЦТ: из пула всего раздела (не одной темы), того же вида и типа.
 * - у вопроса на месте есть метка — берутся вопросы с той же меткой (клоны по типу);
 * - метки нет — берутся вопросы без метки или с ещё не стоящим в билете разрешённым типом;
 * - у вопроса на месте есть сложность — сначала берутся вопросы той же сложности, нет таких — любой сложности;
 * - вопрос из сборника НЦТ меняется на вопрос из сборника НЦТ, обычный — на обычный (anySource снимает ограничение).
 * Остальное — как у candidatesFor: нет в наборе, не связан с вопросами билета.
 */
export function nctCandidatesFor(
  pool: PoolQ[], type: QType, used: Set<string>, ticketOthers: Iterable<string>, links: Map<string, Set<string>>,
  info: NctSlotInfo, typesInTicket: Set<string>, anySource = false,
): PoolQ[] {
  if (!info.section) return [];
  const fits = pool.filter((q) => {
    if (sectionOfPoolQ(q) !== info.section) return false;
    if (info.nctType) { if (q.nct_type !== info.nctType) return false; }
    else if (q.nct_type && (NCT_BANNED.has(q.nct_type) || typesInTicket.has(q.nct_type))) return false;
    if (!anySource && Boolean(q.isNct) !== info.isNct) return false;
    return true;
  });
  if (info.difficulty) {
    const same = candidatesFor(fits.filter((q) => q.nct_difficulty === info.difficulty), type, used, ticketOthers, links);
    if (same.length) return same;
  }
  return candidatesFor(fits, type, used, ticketOthers, links);
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
    if (q.topic_id === removedTopicId || !count.has(q.topic_id)) continue;
    if (!byTopic.has(q.topic_id)) byTopic.set(q.topic_id, []);
    byTopic.get(q.topic_id)!.push(q);
  }
  const ranked = new Map<string, PoolQ[]>([...byTopic].map(([t, l]) => [t, rankFresh(l)]));
  const freeOf = (t: string, type: QType) => (ranked.get(t) ?? []).filter((q) => q.type === type && !used.has(q.id));
  const ord = (t: string) => { const i = topicOrder.indexOf(t); return i < 0 ? 1e9 : i; };

  // Группы: (вид, номер среди вопросов этого вида убираемой темы в билете) — по одной на «позицию» в билетах
  const groups = new Map<string, Slot[]>();
  const rankIn = new Map<string, number>();
  for (const s of [...targets].sort((a, b) => a.ticketNumber - b.ticketNumber || a.orderIndex - b.orderIndex)) {
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
  isNctSource: (sourceId: string | null | undefined) => boolean, topicOrder: string[] = [],
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
    const info: NctSlotInfo = { section: slot.topicId ? sectionOfTopic(sectionOf(slot.topicId), slot.nctType) : null, nctType: slot.nctType ?? null, isNct: isNctSource(slot.sourceId), difficulty: slot.nctDifficulty ?? null };
    const others = inTicket.get(slot.ticketId) ?? new Set<string>();
    const types = typesIn.get(slot.ticketId) ?? new Set<string>();
    let cands = nctCandidatesFor(usable, slot.type, used, others, links, info, types);
    if (cands.length === 0) cands = nctCandidatesFor(usable, slot.type, used, others, links, info, types, true);
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
export function applyToSlots(slots: Slot[], rows: RowChange[], meta: Map<string, { topicId: string | null; chapterId?: string | null; linked?: string[]; nctType?: string | null; nctDifficulty?: number | null; sourceId?: string | null }>): Slot[] {
  const byId = new Map(rows.map((r) => [r.ticket_question_id, r]));
  return slots.map((s) => {
    const r = byId.get(s.tqId);
    if (!r) return s;
    const m = r.question_id ? meta.get(r.question_id) : undefined;
    // Пустое место ни к какой теме не относится
    if (!r.question_id) return { ...s, questionId: null, topicId: null, chapterId: null, linked: undefined, nctType: null, nctDifficulty: null, sourceId: null };
    return { ...s, questionId: r.question_id, topicId: m?.topicId ?? s.topicId, chapterId: m?.chapterId ?? s.chapterId, linked: m?.linked, nctType: m?.nctType ?? null, nctDifficulty: m?.nctDifficulty ?? null, sourceId: m?.sourceId ?? null };
  });
}
