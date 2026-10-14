import { supabase } from './supabase';
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
  userId: string | undefined;
}

export async function saveClusterBatch({ settings, variants, subjectIds, userId }: SaveArgs): Promise<string> {
  const active = CLUSTER_SLOTS.map((slot, i) => ({ slot, i })).filter(({ i }) => variants[0]?.subjects[i] != null);
  if (active.length === 0) throw new Error('Нет предметов для сохранения');

  const first = variants[0];
  const typeCount = (t: string) => active.reduce((n, { i }) => n + first.subjects[i]!.filter((q) => q.type === t).length, 0);
  const title = `Кластер ${settings.code}-${settings.exam}`;

  const { data: batch, error: bErr } = await supabase
    .from('ticket_batches')
    .insert({
      title,
      subject_id: subjectIds[active[0].i],
      created_by: userId,
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
    })
    .select()
    .single();
  if (bErr || !batch) throw bErr || new Error('Не удалось создать партию');

  try {
    const { data: saved, error: tErr } = await supabase
      .from('tickets')
      .insert(variants.map((v) => ({ batch_id: batch.id, ticket_number: v.number })))
      .select();
    if (tErr || !saved || saved.length !== variants.length) throw tErr || new Error('Не все варианты были сохранены');
    const idByNumber = new Map<number, string>(saved.map((t: any) => [t.ticket_number, t.id]));

    const rows: any[] = [];
    for (const v of variants) {
      let order = 0;
      CLUSTER_SLOTS.forEach((_, s) => {
        (v.subjects[s] || []).forEach((q) => {
          rows.push({
            ticket_id: idByNumber.get(v.number),
            question_id: q.id ?? null,
            order_index: ++order,
            question_snapshot: { ...q, cluster_slot: s },
          });
        });
      });
    }
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('ticket_questions').insert(rows.slice(i, i + 200));
      if (error) throw error;
    }
  } catch (e) {
    await supabase.from('ticket_batches').delete().eq('id', batch.id);
    throw e;
  }
  return batch.id;
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
