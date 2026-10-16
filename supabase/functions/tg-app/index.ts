// Edge Function: tg-app
//
// Бэкенд Telegram Mini App (страница /tg). Приложению прямой доступ к базе не нужен:
// оно получает отсюда списки предметов/глав/тем с числом вопросов и запускает генерацию.
// Готовый файл Word/ZIP присылает бот в чат.
//
// Вход: заголовок X-Tg-Init-Data (Telegram initData). Подпись проверяется по токену бота,
// аккаунт определяется по telegram_links (chat_id = id пользователя в личном чате).
// Деплой:  supabase functions deploy tg-app --no-verify-jwt
// Секреты: TELEGRAM_BOT_TOKEN (тот же, что у telegram-bot).

import { createClient } from 'npm:@supabase/supabase-js@2';
import * as T from '../_shared/ticketing.ts';
import { allowedSubjectIds, generateAndSend, limitsFor, linkedUser, resendBatch, type Limits } from '../_shared/generate.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const MAX_AGE_SEC = 24 * 3600;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-tg-init-data, authorization, apikey, x-client-info',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ---------------- Проверка подписи initData ----------------
const enc = new TextEncoder();
async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function verifyInitData(raw: string): Promise<{ id: number } | null> {
  if (!raw || raw.length > 4096) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac(enc.encode('WebAppData'), BOT_TOKEN);
  const expected = hex(await hmac(secret, check));
  if (expected.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return null;
  const age = Math.floor(Date.now() / 1000) - Number(params.get('auth_date') || 0);
  if (age < -300 || age > MAX_AGE_SEC) return null;
  try {
    const u = JSON.parse(params.get('user') || '');
    return typeof u?.id === 'number' ? { id: u.id } : null;
  } catch {
    return null;
  }
}

// ---------------- Данные ----------------
type Counts = { test: number; matching: number; open: number };
const zero = (): Counts => ({ test: 0, matching: 0, open: 0 });
const bump = (c: Counts, type: string) => {
  if (type === 'test' || type === 'matching' || type === 'open') c[type]++;
};

async function subjectList(user: { id: string; role?: string }) {
  const { data } = await sb.from('subjects').select('id, name').eq('is_deleted', false).order('name');
  const allowed = await allowedSubjectIds(sb, user);
  return (data ?? []).filter((s: any) => !allowed || allowed.includes(s.id));
}

// Главы и темы предмета с числом вопросов каждого вида
async function tree(subjectId: string) {
  const { data: chapters } = await sb.from('chapters').select('id, name').eq('subject_id', subjectId).eq('is_deleted', false).order('order_index');
  const { data: topics } = (chapters ?? []).length
    ? await sb.from('topics').select('id, name, chapter_id').in('chapter_id', chapters!.map((c: any) => c.id)).eq('is_deleted', false).order('order_index')
    : { data: [] as any[] };
  const chById = new Map((chapters ?? []).map((c: any) => [c.id, { id: c.id, name: c.name, counts: zero(), topics: [] as any[] }]));
  const tById = new Map<string, any>();
  for (const t of topics ?? []) {
    const ch = chById.get(t.chapter_id);
    if (!ch) continue;
    const row = { id: t.id, name: t.name, counts: zero() };
    ch.topics.push(row);
    tById.set(t.id, row);
  }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('questions').select('chapter_id, topic_id, type')
      .eq('subject_id', subjectId).eq('is_deleted', false).order('id').range(from, from + 999);
    if (error) throw error;
    for (const q of data ?? []) {
      const ch = chById.get(q.chapter_id);
      if (ch) bump(ch.counts, q.type);
      const tp = q.topic_id ? tById.get(q.topic_id) : null;
      if (tp) bump(tp.counts, q.type);
    }
    if (!data || data.length < 1000) break;
  }
  return [...chById.values()];
}

// ---------------- Разбор запроса генерации ----------------
const isIds = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 64);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);

