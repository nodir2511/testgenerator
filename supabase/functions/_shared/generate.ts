// Общая генерация билетов для telegram-bot (чат) и tg-app (Mini App):
// подбор вопросов, сохранение партии, сборка Word/ZIP и отправка файла в чат.

import JSZip from 'npm:jszip@3';
import { buildSingleTicketBlob } from './docxExport.ts';
import { buildAnswerKeyDocx, keyKindOf, selectionInfo } from './answerKey.ts';
import { KEY_TEMPLATES } from './keyTemplates.ts';
import * as T from './ticketing.ts';

export type Lang = 'ru' | 'tg' | 'both';

export interface Selection {
  subjectId: string;
  chapterIds: string[];
  topicIds: string[]; // [] = все вопросы выбранных глав
}

// Профиль привязанного аккаунта по chat_id; null — не привязан или заблокирован
export async function linkedUser(sb: any, chat: number) {
  const { data: link } = await sb.from('telegram_links').select('user_id').eq('chat_id', chat).maybeSingle();
  if (!link) return null;
  const { data: au } = await sb.auth.admin.getUserById(link.user_id);
  const bannedUntil = (au?.user as { banned_until?: string | null } | undefined)?.banned_until;
  if (!au?.user || (bannedUntil && new Date(bannedUntil).getTime() > Date.now())) return null;
  const { data: profile } = await sb.from('profiles').select('id, full_name, email, role').eq('id', link.user_id).maybeSingle();
  return profile ?? null;
}

// Лимиты Telegram: администраторы работают с обычными лимитами сайта
export type Limits = { perType: number; tickets: number; total?: number; perDay: number };
export function limitsFor(user: { role?: string }): Limits {
  return user.role === 'admin' ? { ...T.LIMITS, perDay: Infinity } : { ...T.TG_LIMITS };
}

// Начало текущих суток по времени Таджикистана (UTC+5)
function dayStartIso(): string {
  const shift = 5 * 3600 * 1000;
  const local = Date.now() + shift;
  return new Date(local - (local % 86400000) - shift).toISOString();
}

async function dailyLimitError(sb: any, user: { id: string; role?: string }): Promise<string | null> {
  const perDay = limitsFor(user).perDay;
  if (!Number.isFinite(perDay)) return null;
  const { count } = await sb.from('ticket_batches').select('*', { count: 'exact', head: true })
    .eq('created_by', user.id).gte('created_at', dayStartIso());
  return (count ?? 0) >= perDay ? `Дневной лимит исчерпан: ${perDay} генераций в сутки. Попробуйте завтра.` : null;
}

