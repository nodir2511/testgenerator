import { saveAs } from 'file-saver';
import { supabase } from './supabase';
import { buildAnswerKeyDocx, keyKindOf, selectionInfo, type KeyTicket } from './answerKey';

// Скачивание ключей ответов (Word по шаблону предмета) для созданных билетов.
// Старые сохранённые билеты не хранят верные ответы в снимке — они подгружаются из банка вопросов.

const chunk = <T,>(a: T[], n: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n));
  return r;
};

const needsAnswers = (snap: any) =>
  (snap.type === 'test' && (snap.options || []).some((o: any) => !('is_correct' in o))) ||
  (snap.type === 'matching' && (snap.matching_items || []).some((m: any) => m.side === 'left' && !('correct_match_id' in m))) ||
  (snap.type === 'open' && !('correct_numeric_answer' in snap));

async function enrich(tickets: KeyTicket[]): Promise<KeyTicket[]> {
  const snaps = tickets.flatMap((t) => t.questions.map((q) => q.question_snapshot)).filter(Boolean);
  const stale = snaps.filter(needsAnswers);
  if (!stale.length) return tickets;

  const optCorrect = new Map<string, boolean>();
  const matchTarget = new Map<string, string | null>();
  const numeric = new Map<string, number | null>();

  for (const ids of chunk([...new Set(stale.map((s: any) => s.id as string))], 100)) {
    const [opts, items, qs] = await Promise.all([
      supabase.from('question_options').select('id, is_correct').in('question_id', ids),
      supabase.from('matching_items').select('id, correct_match_id').in('question_id', ids),
      supabase.from('questions').select('id, correct_numeric_answer').in('id', ids),
    ]);
    for (const e of [opts.error, items.error, qs.error]) if (e) throw e;
    opts.data?.forEach((o: any) => optCorrect.set(o.id, !!o.is_correct));
    items.data?.forEach((m: any) => matchTarget.set(m.id, m.correct_match_id ?? null));
    qs.data?.forEach((q: any) => numeric.set(q.id, q.correct_numeric_answer ?? null));
  }

  return tickets.map((t) => ({
    ...t,
    questions: t.questions.map((q) => {
      const s = q.question_snapshot;
      if (!s || !needsAnswers(s)) return q;
      return {
        ...q,
        question_snapshot: {
          ...s,
          options: s.options?.map((o: any) => ('is_correct' in o ? o : { ...o, is_correct: optCorrect.get(o.id) ?? false })),
          matching_items: s.matching_items?.map((m: any) =>
            m.side === 'left' && !('correct_match_id' in m) ? { ...m, correct_match_id: matchTarget.get(m.id) ?? null } : m),
          correct_numeric_answer: 'correct_numeric_answer' in s ? s.correct_numeric_answer : numeric.get(s.id) ?? null,
        },
      };
    }),
  }));
}

export function hasKeyTemplate(subjectName: string): boolean {
  return keyKindOf(subjectName) !== null;
}

// Какие главы и темы вошли в билеты — для шапки ключей; при ошибке шапка остаётся как в шаблоне
async function loadSelectionInfo(subjectId: string, params: any): Promise<string | null> {
  try {
    const chapters = await supabase.from('chapters').select('id, order_index').eq('subject_id', subjectId).eq('is_deleted', false);
    if (chapters.error || !chapters.data?.length) return null;
    const topics = await supabase.from('topics').select('id, chapter_id, order_index').in('chapter_id', chapters.data.map((c: any) => c.id)).eq('is_deleted', false);
    if (topics.error) return null;
    return selectionInfo(chapters.data, topics.data ?? [], params?.chapter_ids ?? [], params?.topic_ids ?? []);
  } catch {
    return null;
  }
}

export async function exportAnswerKey(
  title: string, tickets: KeyTicket[], subjectName: string,
  /** Предмет и выбор глав/тем партии (subject_id + generation_params) — для шапки ключей */
  selection?: { subjectId?: string | null; params?: any },
): Promise<{ missing: number; overflow: number }> {
  const kind = keyKindOf(subjectName);
  if (!kind) throw new Error('Для этого предмета нет шаблона ключей');
  const res = await fetch(`/key-templates/${kind}.docx`);
  if (!res.ok) throw new Error('Не удалось загрузить шаблон ключей');
  const template = await res.arrayBuffer();
  const sorted = [...tickets].sort((a, b) => a.ticket_number - b.ticket_number);
  const info = selection?.subjectId ? await loadSelectionInfo(selection.subjectId, selection.params) : null;
  const { bytes, stats } = await buildAnswerKeyDocx(template, await enrich(sorted), info);
  const safe = title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || 'Билеты';
  saveAs(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `Ключи – ${safe}.docx`);
  return stats;
}
