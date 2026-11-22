import { supabase } from './supabase';
import { fetchAllPages } from './fetchAllPages';
import type { SheetAttempt, StatTicket } from './examStats';
import { buildExamUrl, countAttempts, friendlyReviewError, sortLinks, type AttemptCounts, type AttemptInput } from './examView';

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
  /** Момент старта сессии (с отсчётом); null — преподаватель ещё не нажал «Начать» */
  session_start_at: string | null;
}

export interface ExamLinkRow extends ExamLink {
  batch: { title: string; generation_params: any; subject: { name: string } | null } | null;
  /** Имя автора: только когда его удалось прочитать (главный админ); иначе null */
  creator: { full_name: string | null; email: string | null } | null;
  counts: AttemptCounts;
}

export type Attempt = AttemptInput & { code: string; started_at: string; ticket_id: string | null; lang: string };

// Тот же запасной бот, что в мини-приложении (src/tg/TgApp.tsx)
const BOT = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined) || 'testgenerrepbot';

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

/** «Начать»: старт через несколько секунд у всех сразу, minutes — 5..45; проверяет база. Уже начатая сессия возвращается как есть (duration_min может отличаться) */
export async function startSession(code: string, minutes: number): Promise<ExamLink> {
  const { data, error } = await supabase.rpc('exam_session_start', { p_code: code, p_minutes: minutes });
  if (error) throw error;
  return data as ExamLink;
}

/** Смена варианта ученику до старта сессии */
export async function setAttemptVariant(attemptId: string, ticketId: string): Promise<void> {
  const { error } = await supabase.rpc('exam_attempt_set_variant', { p_attempt_id: attemptId, p_ticket_id: ticketId });
  if (error) throw error;
}

/** Свои запуски (главный админ — все; фильтрует база), открытые сверху, с названием набора, предметом и числом попыток */
export async function fetchExamLinks(withAuthors = false): Promise<ExamLinkRow[]> {
  const { data, error } = await supabase
    .from('exam_links')
    .select('code, batch_id, created_by, created_at, closes_at, closed_at, duration_min, review_sent_at, session_start_at, batch:ticket_batches(title, generation_params, subject:subjects(name))')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const links = (data ?? []) as any[];
  const codes = links.map((l) => l.code);
  const byCode = new Map<string, { finished_at: string | null }[]>();
  if (codes.length) {
    // id для постраничного чтения — поле id попытки
    const { data: att, error: e2 } = await fetchAllPages<{ id: string; code: string; finished_at: string | null }>(
      () => supabase.from('exam_attempts').select('id, code, finished_at').in('code', codes),
    );
    if (e2) throw e2;
    for (const a of att ?? []) {
      const arr = byCode.get(a.code) ?? [];
      arr.push(a);
      byCode.set(a.code, arr);
    }
  }
  // exam_links.created_by ссылается на auth.users, поэтому имена авторов — отдельным запросом к profiles.
  // Сбой не мешает списку: просто без имён
  const authors = new Map<string, { full_name: string | null; email: string | null }>();
  const ids = [...new Set(links.map((l) => l.created_by as string))];
  if (withAuthors && ids.length) {
    try {
      const { data: profs, error: pe } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
      if (!pe) for (const pr of profs ?? []) authors.set(pr.id, { full_name: pr.full_name, email: pr.email });
    } catch { /* имена не обязательны */ }
  }
  const now = Date.now();
  return sortLinks(links.map((l) => ({ ...l, creator: authors.get(l.created_by) ?? null, counts: countAttempts(byCode.get(l.code) ?? [], now, l) })) as ExamLinkRow[], now);
}

/** Попытки одного запуска: имя, аккаунт Telegram, номер билета, баллы */
export async function fetchAttempts(code: string): Promise<Attempt[]> {
  const { data, error } = await supabase
    .from('exam_attempts')
    .select('id, code, ticket_id, lang, student_name, tg_username, tg_name, started_at, finished_at, score, max_score, ticket:tickets(ticket_number)')
    .eq('code', code)
    .order('started_at', { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as unknown as Attempt[];
}

export const examAttemptsFullKey = (code: string) => ['exam_attempts_full', code] as const;
export const examTicketsKey = (batchId: string) => ['exam_tickets', batchId] as const;
export type AttemptWithAnswers = SheetAttempt & { id: string; code: string };

export const examTicketNumbersKey = (batchId: string) => ['exam_ticket_numbers', batchId] as const;

/** Номера билетов набора, без снимков вопросов — для выбора варианта в зале ожидания */
export async function fetchExamTicketNumbers(batchId: string): Promise<Array<{ id: string; ticket_number: number }>> {
  const { data, error } = await supabase
    .from('tickets')
    .select('id, ticket_number')
    .eq('batch_id', batchId)
    .order('ticket_number')
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; ticket_number: number }>;
}

/** Билеты набора со снимками вопросов — для разбора по вопросам (читает автор набора или главный админ) */
export async function fetchExamTickets(batchId: string): Promise<StatTicket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('id, ticket_number, questions:ticket_questions(id, order_index, question_id, question_snapshot)')
    .eq('batch_id', batchId)
    .order('ticket_number')
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map((t: any) => ({
    id: t.id,
    ticket_number: t.ticket_number,
    questions: [...(t.questions ?? [])].sort((a: any, b: any) => a.order_index - b.order_index),
  }));
}

/** Попытки запуска вместе с ответами — для разбора и Excel */
export async function fetchAttemptsWithAnswers(code: string): Promise<AttemptWithAnswers[]> {
  const { data, error } = await fetchAllPages<AttemptWithAnswers>(
    () => supabase.from('exam_attempts').select('id, code, ticket_id, student_name, tg_username, tg_name, finished_at, score, max_score, answers').eq('code', code),
  );
  if (error) throw error;
  return data ?? [];
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
export class NotLinkedError extends Error {}

export async function callExamTeacher(action: 'link_send' | 'notify_closed', code: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('tg-exam', { body: { action, code } });
  let msg = '';
  if (error) msg = await functionErrorMessage(error);
  else if (data?.error) msg = String(data.error);
  if (!msg) return;
  throw /Привяжите Telegram/.test(msg) ? new NotLinkedError(msg) : new Error(msg);
}

/** Рассылка разбора сдавшим ученикам (только для закрытого запуска). Ответ сервера: { sent, failed } */
export async function sendReview(code: string): Promise<{ sent: number; failed: number }> {
  const { data, error } = await supabase.functions.invoke('tg-exam', { body: { action: 'review_send', code } });
  let msg = '';
  if (error) msg = await functionErrorMessage(error);
  else if (data?.error) msg = String(data.error);
  if (msg) throw new Error(friendlyReviewError(msg, (error as { context?: Response } | null)?.context?.status));
  return { sent: Number(data?.sent ?? 0), failed: Number(data?.failed ?? 0) };
}
