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
  // Статус блокировки и профиль независимы: читаем одновременно
  const [{ data: au }, { data: profile }] = await Promise.all([
    sb.auth.admin.getUserById(link.user_id),
    sb.from('profiles').select('id, full_name, email, role').eq('id', link.user_id).maybeSingle(),
  ]);
  const bannedUntil = (au?.user as { banned_until?: string | null } | undefined)?.banned_until;
  if (!au?.user || (bannedUntil && new Date(bannedUntil).getTime() > Date.now())) return null;
  return profile ?? null;
}

// Предметы, назначенные пользователю с ролью «по предметам»; null — доступны все
export async function allowedSubjectIds(sb: any, user: { id: string; role?: string }): Promise<string[] | null> {
  if (user.role !== 'subject_teacher' && user.role !== 'subject_admin') return null;
  const { data } = await sb.from('user_subjects').select('subject_id').eq('user_id', user.id);
  return (data ?? []).map((r: any) => r.subject_id);
}

// Лимиты: у администраторов — лимиты сайта без дневного ограничения, у остальных — из таблицы
// generation_settings (правится на вкладке «Статистика»); если таблицы нет — значения по умолчанию.
export type Limits = { perType: number; tickets: number; total?: number; perDay: number };
export async function limitsFor(sb: any, user: { role?: string }): Promise<Limits> {
  if (user.role === 'admin') return { ...T.LIMITS, perDay: Infinity };
  try {
    const { data } = await sb.from('generation_settings').select('per_day, max_tickets, max_per_ticket').eq('id', true).maybeSingle();
    if (data) return { perType: T.TG_LIMITS.perType, tickets: data.max_tickets, total: data.max_per_ticket, perDay: data.per_day };
  } catch (e) {
    console.error('generation_settings read failed', e);
  }
  return { ...T.TG_LIMITS };
}

// Начало текущих суток по времени Таджикистана (UTC+5)
function dayStartIso(): string {
  const shift = 5 * 3600 * 1000;
  const local = Date.now() + shift;
  return new Date(local - (local % 86400000) - shift).toISOString();
}

async function dailyLimitError(sb: any, user: { id: string; role?: string }): Promise<string | null> {
  const perDay = (await limitsFor(sb, user)).perDay;
  if (!Number.isFinite(perDay)) return null;
  // Журнал генераций: удалённые наборы тоже считаются
  const { count } = await sb.from('generation_usage').select('*', { count: 'exact', head: true })
    .eq('user_id', user.id).gte('created_at', dayStartIso());
  return (count ?? 0) >= perDay ? `Дневной лимит исчерпан: ${perDay} генераций в сутки. Попробуйте завтра.` : null;
}

export async function loadPool(sb: any, sel: Selection) {
  const PAGE = 1000;
  const PARALLEL = 4;
  const page = async (from: number): Promise<any[]> => {
    let q = sb.from('questions')
      .select('*, chapter:chapters(name, order_index), topic:topics(name, order_index), options:question_options(*), matching_items:matching_items(*)')
      .eq('subject_id', sel.subjectId).eq('is_deleted', false).order('id');
    if (sel.topicIds.length) q = q.in('topic_id', sel.topicIds);
    else q = q.in('chapter_id', sel.chapterIds);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    return data ?? [];
  };
  // Первая страница одна; если она полная, следующие читаем пачками одновременно (порядок строк сохраняется)
  const all: any[] = await page(0);
  if (all.length < PAGE) return all;
  for (let from = PAGE; ; from += PAGE * PARALLEL) {
    const parts = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => page(from + i * PAGE)));
    for (const p of parts) all.push(...p);
    if (parts.some((p) => p.length < PAGE)) break;
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
  const { data, error } = await sb.rpc('question_counts', { p_subject_id: subjectId });
  if (error) throw error;
  return T.chapterTotalsFromCounts(data ?? [], ids);
}

