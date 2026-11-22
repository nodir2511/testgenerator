// Edge Function: error-digest
//
// Сводка ошибок сайта (журнал client_errors) главному админу в Telegram: за сутки — каждый день,
// за неделю — по понедельникам, за месяц — 1-го числа, за год — 1 января (календарь по Душанбе).
// Запускается раз в сутки заданием pg_cron (см. supabase/sql/error_digest.sql). Тела запроса не читает.
// Каждый период «занимается» строкой в error_digest_runs (ключ вида day:2026-11-21): повторный или
// чужой вызов адреса ничего не разошлёт дважды. Суточная сводка без ошибок не отправляется
// (период всё равно считается занятым); недельная, месячная и годовая отправляются всегда.
// Получатели — главные админы (profiles.is_owner и role = 'admin') с привязанным Telegram.
// Деплой:  supabase functions deploy error-digest --no-verify-jwt
// Секреты: TELEGRAM_BOT_TOKEN (SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY задаёт сам Supabase).
// Необязательно: ERROR_DIGEST_SECRET — если задан, вызов принимается только с заголовком x-cron-secret
// с тем же значением (его же нужно добавить в задание pg_cron).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { chunkLines, digestText, duePeriods, summarize, type DuePeriod, type ErrorRow } from '../_shared/errorDigest.ts';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const API = `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')!}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendMessage(chat: number, text: string): Promise<boolean> {
  const res = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.error('sendMessage failed', chat, res.status);
  return res.ok;
}

const CRON_SECRET = Deno.env.get('ERROR_DIGEST_SECRET');

const PAGE = 1000;
/** Журнал хранит ошибки 400 дней (см. report_client_error) — более ранняя часть периода в сводку не попадёт */
const KEEP_MS = 400 * 24 * 3600_000;

/** Ошибки за период, страницами по 1000 строк */
async function loadErrors(p: DuePeriod): Promise<ErrorRow[]> {
  const rows: ErrorRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('client_errors')
      .select('id, created_at, message, url, app_version, user_id')
      .gte('created_at', p.from.toISOString())
      .lt('created_at', p.to.toISOString())
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as ErrorRow[]));
    if ((data ?? []).length < PAGE) return rows;
  }
}

/** Чаты главных админов с привязанным Telegram */
async function ownerChats(): Promise<number[]> {
  const { data: owners, error } = await sb.from('profiles').select('id').eq('is_owner', true).eq('role', 'admin');
  if (error) throw error;
  const ids = (owners ?? []).map((o: any) => o.id);
  if (!ids.length) return [];
  const { data: links, error: linkErr } = await sb.from('telegram_links').select('chat_id, user_id').in('user_id', ids);
  if (linkErr) throw linkErr;
  return (links ?? []).map((l: any) => l.chat_id as number);
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response('forbidden', { status: 403 });

  const now = new Date();
  let chats: number[] | null = null;
  const done: Array<{ key: string; total?: number; sent?: number; failed?: number; skipped?: string }> = [];

  for (const p of duePeriods(now)) {
    // «Занимаем» период: если строка с таким ключом уже есть, вставка ничего не вернёт
    const { data: claimed, error: claimErr } = await sb.from('error_digest_runs')
      .upsert({ key: p.key, period: p.period }, { onConflict: 'key', ignoreDuplicates: true })
      .select('key');
    if (claimErr) {
      console.error('claim failed', p.key, claimErr);
      return new Response(JSON.stringify({ error: 'claim failed', done }), { status: 500 });
    }
    if (!claimed?.length) { done.push({ key: p.key, skipped: 'уже отправлено' }); continue; }

    let rows: ErrorRow[];
    try {
      rows = await loadErrors(p);
      chats ??= await ownerChats();
    } catch (e) {
      // Данные не прочитались — освобождаем период, чтобы повторный вызов отправил сводку
      console.error('load failed', p.key, e);
      await sb.from('error_digest_runs').delete().eq('key', p.key);
      return new Response(JSON.stringify({ error: 'load failed', done }), { status: 500 });
    }

    const summary = summarize(rows);
    await sb.from('error_digest_runs').update({ total: summary.total }).eq('key', p.key);

    // Суточная сводка без ошибок не нужна
    if (p.period === 'day' && !summary.total) { done.push({ key: p.key, total: 0, skipped: 'ошибок не было' }); continue; }

    const note = p.from.getTime() < now.getTime() - KEEP_MS
      ? 'Журнал хранит ошибки 400 дней: более ранние в подсчёт не вошли.'
      : undefined;
    const messages = chunkLines(digestText(p.period, p, summary, { note }));

    let sent = 0, failed = 0;
    for (const chat of chats) {
      let ok = true;
      for (const text of messages) {
        ok = (await sendMessage(chat, text)) && ok;
        await sleep(50);
      }
      if (ok) sent++; else failed++;
    }
    done.push({ key: p.key, total: summary.total, sent, failed });
  }
  return Response.json({ periods: done });
});
