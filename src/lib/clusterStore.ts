import { supabase } from './supabase';
import { fetchAllPages } from './fetchAllPages';
import { CLUSTER_SLOTS, type ClusterSettings, type ClusterVariant } from './clusterExport';

// Хранение экзамена-кластера в «Сохранённых билетах»: обычная партия (ticket_batches) с пометкой
// generation_params.source = 'cluster'. Вариант = билет; вопросы лежат снимками с полем cluster_slot
// (номер предмета в книжке). Видит и создаёт такие партии только главный админ (см. supabase/sql/cluster_batches.sql).

export const isClusterBatch = (b: { generation_params?: any }) => b?.generation_params?.source === 'cluster';

interface SaveArgs {
  settings: ClusterSettings;
  variants: ClusterVariant[];
  /** Предмет базы для каждого места в книжке (в порядке CLUSTER_SLOTS) */
  subjectIds: string[];
}

export async function saveClusterBatch({ settings, variants, subjectIds }: SaveArgs): Promise<string> {
  const active = CLUSTER_SLOTS.map((slot, i) => ({ slot, i })).filter(({ i }) => variants[0]?.subjects[i] != null);
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
      CLUSTER_SLOTS.forEach((_, s) => {
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
export function clusterVariantsFromBatch(tickets: any[]): ClusterVariant[] {
  return [...tickets]
    .sort((a, b) => a.ticket_number - b.ticket_number)
    .map((t) => {
      const subjects: Array<any[] | null> = CLUSTER_SLOTS.map(() => null);
      [...(t.questions || [])]
        .sort((a: any, b: any) => a.order_index - b.order_index)
        .forEach((tq: any) => {
          const s = tq.question_snapshot?.cluster_slot;
          if (typeof s !== 'number' || s < 0 || s >= CLUSTER_SLOTS.length) return;
          (subjects[s] ??= []).push(tq.question_snapshot);
        });
      return { number: t.ticket_number, subjects };
    });
}

/** Идентификаторы вопросов, уже вошедших в сохранённые экзамены-кластеры (видит только главный админ) */
export async function loadUsedQuestionIds(): Promise<Set<string>> {
  const used = new Set<string>();
  const { data: batches, error } = await supabase.from('ticket_batches').select('id, generation_params');
  if (error) throw error;
  const batchIds = (batches || []).filter((b: any) => isClusterBatch(b)).map((b: any) => b.id as string);
  for (let i = 0; i < batchIds.length; i += 40) {
    const { data: tickets, error: tErr } = await supabase.from('tickets').select('id').in('batch_id', batchIds.slice(i, i + 40));
    if (tErr) throw tErr;
    const ticketIds = (tickets || []).map((t: any) => t.id as string);
    for (let j = 0; j < ticketIds.length; j += 40) {
      const { data, error: qErr } = await fetchAllPages<any>(() =>
        supabase.from('ticket_questions').select('id, question_id').in('ticket_id', ticketIds.slice(j, j + 40)));
      if (qErr) throw qErr;
      (data || []).forEach((r: any) => { if (r.question_id) used.add(r.question_id); });
    }
  }
  return used;
}
