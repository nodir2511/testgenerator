import { supabase } from './supabase';
import { fetchAllPages } from './fetchAllPages';
import { CLUSTER_SUBJECTS, LEGACY_KINDS, type ClusterKind, type ClusterSettings } from './clusterSlots';
import type { ClusterVariant } from './clusterExport';

// Хранение экзамена-кластера в «Сохранённых билетах»: обычная партия (ticket_batches) с пометкой
// generation_params.source = 'cluster'. Вариант = билет; вопросы лежат снимками с полем cluster_slot
// (номер предмета в книжке). Видит и создаёт такие партии только главный админ (см. supabase/sql/cluster_batches.sql).

export const isClusterBatch = (b: { generation_params?: any }) => b?.generation_params?.source === 'cluster';

interface SaveArgs {
  settings: ClusterSettings;
  variants: ClusterVariant[];
  /** Предмет базы для каждого места в книжке (по порядку variants[i].kinds) */
  subjectIds: string[];
}

export async function saveClusterBatch({ settings, variants, subjectIds }: SaveArgs): Promise<string> {
  const kinds = variants[0]?.kinds ?? LEGACY_KINDS;
  const active = kinds.map((kind, i) => ({ slot: CLUSTER_SUBJECTS[kind], i })).filter(({ i }) => variants[0]?.subjects[i] != null);
  if (active.length === 0) throw new Error('Нет предметов для сохранения');

  const first = variants[0];
  const typeCount = (t: string) => active.reduce((n, { i }) => n + first.subjects[i]!.filter((q) => q.type === t).length, 0);
  const title = `Кластер ${settings.code}-${settings.exam}`;

  // Одной транзакцией (supabase/sql/save_ticket_batch.sql): при ошибке ничего не остаётся
  const { data, error } = await supabase.rpc('save_ticket_batch', {
    p_batch: {
      title,
      subject_id: subjectIds[active[0].i],
      generation_params: {
        source: 'cluster',
        ticket_count: variants.length,
        test_count: typeCount('test'),
        matching_count: typeCount('matching'),
        open_count: typeCount('open'),
        cluster: {
          settings,
          subjects: active.map(({ slot, i }) => ({ slot: i, kind: slot.kind, name: slot.name, subject_id: subjectIds[i], count: first.subjects[i]!.length })),
        },
      },
    },
    p_tickets: variants.map((v) => {
      const questions: any[] = [];
      kinds.forEach((_, s) => {
        (v.subjects[s] || []).forEach((q) => {
          questions.push({ question_id: q.id ?? null, order_index: questions.length + 1, question_snapshot: { ...q, cluster_slot: s } });
        });
      });
      return { ticket_number: v.number, questions };
    }),
  });
  if (error || !data) throw error || new Error('Не удалось сохранить экзамен');
  return (data as any).batch.id;
}

/** Варианты книжки из сохранённой партии: вопросы по предметам в порядке книжки */
export function clusterVariantsFromBatch(tickets: any[], params?: any): ClusterVariant[] {
  // Предметы книжки записаны в параметрах партии (место, вид); у старых партий записи нет — тогда прежние четыре
  const saved: Array<{ slot: number; kind: ClusterKind }> = params?.cluster?.subjects ?? [];
  const kinds: ClusterKind[] = [...LEGACY_KINDS];
  for (const x of saved) if (typeof x.slot === 'number' && x.slot >= 0 && x.slot < 4 && CLUSTER_SUBJECTS[x.kind]) kinds[x.slot] = x.kind;
  return [...tickets]
    .sort((a, b) => a.ticket_number - b.ticket_number)
    .map((t) => {
      const subjects: Array<any[] | null> = kinds.map(() => null);
      [...(t.questions || [])]
        .sort((a: any, b: any) => a.order_index - b.order_index)
        .forEach((tq: any) => {
          const s = tq.question_snapshot?.cluster_slot;
          if (typeof s !== 'number' || s < 0 || s >= kinds.length) return;
          (subjects[s] ??= []).push(tq.question_snapshot);
        });
      return { number: t.ticket_number, kinds, subjects };
    });
}

/** Идентификаторы вопросов, уже вошедших в сохранённые экзамены-кластеры (видит только главный админ) */
export async function loadUsedQuestionIds(): Promise<Set<string>> {
  const used = new Set<string>();
  // Только партии-кластеры (фильтр в базе), без параметров остальных наборов
  const { data: batches, error } = await supabase.from('ticket_batches').select('id').eq('generation_params->>source', 'cluster');
  if (error) throw error;
  const batchIds = (batches || []).map((b: any) => b.id as string);
  // Вопросы билетов этих партий — одним запросом через связь с билетами (по 40 партий, пачки параллельно)
  const chunks: string[][] = [];
  for (let i = 0; i < batchIds.length; i += 40) chunks.push(batchIds.slice(i, i + 40));
  const results = await Promise.all(chunks.map((ids) => fetchAllPages<any>(() =>
    supabase.from('ticket_questions').select('id, question_id, ticket:tickets!inner(batch_id)').in('ticket.batch_id', ids))));
  for (const r of results) {
    if (r.error) throw r.error;
    (r.data || []).forEach((row: any) => { if (row.question_id) used.add(row.question_id); });
  }
  return used;
}