function parseGenerate(b: any, limits: Limits): { error: string } | { subjectId: string; chapterIds: string[]; topicIds: string[]; settings: T.Settings; lang: 'ru' | 'tg' | 'both' } {
  if (typeof b.subjectId !== 'string' || !b.subjectId) return { error: 'Не выбран предмет' };
  if (!isIds(b.chapterIds, 500) || !b.chapterIds.length) return { error: 'Выберите хотя бы одну главу' };
  const topicIds = b.topicIds === undefined ? [] : b.topicIds;
  if (!isIds(topicIds, 2000)) return { error: 'Некорректный список тем' };
  const st = b.settings ?? {};
  const settings: T.Settings = {
    testCount: int(st.testCount),
    matchingCount: int(st.matchingCount),
    openCount: int(st.openCount),
    ticketCount: int(st.ticketCount),
    shuffleOptions: bool(st.shuffleOptions, true),
    shuffleMatching: bool(st.shuffleMatching, true),
    title: (typeof st.title === 'string' ? st.title : '').trim().slice(0, 100) || T.DEFAULT_SETTINGS.title,
  };
  if ([settings.testCount, settings.matchingCount, settings.openCount, settings.ticketCount].some((n) => Number.isNaN(n) || n < 0)) {
    return { error: 'Некорректное число вопросов или билетов' };
  }
  const bad = T.checkSettings(settings, limits);
  if (bad) return { error: bad };
  if (b.lang !== 'ru' && b.lang !== 'tg' && b.lang !== 'both') return { error: 'Выберите язык' };
  return { subjectId: b.subjectId, chapterIds: b.chapterIds, topicIds, settings, lang: b.lang };
}

async function tgSend(chat: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405);

  try {
    const tgUser = await verifyInitData(req.headers.get('X-Tg-Init-Data') ?? '');
    if (!tgUser) return json({ error: 'bad_init_data', message: 'Откройте приложение из Telegram.' }, 401);

    const body = await req.json().catch(() => ({}));
    const user = await linkedUser(sb, tgUser.id);
    if (!user) {
      return json({
        error: 'not_linked',
        message: 'Аккаунт не привязан. На сайте нажмите значок Telegram, получите код и отправьте боту: /start КОД',
      }, 403);
    }

    switch (body?.action) {
      case 'me':
        return json({ name: user.full_name || user.email, subjects: await subjectList(user), limits: await limitsFor(sb, user) });
      case 'history': {
        const { data } = await sb.from('ticket_batches').select('id, title, created_at, subject_id, generation_params, subject:subjects(name)')
          .eq('created_by', user.id).order('created_at', { ascending: false }).limit(24);
        // Кластерные экзамены в историю бота не попадают
        return json({ batches: (data ?? []).filter((b: any) => b.generation_params?.source !== 'cluster').slice(0, 8) });
      }
      case 'tree': {
        if (typeof body.subjectId !== 'string') return json({ error: 'Не выбран предмет' }, 400);
        const allowed = await allowedSubjectIds(sb, user);
        if (allowed && !allowed.includes(body.subjectId)) return json({ error: 'Этот предмет вам не назначен' }, 403);
        return json({ chapters: await tree(body.subjectId) });
      }
      case 'generate': {
        const limits = await limitsFor(sb, user);
        const p = parseGenerate(body, limits);
        if ('error' in p) return json({ error: p.error }, 400);
        const chat = tgUser.id;
        // Ждём, пока файл уйдёт в чат: приложение показывает итог (успех или причину ошибки)
        try {
          const r = await generateAndSend({
            sb, botToken: BOT_TOKEN, chat, user, lang: p.lang, settings: p.settings, source: 'telegram-app',
            sel: { subjectId: p.subjectId, chapterIds: p.chapterIds, topicIds: p.topicIds },
            onNotes: (notes) => tgSend(chat, `ℹ️ Вопросов не хватает, билеты составлены из того, что есть:\n• ${notes.join('\n• ')}`),
          });
          return json({ ok: true, missingAnswers: r.missingAnswers, keySent: r.keySent });
        } catch (e) {
          console.error('tg-app generate failed', e);
          return json({ error: (e as Error).message || 'Не удалось создать билеты' }, 422);
        }
      }
      case 'resend': {
        if (typeof body.batchId !== 'string') return json({ error: 'Не выбран набор' }, 400);
        const lang = body.lang === 'ru' || body.lang === 'tg' || body.lang === 'both' ? body.lang : undefined;
        try {
          const r = await resendBatch({ sb, botToken: BOT_TOKEN, chat: tgUser.id, user, batchId: body.batchId, lang });
          return json({ ok: true, missingAnswers: r.missingAnswers, keySent: r.keySent });
        } catch (e) {
          console.error('tg-app resend failed', e);
          return json({ error: (e as Error).message || 'Не удалось отправить файл' }, 422);
        }
      }
      default:
        return json({ error: 'Неизвестное действие' }, 400);
    }
  } catch (err) {
    console.error('tg-app', err);
    return json({ error: (err as Error).message || 'Внутренняя ошибка' }, 500);
  }
});