function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendDocument(botToken: string, chat: number, bytes: Uint8Array, filename: string, caption: string) {
  const form = new FormData();
  form.append('chat_id', String(chat));
  form.append('parse_mode', 'HTML');
  form.append('caption', caption);
  form.append('document', new Blob([bytes]), filename);
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Не удалось отправить файл: ${json.description || res.status}`);
}

// Сборка Word/ZIP по уже сохранённым билетам и отправка в чат. Генерацию не создаёт и в лимит не засчитывается:
// используется и при создании набора, и при повторной отправке из истории.
export async function deliverBatch(opts: {
  sb: any;
  botToken: string;
  chat: number;
  title: string;
  subjectId: string;
  chapterIds: string[];
  topicIds: string[];
  /** Билеты в порядке номеров; question_snapshot — как хранится в ticket_questions */
  tickets: Array<{ ticketNumber: number; questions: Array<{ question_snapshot: any }> }>;
  lang: Lang;
}): Promise<{ missingAnswers: number; keySent: boolean }> {
  const { sb, botToken, chat, title, subjectId, chapterIds, topicIds, tickets, lang } = opts;
  const sel: Selection = { subjectId, chapterIds, topicIds };
  const { data: subj } = await sb.from('subjects').select('name').eq('id', subjectId).maybeSingle();
  const subjectName = subj?.name ?? 'Химия';
  const infos = await loadSelectionInfos(sb, sel);
  const shaped = tickets.map((t) => ({ ticket_number: t.ticketNumber, selection_info: infos, questions: t.questions.map((q: any) => ({ question_snapshot: q.question_snapshot })) }));
  const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
  const files: Array<{ name: string; data: Uint8Array }> = [];
  for (const t of shaped) {
    if (lang === 'ru' || lang === 'both') files.push({ name: lang === 'both' ? `Русский/Вариант ${t.ticket_number}.docx` : `Вариант ${t.ticket_number}.docx`, data: await bytes(await buildSingleTicketBlob(title, t, subjectName, false)) });
    if (lang === 'tg' || lang === 'both') files.push({ name: lang === 'both' ? `Тоҷикӣ/Варианти ${t.ticket_number}.docx` : `Варианти ${t.ticket_number}.docx`, data: await bytes(await buildSingleTicketBlob(title, t, subjectName, true)) });
  }

  // Ключи ответов (по шаблону предмета): в архив, если отправляется архив, иначе отдельным файлом
  let missingAnswers = 0;
  let keySent = false;
  let key: { data: Uint8Array; name: string; note: string } | null = null;
  const kind = keyKindOf(subjectName);
  if (kind) {
    try {
      const tpl = Uint8Array.from(atob(KEY_TEMPLATES[kind]), (c) => c.charCodeAt(0));
      const { bytes: kbytes, stats } = await buildAnswerKeyDocx(tpl, shaped, infos.ru);
      missingAnswers = stats.missing;
      key = {
        data: kbytes,
        name: `Ключи – ${T.safeFileName(title)}.docx`,
        note: [
          stats.missing ? `⚠️ В базе нет верного ответа у вопросов: ${stats.missing} — эти клетки в ключе отмечены красным.` : '',
          stats.overflow ? `В шаблоне не хватило места для вопросов: ${stats.overflow}.` : '',
        ].filter(Boolean).join(' '),
      };
    } catch (e) {
      console.error('answer key failed', e);
    }
  }

  const langLabel = lang === 'both' ? 'RU + TJ (Двуязычные)' : (lang === 'tg' ? 'Тоҷикӣ' : 'Русский');
  const qCount = tickets[0]?.questions?.length ?? 0;
  const caption = [
    `📄 <b>${escapeHtml(title)}</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📚 <b>Предмет:</b> ${escapeHtml(subjectName)}`,
    `👥 <b>Вариантов:</b> ${tickets.length} параллельных билетов`,
    `❓ <b>Вопросов в билете:</b> ${qCount} шт.`,
    `🌐 <b>Язык:</b> ${langLabel}`,
    key ? `🔑 <b>Ключи ответов:</b> включены в архив` : '',
    key?.note ? `⚠️ ${escapeHtml(key.note)}` : '',
    `━━━━━━━━━━━━━━━━━━━━`,
    `✨ Готово к печати и проведению экзамена`
  ].filter(Boolean).join('\n');

  if (files.length === 1 && !key) {
    await sendDocument(botToken, chat, files[0].data, files[0].name, caption);
  } else {
    const zip = new JSZip();
    files.forEach((f) => zip.file(f.name, f.data));
    if (key) zip.file(key.name, key.data);
    const zbytes = await zip.generateAsync({ type: 'uint8array' });
    const suffix = lang === 'both' ? 'RU_TJ' : (lang === 'tg' ? 'TJ' : lang.toUpperCase());
    await sendDocument(botToken, chat, zbytes, `${T.safeFileName(title)}_${suffix}.zip`, caption);
    keySent = Boolean(key);
  }
  return { missingAnswers, keySent };
}

// Повторная отправка набора из истории (свой набор пользователя, не кластерный)
export async function resendBatch(opts: { sb: any; botToken: string; chat: number; user: { id: string }; batchId: string; lang?: Lang }) {
  const { sb, botToken, chat, user, batchId } = opts;
  const { data: batch } = await sb.from('ticket_batches').select('id, title, subject_id, created_by, generation_params').eq('id', batchId).maybeSingle();
  if (!batch || batch.created_by !== user.id || batch.generation_params?.source === 'cluster') throw new Error('Набор не найден');
  const { data: rows, error } = await sb.from('tickets')
    .select('ticket_number, questions:ticket_questions(order_index, question_snapshot)')
    .eq('batch_id', batchId).order('ticket_number');
  if (error || !rows?.length) throw new Error('В наборе нет билетов');
  const p = batch.generation_params ?? {};
  const lang: Lang = opts.lang ?? (p.lang === 'tg' || p.lang === 'both' ? p.lang : 'ru');
  const { data: gotLock } = await sb.rpc('acquire_generation_lock', { p_user: user.id, p_ttl_seconds: 180 });
  if (gotLock === false) throw new Error('Предыдущая генерация ещё выполняется. Подождите минуту.');
  try {
    return await deliverBatch({
      sb, botToken, chat, lang, title: batch.title, subjectId: batch.subject_id,
      chapterIds: p.chapter_ids ?? [], topicIds: p.topic_ids ?? [],
      tickets: rows.map((t: any) => ({
        ticketNumber: t.ticket_number,
        questions: [...(t.questions ?? [])].sort((x: any, y: any) => x.order_index - y.order_index),
      })),
    });
  } finally {
    await sb.from('generation_locks').delete().eq('user_id', user.id);
  }
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
  const [allowed, limits] = await Promise.all([allowedSubjectIds(sb, user), limitsFor(sb, user)]);
  if (allowed && !allowed.includes(sel.subjectId)) throw new Error('Этот предмет вам не назначен');
  const bad = T.checkSettings(s, limits);
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

  // Партия, билеты и вопросы — одной транзакцией (supabase/sql/save_ticket_batch.sql); лимиты проверяет триггер
  const { data: saved, error: sErr } = await sb.rpc('save_ticket_batch', {
    p_batch: {
      title, subject_id: sel.subjectId, created_by: user.id,
      generation_params: {
        chapter_ids: sel.chapterIds, topic_ids: sel.topicIds,
        test_count: fit.settings.testCount, matching_count: fit.settings.matchingCount, open_count: fit.settings.openCount, ticket_count: s.ticketCount,
        shuffle_options: s.shuffleOptions, shuffle_matching: s.shuffleMatching, source, lang,
        requested: { test: s.testCount, matching: s.matchingCount, open: s.openCount },
      },
    },
    p_tickets: tickets.map((t) => ({
      ticket_number: t.ticketNumber,
      questions: t.questions.map((q: any) => ({ question_id: q.question_id, order_index: q.order_index, question_snapshot: q.question_snapshot })),
    })),
  });
  if (sErr || !saved) throw new Error(sErr?.message || 'Не удалось сохранить партию');
  const batch = saved.batch;

  await sb.from('audit_logs').insert({
    user_id: user.id, action: 'TELEGRAM_EXPORT', entity_type: 'ticket_batches', entity_id: batch.id,
    details: { tickets: s.ticketCount, lang, chat_id: chat, source },
  });

  return deliverBatch({
    sb, botToken, chat, lang,
    title, subjectId: sel.subjectId, chapterIds: sel.chapterIds, topicIds: sel.topicIds,
    tickets: tickets.map((t) => ({ ticketNumber: t.ticketNumber, questions: t.questions })),
  });
  }
}