export async function loadPool(sb: any, sel: Selection) {
  const all: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from('questions')
      .select('*, chapter:chapters(name, order_index), topic:topics(name, order_index), options:question_options(*), matching_items:matching_items(*)')
      .eq('subject_id', sel.subjectId).eq('is_deleted', false).order('id');
    if (sel.topicIds.length) q = q.in('topic_id', sel.topicIds);
    else q = q.in('chapter_id', sel.chapterIds);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

// Какие главы и темы выбраны (для шапки вариантов и ключей); при ошибке — без описания
async function loadSelectionInfos(sb: any, sel: Selection): Promise<{ ru: string | null; tg: string | null }> {
  try {
    const { data: chs } = await sb.from('chapters').select('id, order_index').eq('subject_id', sel.subjectId).eq('is_deleted', false);
    const { data: tps } = await sb.from('topics').select('id, chapter_id, order_index').in('chapter_id', (chs ?? []).map((c: any) => c.id)).eq('is_deleted', false);
    return {
      ru: selectionInfo(chs ?? [], tps ?? [], sel.chapterIds, sel.topicIds, 'ru'),
      tg: selectionInfo(chs ?? [], tps ?? [], sel.chapterIds, sel.topicIds, 'tg'),
    };
  } catch (e) {
    console.error('selection info failed', e);
    return { ru: null, tg: null };
  }
}

// Все вопросы глав, в которых что-то выбрано: нужны, чтобы посчитать охват главы
export async function loadChapterTotals(sb: any, subjectId: string, pool: any[]): Promise<T.ChapterTotals> {
  const ids = [...new Set(pool.map((q) => q.chapter_id).filter(Boolean))];
  if (!ids.length) return {};
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('questions').select('chapter_id, type')
      .eq('subject_id', subjectId).eq('is_deleted', false).in('chapter_id', ids).order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return T.chapterTotals(rows);
}

async function sendDocument(botToken: string, chat: number, bytes: Uint8Array, filename: string, caption: string) {
  const form = new FormData();
  form.append('chat_id', String(chat));
  form.append('caption', caption);
  form.append('document', new Blob([bytes]), filename);
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Не удалось отправить файл: ${json.description || res.status}`);
}

export async function generateAndSend(opts: {
  sb: any;
  botToken: string;
  chat: number;
  user: { id: string; role?: string };
  sel: Selection;
  settings: T.Settings;
  lang: Lang;
  source: 'telegram' | 'telegram-app';
  /** Вызывается, если вопросов не хватает и состав билета урезан */
  onNotes?: (notes: string[]) => Promise<void>;
}): Promise<{ missingAnswers: number; keySent: boolean }> {
  const { sb, botToken, chat, user, sel, settings: s, lang, source } = opts;
  const bad = T.checkSettings(s, limitsFor(user));
  if (bad) throw new Error(bad);
  const dayErr = await dailyLimitError(sb, user);
  if (dayErr) throw new Error(dayErr);

  // Одна генерация на пользователя одновременно (защита от двойного нажатия)
  const { data: gotLock } = await sb.rpc('acquire_generation_lock', { p_user: user.id, p_ttl_seconds: 180 });
  if (gotLock === false) throw new Error('Предыдущая генерация ещё выполняется. Подождите минуту.');
  try {
    return await run();
  } finally {
    await sb.from('generation_locks').delete().eq('user_id', user.id);
  }

  async function run() {

  const pool = await loadPool(sb, sel);
  const fit = T.fitSettings(T.poolStats(pool), s);
  if (fit.error) throw new Error(fit.error);
  if (fit.notes.length && opts.onNotes) await opts.onNotes(fit.notes);

  const totals = await loadChapterTotals(sb, sel.subjectId, pool);
  const tickets = T.buildTickets(pool, fit.settings, Math.random, totals);
  const title = s.title.trim() || 'Экзаменационные билеты';
  const { data: subj } = await sb.from('subjects').select('name').eq('id', sel.subjectId).maybeSingle();
  const subjectName = subj?.name ?? 'Химия';

  const { data: batch, error: bErr } = await sb.from('ticket_batches').insert({
    title, subject_id: sel.subjectId, created_by: user.id,
    generation_params: {
      chapter_ids: sel.chapterIds, topic_ids: sel.topicIds,
      test_count: fit.settings.testCount, matching_count: fit.settings.matchingCount, open_count: fit.settings.openCount, ticket_count: s.ticketCount,
      shuffle_options: s.shuffleOptions, shuffle_matching: s.shuffleMatching, source, lang,
      requested: { test: s.testCount, matching: s.matchingCount, open: s.openCount },
    },
  }).select().single();
  if (bErr || !batch) throw bErr ?? new Error('Не удалось сохранить партию');

  for (const t of tickets) {
    const { data: ticket, error: tErr } = await sb.from('tickets').insert({ batch_id: batch.id, ticket_number: t.ticketNumber }).select().single();
    if (tErr || !ticket) throw tErr ?? new Error('Не удалось сохранить билет');
    const rows = t.questions.map((q: any) => ({ ticket_id: ticket.id, question_id: q.question_id, order_index: q.order_index, question_snapshot: q.question_snapshot }));
    const { error: qErr } = await sb.from('ticket_questions').insert(rows);
    if (qErr) throw qErr;
  }

  await sb.from('audit_logs').insert({
    user_id: user.id, action: 'TELEGRAM_EXPORT', entity_type: 'ticket_batches', entity_id: batch.id,
    details: { tickets: s.ticketCount, lang, chat_id: chat, source },
  });

  const infos = await loadSelectionInfos(sb, sel);
  const shaped = tickets.map((t) => ({ ticket_number: t.ticketNumber, selection_info: infos, questions: t.questions.map((q: any) => ({ question_snapshot: q.question_snapshot })) }));
  const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
  const files: Array<{ name: string; data: Uint8Array }> = [];
  for (const t of shaped) {
    if (lang === 'ru' || lang === 'both') files.push({ name: lang === 'both' ? `Русский/Вариант ${t.ticket_number}.docx` : `Вариант ${t.ticket_number}.docx`, data: await bytes(await buildSingleTicketBlob(title, t, subjectName, false)) });
    if (lang === 'tg' || lang === 'both') files.push({ name: lang === 'both' ? `Тоҷикӣ/Варианти ${t.ticket_number}.docx` : `Варианти ${t.ticket_number}.docx`, data: await bytes(await buildSingleTicketBlob(title, t, subjectName, true)) });
  }

  const caption = `${title}: ${s.ticketCount} шт. (${lang === 'both' ? 'RU + TJ' : (lang === 'tg' ? 'TJ' : lang.toUpperCase())})`;
  if (files.length === 1) {
    await sendDocument(botToken, chat, files[0].data, files[0].name, caption);
  } else {
    const zip = new JSZip();
    files.forEach((f) => zip.file(f.name, f.data));
    const zbytes = await zip.generateAsync({ type: 'uint8array' });
    const suffix = lang === 'both' ? 'RU_TJ' : (lang === 'tg' ? 'TJ' : lang.toUpperCase());
    await sendDocument(botToken, chat, zbytes, `${T.safeFileName(title)}_${suffix}.zip`, caption);
  }

  // Ключи ответов отдельным файлом (по шаблону предмета)
  let missingAnswers = 0;
  let keySent = false;
  const kind = keyKindOf(subjectName);
  if (kind) {
    try {
      const tpl = Uint8Array.from(atob(KEY_TEMPLATES[kind]), (c) => c.charCodeAt(0));
      const { bytes: kbytes, stats } = await buildAnswerKeyDocx(tpl, shaped, infos.ru);
      missingAnswers = stats.missing;
      const note = [
        stats.missing ? `⚠️ В базе нет верного ответа у вопросов: ${stats.missing} — эти клетки в ключе пустые.` : '',
        stats.overflow ? `В шаблоне не хватило места для вопросов: ${stats.overflow}.` : '',
      ].filter(Boolean).join(' ');
      await sendDocument(botToken, chat, kbytes, `Ключи – ${T.safeFileName(title)}.docx`, `Ключи ответов: ${title}${note ? '\n' + note : ''}`);
      keySent = true;
    } catch (e) {
      console.error('answer key failed', e);
    }
  }
  return { missingAnswers, keySent };
  }
}
