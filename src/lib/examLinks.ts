import { supabase } from './supabase';
import { fetchAllPages } from './fetchAllPages';
import { buildExamUrl, countAttempts, sortLinks, type AttemptCounts, type AttemptInput } from './examView';

// Билеты классу: запуск набора, список запусков и попытки учеников. Запись — только через RPC и функцию tg-exam.

export const EXAM_LINKS_KEY = ['exam_links'] as const;
export const examAttemptsKey = (code: string) => ['exam_attempts', code] as const;

export interface ExamLink {
  code: string;
  batch_id: string;
  created_by: string;
  created_at: string;
  closes_at: string;
  closed_at: string | null;
  duration_min: number;
  review_sent_at: string | null;
}

export interface ExamLinkRow extends ExamLink {
  batch: { title: string; generation_params: any; subject: { name: string } | null } | null;
  creator: { full_name: string | null; email: string | null } | null;
  counts: AttemptCounts;
}

export type Attempt = AttemptInput & { code: string; started_at: string };

const BOT = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;

/** Ссылка ученика: https://t.me/<бот>?start=exam_<код>. Пустая строка, если имя бота не задано при сборке */
export function examUrl(code: string): string {
  return buildExamUrl(BOT, code);
}

export async function createExamLink(batchId: string): Promise<ExamLink> {
  const { data, error } = await supabase.rpc('exam_link_create', { p_batch_id: batchId });
  if (error) throw error;
  return data as ExamLink;
}

export async function closeExamLink(code: string): Promise<void> {
  const { error } = await supabase.rpc('exam_link_close', { p_code: code });
  if (error) throw error;
}

/** Свои запуски (главный админ — все; фильтрует база), открытые сверху, с названием набора, предметом и числом попыток */
export async function fetchExamLinks(): Promise<ExamLinkRow[]> {
  const { data, error } = await supabase
    .from('exam_links')
    .select('code, batch_id, created_by, created_at, closes_at, closed_at, duration_min, review_sent_at, batch:ticket_batches(title, generation_params, subject:subjects(name)), creator:profiles!created_by(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const links = (data ?? []) as any[];
  const codes = links.map((l) => l.code);
  const byCode = new Map<string, { finished_at: string | null; deadline_at: string }[]>();
  if (codes.length) {
    // id для постраничного чтения — поле id попытки
    const { data: att, error: e2 } = await fetchAllPages<{ id: string; code: string; finished_at: string | null; deadline_at: string }>(
      () => supabase.from('exam_attempts').select('id, code, finished_at, deadline_at').in('code', codes),
    );
    if (e2) throw e2;
    for (const a of att ?? []) {
      const arr = byCode.get(a.code) ?? [];
      arr.push(a);
      byCode.set(a.code, arr);
    }
  }
  const now = Date.now();
  return sortLinks(links.map((l) => ({ ...l, counts: countAttempts(byCode.get(l.code) ?? [], now) })) as ExamLinkRow[], now);
}

/** Попытки одного запуска: имя, аккаунт Telegram, номер билета, баллы */
export async function fetchAttempts(code: string): Promise<Attempt[]> {
  const { data, error } = await supabase
    .from('exam_attempts')
    .select('id, code, student_name, tg_username, tg_name, started_at, deadline_at, finished_at, score, max_score, ticket:tickets(ticket_number)')
    .eq('code', code)
    .order('started_at', { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as unknown as Attempt[];
}

// Описание ошибки из ответа Edge Function ({ error: '...' })
async function functionErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch { /* тело не JSON */ }
  }
  return (error as Error).message;
}

/** Действия преподавателя функции tg-exam. supabase.functions.invoke сам подставляет JWT текущей сессии в Authorization */
export async function callExamTeacher(action: 'link_send' | 'notify_closed', code: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('tg-exam', { body: { action, code } });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(String(data.error));
}
