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
import { allowedSubjectIds, generateAndSend, limitsFor, linkedUser, resendBatch, sendDocument, userMessage, type Limits } from '../_shared/generate.ts';
import { matchingAnswer, openAnswer, testAnswer } from '../_shared/answerKey.ts';
import { MATCHING_ROWS, blankFor, maxPoints, scoreAnswers, type Answers, type Composition, type TicketKey } from '../_shared/omrScore.ts';
import { verifyInitData } from '../_shared/tgInitData.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
// Без токена подпись initData проверялась бы пустым ключом, который может вычислить кто угодно
if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const MAX_AGE_SEC = 24 * 3600;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-tg-init-data, authorization, apikey, x-client-info',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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
/** Бланки для печати: файлы лежат в репозитории (public/blanks); бот берёт их с GitHub по фиксированному адресу */
const BLANK_FILES: Record<string, string> = {
  'chem-27': 'Бланк химия 27', 'phys-27': 'Бланк физика 27', 'math-27': 'Бланк математика 27',
  'bio-26': 'Бланк биология 26', 'bioday-26': 'Бланк биология ежедневный', 'taj-26': 'Бланк таджикский язык 26', 'hist-26': 'Бланк история 26',
  'law-26': 'Бланк право 26', 'eng-26': 'Бланк английский язык 26', 'chemphys-12': 'Бланк химия-физика 12',
};
const BLANKS_URL = 'https://raw.githubusercontent.com/nodir2511/testgenerator/main/public/blanks';

/** Сколько примеров каждой цифры хранить; более старые удаляются при сохранении новых */
const MAX_DIGIT_SAMPLES = 2000;
const LAYOUT_IDS = ['chem', 'phys', 'bio', 'taj', 'chemphys', 'bioday'];

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

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const isLetter = (v: unknown) => v === null || (typeof v === 'string' && /^[A-D]$/.test(v));
const isDigit5 = (v: unknown) => v === null || (typeof v === 'string' && /^[1-5]$/.test(v));

// Ответы приходят от приложения: проверяем форму, чтобы в базу не попал мусор
function cleanAnswers(a: any, comp: Composition): Answers | null {
  if (!a || !Array.isArray(a.tests) || !Array.isArray(a.matching) || !Array.isArray(a.open)) return null;
  if (a.tests.length !== comp.test || a.matching.length !== comp.matching || a.open.length !== comp.open) return null;
  if (!a.tests.every(isLetter)) return null;
  if (!a.matching.every((r: unknown) => Array.isArray(r) && r.length === MATCHING_ROWS && r.every(isDigit5))) return null;
  if (!a.open.every((v: unknown) => typeof v === 'string' && /^\d{0,5}$/.test(v))) return null;
  return { tests: a.tests, matching: a.matching, open: a.open } as Answers; // лишние поля в базу не идут
}

