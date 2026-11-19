// Тексты к заданиям (английский язык): чтение и текст с пропусками. Вопрос ссылается на текст через questions.passage_id.
// Все запросы терпят базу без таблицы passages (миграция supabase/sql/passages.sql ещё не применена):
// чтение даёт пустой список, запись — понятную ошибку. Экраны других предметов от этого не страдают.
import { supabase } from './supabase';
import type { Passage, PassageKind } from '../types/database';

export const PASSAGE_KIND_LABELS: Record<PassageKind, string> = {
  reading: 'Чтение',
  cloze: 'Пропуски',
};

/** Сколько вопросов в тексте (метки {{1}}…{{8}} в тексте с пропусками) */
export const PASSAGE_QUESTIONS = 8;

const IDS_PER_REQUEST = 100; // идентификаторы идут в адрес запроса

/** Ошибка «таблицы passages нет в базе / не видна API» */
export function isMissingPassages(e: { code?: string; message?: string; details?: string; hint?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST200') return true;
  const text = `${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`;
  return /passages/.test(text) && /does not exist|schema cache|relationship/.test(text);
}

/** Подпись текста: «Чтение: Space Tourism»; с номером вопроса — «Чтение: Space Tourism · № 3» */
export function passageLabel(p: Pick<Passage, 'kind' | 'title'> | null | undefined, order?: number | null): string {
  if (!p) return '';
  const title = (p.title || '').trim() || 'без названия';
  return `${PASSAGE_KIND_LABELS[p.kind]}: ${title}${order ? ` · № ${order}` : ''}`;
}

/** Тексты темы (не удалённые), старые сверху */
export async function fetchPassages(topicId: string): Promise<Passage[]> {
  if (!topicId) return [];
  const { data, error } = await supabase
    .from('passages')
    .select('*')
    .eq('topic_id', topicId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .order('id');
  if (error) {
    if (isMissingPassages(error)) return [];
    throw error;
  }
  return (data || []) as Passage[];
}

/** Тексты по списку id (подписи у вопросов на странице списка) */
export async function fetchPassagesByIds(ids: string[]): Promise<Passage[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: Passage[] = [];
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) {
    const { data, error } = await supabase.from('passages').select('*').in('id', unique.slice(i, i + IDS_PER_REQUEST));
    if (error) {
      if (isMissingPassages(error)) return [];
      throw error;
    }
    out.push(...((data || []) as Passage[]));
  }
  return out;
}

export interface PassageInput {
  id?: string;
  subject_id?: string;
  chapter_id?: string | null;
  topic_id?: string | null;
  source_id?: string | null;
  kind: PassageKind;
  title: string;
  content: string;
  created_by?: string | null;
}

/** Создаёт или правит текст; для нового нужны предмет, глава и тема */
export async function savePassage(p: PassageInput): Promise<Passage> {
  const fields = {
    kind: p.kind,
    title: p.title.trim(),
    content: p.content,
    ...(p.subject_id ? { subject_id: p.subject_id } : {}),
    ...(p.chapter_id !== undefined ? { chapter_id: p.chapter_id } : {}),
    ...(p.topic_id !== undefined ? { topic_id: p.topic_id } : {}),
    ...(p.source_id !== undefined ? { source_id: p.source_id } : {}),
  };
  const q = p.id
    ? supabase.from('passages').update(fields).eq('id', p.id)
    : supabase.from('passages').insert({ ...fields, created_by: p.created_by ?? null });
  const { data, error } = await q.select('*').single();
  if (error) {
    if (isMissingPassages(error)) throw new Error('Тексты ещё не подключены в базе: нужно применить supabase/sql/passages.sql');
    throw error;
  }
  return data as Passage;
}

/** Мягко удаляет тексты вместе с темами, главами или партией импорта; без таблицы passages ничего не делает */
export async function softDeletePassages(by: { topicIds?: string[]; chapterIds?: string[]; batchId?: string }): Promise<void> {
  const mark = (q: any) => q.update({ is_deleted: true }).eq('is_deleted', false);
  const runs: Array<PromiseLike<{ error: any }>> = [];
  if (by.batchId) runs.push(mark(supabase.from('passages')).eq('batch_id', by.batchId));
  for (const [col, list] of [['topic_id', by.topicIds], ['chapter_id', by.chapterIds]] as const) {
    for (let i = 0; i < (list?.length ?? 0); i += IDS_PER_REQUEST) {
      runs.push(mark(supabase.from('passages')).in(col, list!.slice(i, i + IDS_PER_REQUEST)));
    }
  }
  for (const r of await Promise.all(runs)) {
    if (r.error && !isMissingPassages(r.error)) throw r.error;
  }
}
