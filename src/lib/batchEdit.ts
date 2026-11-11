// Работа с базой при замене вопросов в готовом наборе: загрузка мест, пула и запись изменений.
import { supabase } from './supabase';
import { loadLightPool, QUESTION_FULL_SELECT } from '../../supabase/functions/_shared/pool';
import type { Slot, QType, PoolQ, RowChange } from './questionSwap';

const chunk = <T,>(a: T[], n: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n));
  return r;
};

export interface EditTicketQuestion { id: string; order_index: number; question_id: string | null; question_snapshot: any }
export interface EditTicket { id: string; ticket_number: number; questions: EditTicketQuestion[] }

export interface BatchSlots { tickets: EditTicket[]; slots: Slot[] }

/** Билеты набора с идентификаторами мест и темами вопросов */
export async function fetchBatchSlots(batchId: string): Promise<BatchSlots> {
  const { data, error } = await supabase
    .from('tickets')
    .select('id, ticket_number, questions:ticket_questions(id, order_index, question_id, question_snapshot)')
    .eq('batch_id', batchId)
    .order('ticket_number');
  if (error) throw error;
  const tickets: EditTicket[] = (data || []).map((t: any) => ({
    id: t.id,
    ticket_number: t.ticket_number,
    questions: [...(t.questions || [])].sort((a: any, b: any) => a.order_index - b.order_index),
  }));

  const ids = [...new Set(tickets.flatMap((t) => t.questions.map((q) => q.question_id)).filter((x): x is string => !!x))];
  const meta = new Map<string, { topic_id: string | null; chapter_id: string | null; linked_ids: string[] | null }>();
  for (const part of chunk(ids, 100)) {
    const { data: rows, error: e } = await supabase.from('questions').select('id, topic_id, chapter_id, linked_ids').in('id', part);
    if (e) throw e;
    for (const r of rows ?? []) meta.set(r.id, r as any);
  }

  const slots: Slot[] = tickets.flatMap((t) =>
    t.questions.map((q) => {
      const m = q.question_id ? meta.get(q.question_id) : undefined;
      return {
        tqId: q.id,
        ticketId: t.id,
        ticketNumber: t.ticket_number,
        orderIndex: q.order_index,
        questionId: q.question_id,
        type: (q.question_snapshot?.type ?? 'test') as QType,
        topicId: m?.topic_id ?? null,
        chapterId: m?.chapter_id ?? null,
        linked: m?.linked_ids ?? [],
      };
    }),
  );
  return { tickets, slots };
}

export interface TopicInfo { id: string; name: string; chapterId: string; chapterName: string; chapterOrder: number; order: number }

/** Все темы предмета (для названий и выбора темы замены) */
export async function fetchTopicInfos(subjectId: string): Promise<TopicInfo[]> {
  const { data, error } = await supabase
    .from('chapters')
    .select('id, name, order_index, topics(id, name, order_index, is_deleted)')
    .eq('subject_id', subjectId)
    .eq('is_deleted', false)
    .order('order_index');
  if (error) throw error;
  return (data || []).flatMap((c: any) =>
    (c.topics || [])
      .filter((t: any) => !t.is_deleted)
      .map((t: any) => ({ id: t.id, name: t.name, chapterId: c.id, chapterName: c.name, chapterOrder: c.order_index, order: t.order_index })),
  ).sort((a: TopicInfo, b: TopicInfo) => a.chapterOrder - b.chapterOrder || a.order - b.order);
}

/** Лёгкий пул вопросов тем (для подбора) */
export async function fetchTopicPool(subjectId: string, topicIds: string[]): Promise<PoolQ[]> {
  if (!topicIds.length) return [];
  return (await loadLightPool(supabase, { subjectId, chapterIds: [], topicIds })) as PoolQ[];
}

/** Полные вопросы по id (с вариантами и парами) */
export async function fetchFullQuestions(ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  await Promise.all(chunk([...new Set(ids)], 100).map(async (part) => {
    const { data, error } = await supabase.from('questions').select(QUESTION_FULL_SELECT).in('id', part);
    if (error) throw error;
    for (const q of data ?? []) out.set(q.id, q);
  }));
  return out;
}

/** Запись изменений одной транзакцией (см. supabase/sql/update_batch_questions.sql) */
export async function saveBatchChanges(batchId: string, rows: RowChange[], params: any): Promise<void> {
  const { error } = await supabase.rpc('update_batch_questions', { p_batch_id: batchId, p_changes: rows, p_params: params });
  if (error) throw error;
}