function cleanKey(k: any, comp: Composition): TicketKey | null {
  if (!k || !Array.isArray(k.tests) || !Array.isArray(k.matching) || !Array.isArray(k.open)) return null;
  if (k.tests.length !== comp.test || k.matching.length !== comp.matching || k.open.length !== comp.open) return null;
  if (!k.tests.every(isLetter)) return null;
  if (!k.matching.every((r: unknown) => Array.isArray(r) && r.length === MATCHING_ROWS && r.every(isDigit5))) return null;
  if (!k.open.every((v: unknown) => v === null || (typeof v === 'string' && /^\d{1,5}$/.test(v)))) return null;
  return { tests: k.tests, matching: k.matching, open: k.open } as TicketKey;
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
    const tgUser = await verifyInitData(req.headers.get('X-Tg-Init-Data') ?? '', BOT_TOKEN, MAX_AGE_SEC);
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
        // Поиск q: по названию, предмету и дате (дд.мм.гггг или гггг-мм-дд) среди последних 200 наборов
        const q = typeof body.q === 'string' ? body.q.trim().toLowerCase().slice(0, 60) : '';
        const { data } = await sb.from('ticket_batches').select('id, title, created_at, generation_params, subject:subjects(name)')
          .eq('created_by', user.id).order('created_at', { ascending: false }).limit(q ? 200 : 30);
        const sets = (data ?? []).filter((b: any) => b.generation_params?.source !== 'cluster').map((b: any) => {
          const p = b.generation_params ?? {};
          const comp = { test: p.test_count ?? 0, matching: p.matching_count ?? 0, open: p.open_count ?? 0 };
          return { id: b.id, title: b.title, createdAt: b.created_at, subject: b.subject?.name ?? '', tickets: p.ticket_count ?? null, comp, supported: !!blankFor(comp) };
        });
        const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
        const found = q ? sets.filter((s: any) => `${s.title} ${s.subject} ${dmy(s.createdAt)} ${s.createdAt.slice(0, 10)}`.toLowerCase().includes(q)) : sets;
        return json({ sets: found.slice(0, q ? 30 : 12) });
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
        // Предел на сутки: одна учётная запись не должна раздувать таблицу
        const { count: savedToday } = await sb.from('omr_checks').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id).gte('created_at', new Date(Date.now() - 86400000).toISOString());
        if ((savedToday ?? 0) >= 2000) return json({ error: 'За сутки сохранено слишком много проверок. Продолжите завтра.' }, 429);
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
        let q = sb.from('omr_checks').select('id, created_at, student, ticket_number, score, max_score, batch_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(300);
        if (typeof body.batchId === 'string') q = q.eq('batch_id', body.batchId);
        const { data, error } = await q;
        if (error) return json({ error: 'Не удалось загрузить результаты' }, 500);
        return json({ checks: data ?? [] });
      }
      // Одна сохранённая проверка с ответами и ключом — только своя
      case 'check_get': {
        if (!isUuid(body.id)) return json({ error: 'Не выбрана работа' }, 400);
        const { data, error } = await sb.from('omr_checks').select('id, created_at, student, ticket_number, score, max_score, details').eq('id', body.id).eq('user_id', user.id).maybeSingle();
        if (error) return json({ error: 'Не удалось загрузить работу' }, 500);
        if (!data) return json({ error: 'Работа не найдена' }, 404);
        return json({ check: data });
      }
      case 'check_delete': {
        if (!isUuid(body.id)) return json({ error: 'Не выбрана работа' }, 400);
        const { error } = await sb.from('omr_checks').delete().eq('id', body.id).eq('user_id', user.id);
        if (error) return json({ error: 'Не удалось удалить результат' }, 500);
        return json({ ok: true });
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
        // Автоочистка: на каждую цифру оставляем MAX_DIGIT_SAMPLES свежих примеров, старые удаляем
        for (const d of new Set(rows.map((r) => r.digit))) {
          const { data: old } = await sb.from('omr_digit_samples').select('id').eq('digit', d).order('id', { ascending: false }).range(MAX_DIGIT_SAMPLES, MAX_DIGIT_SAMPLES).limit(1);
          if (old?.[0]) await sb.from('omr_digit_samples').delete().eq('digit', d).lte('id', old[0].id);
        }
        return json({ ok: true, saved: rows.length });
      }
      // Шаблон бланка в чат с ботом
      case 'blank_send': {
        const name = typeof body.file === 'string' && Object.hasOwn(BLANK_FILES, body.file) ? BLANK_FILES[body.file] : undefined;
        if (!name) return json({ error: 'Неизвестный шаблон' }, 400);
        const res = await fetch(`${BLANKS_URL}/${body.file}.pdf`).catch(() => null);
        if (!res?.ok) return json({ error: 'Не удалось получить файл шаблона. Попробуйте ещё раз.' }, 502);
        try {
          await sendDocument(BOT_TOKEN, tgUser.id, new Uint8Array(await res.arrayBuffer()), `${name}.pdf`, `🖨️ ${name}. Печать на A4, масштаб 100 %.`);
        } catch (e) {
          console.error('tg-app blank_send', e);
          return json({ error: userMessage(e, 'Не удалось отправить файл') }, 422);
        }
        return json({ ok: true });
      }
      // Чистка собранных цифр — только главный админ
      case 'digits_admin':
      case 'digits_admin_delete':
      case 'digits_admin_relabel': {
        const { data: prof } = await sb.from('profiles').select('role, is_owner').eq('id', user.id).maybeSingle();
        if (!(prof?.is_owner && prof?.role === 'admin')) {
          if (body.action === 'digits_admin') return json({ owner: false });
          return json({ error: 'Только для главного админа' }, 403);
        }
        const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x: unknown) => Number.isInteger(x)).slice(0, 200);
        if (body.action === 'digits_admin_delete') {
          if (ids.length) await sb.from('omr_digit_samples').delete().in('id', ids);
          return json({ ok: true, deleted: ids.length });
        }
        if (body.action === 'digits_admin_relabel') {
          if (!Number.isInteger(body.digit) || body.digit < 0 || body.digit > 9) return json({ error: 'Некорректная цифра' }, 400);
          if (ids.length) await sb.from('omr_digit_samples').update({ digit: body.digit }).in('id', ids);
          return json({ ok: true, changed: ids.length });
        }
        const counts = await Promise.all(Array.from({ length: 10 }, (_, d) =>
          sb.from('omr_digit_samples').select('id', { count: 'exact', head: true }).eq('digit', d).then((r: any) => r.count ?? 0)));
        let items: unknown[] | undefined;
        if (Number.isInteger(body.digit) && body.digit >= 0 && body.digit <= 9) {
          const { data } = await sb.from('omr_digit_samples').select('id, px, created_at').eq('digit', body.digit).order('id', { ascending: false }).limit(150);
          items = data ?? [];
        }
        return json({ owner: true, counts, items });
      }
      default:
        return json({ error: 'Неизвестное действие' }, 400);
    }
  } catch (err) {
    console.error('tg-app', err);
    return json({ error: 'Внутренняя ошибка. Попробуйте ещё раз.' }, 500);
  }
});
