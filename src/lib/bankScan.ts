import { supabase } from './supabase';
import { fetchAllPages } from './fetchAllPages';
import { questionIssues, ISSUE_LABELS, type IssueCode } from './questionIssues';
import { contentChecks, checkInputFromBank, CHECK_LABELS, plainText, type CheckCode } from './questionChecks';
import type { DupDoc } from './duplicates';

// Загрузка вопросов предмета и проверка качества (только для главного админа, раздел «Качество банка»).

export interface BankQ {
  id: string;
  type: string;
  num?: number | null;
  content: string;
  content_ru?: string | null;
  content_tg?: string | null;
  image_url?: string | null;
  correct_numeric_answer?: number | null;
  chapter?: { name: string } | null;
  topic?: { name: string } | null;
  options?: Array<{ id: string; text: string; text_ru?: string | null; text_tg?: string | null; image_url?: string | null; is_correct?: boolean }> | null;
  matching_items?: Array<{ id: string; side: 'left' | 'right'; text: string; text_ru?: string | null; text_tg?: string | null; image_url?: string | null; correct_match_id?: string | null }> | null;
}

const SELECT = `
  id, type, num, content, content_ru, content_tg, image_url, correct_numeric_answer,
  chapter:chapters(name), topic:topics(name),
  options:question_options(*), matching_items:matching_items(*)`;

export async function loadBankQuestions(subjectId: string): Promise<BankQ[]> {
  const { data, error } = await fetchAllPages<BankQ>(() =>
    supabase.from('questions').select(SELECT).eq('subject_id', subjectId).eq('is_deleted', false));
  if (error) throw error;
  return data ?? [];
}

/** Вопрос банка → документ для поиска дублей: русский и таджикский тексты считаются отдельно */
export function bankDupDoc(q: BankQ): DupDoc {
  const opts = (pick: (o: { text: string; text_ru?: string | null; text_tg?: string | null }) => string | null | undefined) => [
    ...(q.options ?? []).map(pick),
    ...(q.matching_items ?? []).map(pick),
  ].filter((t): t is string => !!t);
  const variants = [{ content: q.content, options: opts((o) => o.text) }];
  if (q.content_ru && q.content_ru !== q.content) variants.push({ content: q.content_ru, options: opts((o) => o.text_ru || o.text) });
  if (q.content_tg && q.content_tg !== q.content) variants.push({ content: q.content_tg, options: opts((o) => o.text_tg || o.text) });
  return { id: q.id, variants, answer: q.type === 'open' && q.correct_numeric_answer != null ? String(q.correct_numeric_answer) : null };
}

export type AnyIssue = IssueCode | CheckCode;
export const ANY_LABELS: Record<AnyIssue, string> = { ...ISSUE_LABELS, ...CHECK_LABELS };

export function bankIssues(q: BankQ): AnyIssue[] {
  return [...questionIssues(q), ...contentChecks(checkInputFromBank(q))];
}

export const snippet = (s: string | null | undefined, n = 140) => {
  const t = plainText(s);
  return t.length > n ? `${t.slice(0, n)}…` : t || '(без текста)';
};
