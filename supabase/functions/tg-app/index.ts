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
import { allowedSubjectIds, generateAndSend, limitsFor, linkedUser, resendBatch, userMessage, type Limits } from '../_shared/generate.ts';
import { matchingAnswer, openAnswer, testAnswer } from '../_shared/answerKey.ts';
import { MATCHING_ROWS, blankFor, maxPoints, scoreAnswers, type Answers, type Composition, type TicketKey } from '../_shared/omrScore.ts';

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

async function subjectList(user: { id: string; role?: string }) {
  const [{ data }, allowed] = await Promise.all([
    sb.from('subjects').select('id, name').eq('is_deleted', false).order('name'),
    allowedSubjectIds(sb, user),
  ]);
  return (data ?? []).filter((s: any) => !allowed || allowed.includes(s.id));
}

// Главы и темы предмета с числом вопросов каждого вида (счётчики считает база одним запросом)
async function tree(subjectId: string) {
  const [chRes, cntRes] = await Promise.all([
    sb.from('chapters').select('id, name').eq('subject_id', subjectId).eq('is_deleted', false).order('order_index'),
    sb.rpc('question_counts', { p_subject_id: subjectId }),
  ]);
  if (chRes.error) throw chRes.error;
  if (cntRes.error) throw cntRes.error;
  const chapters = chRes.data ?? [];
  const { data: topics, error: tErr } = chapters.length
    ? await sb.from('topics').select('id, name, chapter_id').in('chapter_id', chapters.map((c: any) => c.id)).eq('is_deleted', false).order('order_index')
    : { data: [] as any[], error: null };
  if (tErr) throw tErr;
  const chById = new Map(chapters.map((c: any) => [c.id, { id: c.id, name: c.name, counts: zero(), topics: [] as any[] }]));
  const tById = new Map<string, any>();
  for (const t of topics ?? []) {
    const ch = chById.get(t.chapter_id);
    if (!ch) continue;
    const row = { id: t.id, name: t.name, counts: zero() };
    ch.topics.push(row);
    tById.set(t.id, row);
  }
  for (const r of cntRes.data ?? []) {
    const ch = chById.get(r.chapter_id);
    const tp = r.topic_id ? tById.get(r.topic_id) : null;
    for (const c of [ch?.counts, tp?.counts]) {
      if (c && (r.type === 'test' || r.type === 'matching' || r.type === 'open')) c[r.type as keyof Counts] += r.cnt;
    }
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

// ---------------- Проверка бланков ----------------
const LAYOUT_IDS = ['chem', 'phys', 'bio', 'taj', 'chemphys'];

// Ключ билета по снимкам вопросов: порядок как в билете, у соответствия всегда четыре пункта A–D
function ticketKeyOf(questions: any[]): { key: TicketKey; comp: Composition } {
  const snaps = [...questions].sort((x, y) => x.order_index - y.order_index).map((q) => q.question_snapshot);
  const of = (t: string) => snaps.filter((s) => s.type === t);
  const tests = of('test'), matching = of('matching'), open = of('open');
  const key: TicketKey = {
    tests: tests.map((s) => testAnswer(s)),
    matching: matching.map((s) => {
      const a = matchingAnswer(s);
      return Array.from({ length: MATCHING_ROWS }, (_, i) => a[i] ?? null);
    }),
    open: open.map((s) => openAnswer(s)),
  };
  return { key, comp: { test: tests.length, matching: matching.length, open: open.length } };
}

async function batchKeys(userId: string, batchId: string) {
  const { data: batch } = await sb.from('ticket_batches').select('id, title, created_by, generation_params').eq('id', batchId).maybeSingle();
  if (!batch || batch.created_by !== userId || batch.generation_params?.source === 'cluster') return null;
  const { data: rows, error } = await sb.from('tickets')
    .select('ticket_number, questions:ticket_questions(order_index, question_snapshot)')
    .eq('batch_id', batchId).order('ticket_number');
  if (error || !rows?.length) return null;
  const tickets = rows.map((t: any) => ({ number: t.ticket_number as number, ...ticketKeyOf(t.questions ?? []) }));
  return { title: batch.title as string, tickets };
}

const isLetter = (v: unknown) => v === null || (typeof v === 'string' && /^[A-D]$/.test(v));
const isDigit5 = (v: unknown) => v === null || (typeof v === 'string' && /^[1-5]$/.test(v));

// Ответы приходят от приложения: проверяем форму, чтобы в базу не попал мусор
function cleanAnswers(a: any, comp: Composition): Answers | null {
  if (!a || !Array.isArray(a.tests) || !Array.isArray(a.matching) || !Array.isArray(a.open)) return null;
  if (a.tests.length !== comp.test || a.matching.length !== comp.matching || a.open.length !== comp.open) return null;
  if (!a.tests.every(isLetter)) return null;
  if (!a.matching.every((r: unknown) => Array.isArray(r) && r.length === MATCHING_ROWS && r.every(isDigit5))) return null;
  if (!a.open.every((v: unknown) => typeof v === 'string' && /^\d{0,4}$/.test(v))) return null;
  return a as Answers;
}

function cleanKey(k: any, comp: Composition): TicketKey | null {
  if (!k || !Array.isArray(k.tests) || !Array.isArray(k.matching) || !Array.isArray(k.open)) return null;
  if (k.tests.length !== comp.test || k.matching.length !== comp.matching || k.open.length !== comp.open) return null;
  if (!k.tests.every(isLetter)) return null;
  if (!k.matching.every((r: unknown) => Array.isArray(r) && r.length === MATCHING_ROWS && r.every(isDigit5))) return null;
  if (!k.open.every((v: unknown) => v === null || (typeof v === 'string' && /^\d{1,4}$/.test(v)))) return null;
  return k as TicketKey;
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
        {
        const [subjects, limits] = await Promise.all([subjectList(user), limitsFor(sb, user)]);
        return json({ name: user.full_name || user.email, subjects, limits });
      }
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
          return json({ error: userMessage(e, 'Не удалось создать билеты') }, 422);
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
          return json({ error: userMessage(e, 'Не удалось отправить файл') }, 422);
        }
      }
      // Проверка бланков по фото. Наборы — только свои; бланк подбирается по составу билета.
      case 'check_sets': {
        const { data } = await sb.from('ticket_batches').select('id, title, created_at, generation_params, subject:subjects(name)')
          .eq('created_by', user.id).order('created_at', { ascending: false }).limit(30);
        const sets = (data ?? []).filter((b: any) => b.generation_params?.source !== 'cluster').map((b: any) => {
          const p = b.generation_params ?? {};
          const comp = { test: p.test_count ?? 0, matching: p.matching_count ?? 0, open: p.open_count ?? 0 };
          return { id: b.id, title: b.title, createdAt: b.created_at, subject: b.subject?.name ?? '', tickets: p.ticket_count ?? null, comp, supported: !!blankFor(comp) };
        });
        return json({ sets: sets.slice(0, 12) });
      }
      case 'check_key': {
        if (typeof body.batchId !== 'string') return json({ error: 'Не выбран набор' }, 400);
        const r = await batchKeys(user.id, body.batchId);
        if (!r) return json({ error: 'Набор не найден' }, 404);
        const comp = r.tickets[0].comp;
        const blank = blankFor(comp);
        if (!blank) return json({ error: `Для состава билета ${comp.test}/${comp.matching}/${comp.open} нет бланка. Подходят: 18/2/7, 20/4/2 и 8/2/2 (тесты / соответствия / открытые).` }, 422);
        return json({ title: r.title, comp, layouts: blank.layouts, tickets: r.tickets.map((t) => ({ number: t.number, key: t.key })) });
      }
      case 'check_save': {
        const comp = { test: int(body.comp?.test), matching: int(body.comp?.matching), open: int(body.comp?.open) };
        if (!blankFor(comp)) return json({ error: 'Некорректный состав бланка' }, 400);
        const layout = typeof body.layout === 'string' && LAYOUT_IDS.includes(body.layout) ? body.layout : null;
        if (!layout) return json({ error: 'Неизвестный бланк' }, 400);
        const answers = cleanAnswers(body.answers, comp);
        if (!answers) return json({ error: 'Некорректные ответы' }, 400);
        let key: TicketKey | null = null;
        let batchId: string | null = null;
        let ticketNumber: number | null = null;
        if (typeof body.batchId === 'string') {
          // Ключ берём из базы, а не от приложения
          const r = await batchKeys(user.id, body.batchId);
          const t = r?.tickets.find((x) => x.number === int(body.ticketNumber));
          if (!t) return json({ error: 'Билет не найден в наборе' }, 404);
          key = t.key; batchId = body.batchId; ticketNumber = t.number;
        } else {
          key = cleanKey(body.key, comp);
          ticketNumber = Number.isInteger(body.ticketNumber) ? body.ticketNumber : null;
        }
        if (!key) return json({ error: 'Некорректный ключ' }, 400);
        const score = scoreAnswers(key, answers);
        const student = (typeof body.student === 'string' ? body.student : '').trim().slice(0, 120);
        const { data, error } = await sb.from('omr_checks').insert({
          user_id: user.id, batch_id: batchId, ticket_number: ticketNumber, student, layout,
          score: score.score, max_score: score.max, details: { answers, key, ok: { tests: score.tests, matching: score.matching, open: score.open } },
        }).select('id, created_at').single();
        if (error) {
          console.error('tg-app check_save', error);
          return json({ error: 'Не удалось сохранить результат' }, 500);
        }
        return json({ ok: true, id: data.id, score: score.score, max: score.max || maxPoints(comp) });
      }
      case 'check_list': {
        let q = sb.from('omr_checks').select('id, created_at, student, ticket_number, score, max_score, batch_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(40);
        if (typeof body.batchId === 'string') q = q.eq('batch_id', body.batchId);
        const { data, error } = await q;
        if (error) return json({ error: 'Не удалось загрузить результаты' }, 500);
        return json({ checks: data ?? [] });
      }
      // Картинки цифр: общий набор для подсказок; без имён, только 14×14 пикселей и цифра
      case 'digits_get': {
        const per = 60;
        const parts = await Promise.all(Array.from({ length: 10 }, (_, d) =>
          sb.from('omr_digit_samples').select('px').eq('digit', d).order('id', { ascending: false }).limit(per)
            .then((r: any) => (r.data ?? []).map((x: any) => ({ d, px: x.px })))));
        return json({ samples: parts.flat() });
      }
      case 'digits_save': {
        const list = Array.isArray(body.samples) ? body.samples.slice(0, 40) : [];
        const rows: Array<{ user_id: string; digit: number; px: string; layout: string | null }> = [];
        const layout = typeof body.layout === 'string' && LAYOUT_IDS.includes(body.layout) ? body.layout : null;
        for (const s of list) {
          const d = s?.d, px = s?.px;
          if (!Number.isInteger(d) || d < 0 || d > 9 || typeof px !== 'string' || !/^[A-Za-z0-9+/]{262}==$/.test(px)) continue;
          rows.push({ user_id: user.id, digit: d, px, layout });
        }
        if (!rows.length) return json({ ok: true, saved: 0 });
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { count } = await sb.from('omr_digit_samples').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
        if ((count ?? 0) + rows.length > 500) return json({ ok: true, saved: 0, capped: true });
        const { error } = await sb.from('omr_digit_samples').insert(rows);
        if (error) {
          console.error('tg-app digits_save', error);
          return json({ error: 'Не удалось сохранить' }, 500);
        }
        return json({ ok: true, saved: rows.length });
      }
      default:
        return json({ error: 'Неизвестное действие' }, 400);
    }
  } catch (err) {
    console.error('tg-app', err);
    return json({ error: 'Внутренняя ошибка. Попробуйте ещё раз.' }, 500);
  }
});
