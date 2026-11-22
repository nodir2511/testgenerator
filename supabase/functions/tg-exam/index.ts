// Edge Function: tg-exam
//
// «Билеты классу»: ученик проходит билет набора на странице /tg/exam внутри Telegram,
// преподаватель рассылает разбор и получает ссылку и итог в бот.
//
// Ученик (заголовок X-Tg-Init-Data, подпись Telegram): open, start, save, submit, review.
//   start — вход в зал ожидания (вариант, имя, язык); вопросы ученик получает только когда часы сервера дошли
//   до exam_links.session_start_at (преподаватель нажал «Начать»); конец у всех общий — effEnd(запуска).
//   Привязка к аккаунту сайта не нужна; личность — id из подписи. Данных tg-app здесь нет.
//   Ключи ответов (is_correct, correct_match_id, correct_numeric_answer) ученик получает только
//   в review — после сдачи и после того, как преподаватель отправил разбор. Баллы считает сервер.
// Преподаватель (Authorization: Bearer <JWT сайта>): review_send, link_send, notify_closed.
//   Доступ: автор запуска (exam_links.created_by) или главный админ (profiles.is_owner).
//
// Таблицы exam_links и exam_attempts (supabase/sql/exam_links.sql) пишет только эта функция
// сервисным ключом; ответы и сдача — только через RPC exam_attempt_save / exam_attempt_close (атомарно в базе);
// запуск создаёт и закрывает сайт через RPC exam_link_create / exam_link_close.
//
// Деплой:  supabase functions deploy tg-exam --no-verify-jwt
// Секреты: TELEGRAM_BOT_TOKEN (тот же, что у telegram-bot);
//          необязательно EXAM_URL (по умолчанию https://testgenerator-3s51.vercel.app/tg/exam).
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY задаёт сам Supabase.
// initData и токены не логируются.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  chunkLines, examLang, pickVariant, publicSnapshot, reviewButtonText, reviewHead, reviewJustSent, reviewLines, reviewSnapshot, scoreAttempt,
  sessionEnd, sessionPhase, tgPlain,
  type ExamAnswer, type ExamAnswers, type ExamQuestion,
} from '../_shared/exam.ts';
import { verifyInitData, type TgInitUser } from '../_shared/tgInitData.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
// Без токена подпись initData проверялась бы пустым ключом, который может вычислить кто угодно
if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
const EXAM_URL = Deno.env.get('EXAM_URL') || 'https://testgenerator-3s51.vercel.app/tg/exam';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const MAX_AGE_SEC = 24 * 3600;
const MAX_BODY = 16 * 1024;
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const ID_MAX = 64;
const OPEN_MAX = 20;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-tg-init-data, authorization, apikey, x-client-info',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ---------------- Данные ----------------
type Link = {
  code: string; batch_id: string; created_by: string; created_at: string; closes_at: string; closed_at: string | null;
  duration_min: number; review_sent_at: string | null; session_start_at: string | null;
  batch: { title: string | null; generation_params: any; subject: { name: string | null } | null } | null;
};
type Attempt = {
  id: string; code: string; tg_user_id: number; student_name: string; ticket_id: string; started_at: string;
  deadline_at: string | null; finished_at: string | null; answers: ExamAnswers | null; score: number | null; max_score: number | null;
  lang: string | null;
};
type QCache = Map<string, ExamQuestion[]>;

const LINK_COLS = 'code, batch_id, created_by, created_at, closes_at, closed_at, duration_min, review_sent_at, session_start_at, batch:ticket_batches(title, generation_params, subject:subjects(name))';
const ATTEMPT_COLS = 'id, code, tg_user_id, student_name, ticket_id, started_at, deadline_at, finished_at, answers, score, max_score, lang';

const ms = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? Infinity : t;
};
/** Ссылка принимает новых учеников и ответы: не закрыта преподавателем и не истекла */
const linkOpen = (l: Link, now: Date) => !l.closed_at && ms(l.closes_at) > now.getTime();
/**
 * Конец приёма ответов для всех попыток запуска (мс): раньшее из конца общей сессии
 * (session_start_at + duration_min), закрытия преподавателем и истечения ссылки.
 * Сессия не начата — только закрытие. Срок самой попытки (exam_attempts.deadline_at) не используется.
 */
const effEnd = (l: Link) => Math.min(sessionEnd(l)?.getTime() ?? Infinity, ms(l.closed_at), ms(l.closes_at));
type Phase = 'waiting' | 'countdown' | 'running' | 'ended';
/** Фаза запуска по часам сервера (никогда — по данным клиента) */
const phaseOf = (l: Link, now: Date): Phase => (now.getTime() >= effEnd(l) ? 'ended' : sessionPhase(l, now));
/** Состояние незавершённой попытки = фаза запуска; сданная — finished; приём закончен — expired */
const stateOf = (a: Attempt, l: Link, now: Date): 'finished' | 'expired' | Exclude<Phase, 'ended'> => {
  if (a.finished_at) return 'finished';
  const p = phaseOf(l, now);
  return p === 'ended' ? 'expired' : p;
};
/**
 * Попытка сдана в начатой сессии (вопросы ученик видел). Закрытие запуска в ожидании или во время отсчёта
 * сдаёт попытки с нулём (finished_at = closed_at раньше старта) — такому ученику показываем «закрыто», а не балл и разбор.
 */
const inSession = (a: Attempt, l: Link) => !!l.session_start_at && !!a.finished_at && ms(a.finished_at) > ms(l.session_start_at);
/** Язык билета выбирает ученик перед началом (exam_attempts.lang); без попытки — русский */
const langOf = (a: Attempt | null): 'ru' | 'tg' => examLang(a?.lang);

async function loadLink(code: string): Promise<Link | null> {
  const { data, error } = await sb.from('exam_links').select(LINK_COLS).eq('code', code).maybeSingle();
  if (error) throw error;
  return (data as unknown as Link) ?? null;
}

async function ticketQuestions(ticketId: string, cache: QCache): Promise<ExamQuestion[]> {
  const hit = cache.get(ticketId);
  if (hit) return hit;
  const { data, error } = await sb.from('ticket_questions').select('id, order_index, question_snapshot')
    .eq('ticket_id', ticketId).order('order_index');
  if (error) throw error;
  const qs = (data ?? []).map((r: any) => ({ tqId: String(r.id), snapshot: r.question_snapshot }));
  cache.set(ticketId, qs);
  return qs;
}

async function readAttempt(code: string, tgUserId: number): Promise<Attempt | null> {
  const { data, error } = await sb.from('exam_attempts').select(ATTEMPT_COLS).eq('code', code).eq('tg_user_id', tgUserId).maybeSingle();
  if (error) throw error;
  return (data as Attempt) ?? null;
}

async function readAttemptById(id: string): Promise<Attempt | null> {
  const { data, error } = await sb.from('exam_attempts').select(ATTEMPT_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Attempt) ?? null;
}

/**
 * Сдать попытку с сохранёнными ответами. exam_attempt_close атомарно ставит finished_at и возвращает
 * итоговые ответы — после этого exam_attempt_save их уже не меняет, поэтому балл всегда соответствует
 * сохранённым ответам. Повторная или одновременная сдача безопасна: ответы те же, балл тот же.
 * Сданная попытка без балла (сбой между двумя шагами) досчитывается при следующем обращении.
 */
async function finalize(a: Attempt, cache: QCache): Promise<Attempt> {
  if (a.finished_at && a.score != null) return a;
  const { data: answers, error } = await sb.rpc('exam_attempt_close', { p_attempt_id: a.id });
  if (error) throw error;
  if (answers == null) return a; // попытку удалили вместе с набором
  const r = scoreAttempt(await ticketQuestions(a.ticket_id, cache), answers as ExamAnswers);
  const { data, error: uErr } = await sb.from('exam_attempts').update({ score: r.score, max_score: r.max })
    .eq('id', a.id).not('finished_at', 'is', null).select(ATTEMPT_COLS).maybeSingle();
  if (uErr) throw uErr;
  return (data as Attempt) ?? { ...a, answers: answers as ExamAnswers, score: r.score, max_score: r.max };
}

/**
 * При любом обращении к запуску: когда приём ответов закончился (now >= effEnd: конец общей сессии, закрытие
 * преподавателем или истечение ссылки — в том числе до старта сессии, тогда с нулём), все незавершённые попытки
 * сдаются сами; сданные без балла досчитываются. Сбой на одной попытке не ломает запуск: пишем в журнал и идём дальше.
 */
async function finishExpired(l: Link, now: Date, cache: QCache) {
  try {
    const ended = now.getTime() >= effEnd(l);
    const none = Promise.resolve({ data: [] as Attempt[], error: null });
    const [open, unscored] = await Promise.all([
      ended ? sb.from('exam_attempts').select(ATTEMPT_COLS).eq('code', l.code).is('finished_at', null).limit(500) : none,
      sb.from('exam_attempts').select(ATTEMPT_COLS).eq('code', l.code).not('finished_at', 'is', null).is('score', null).limit(500),
    ]);
    if (open.error) throw open.error;
    if (unscored.error) throw unscored.error;
    for (const a of [...(open.data ?? []), ...(unscored.data ?? [])] as Attempt[]) {
      try {
        await finalize(a, cache);
      } catch (e) {
        console.error('tg-exam finalize', a.id, e instanceof Error ? e.message : (e as any)?.message ?? e);
      }
    }
  } catch (e) {
    console.error('tg-exam finishExpired', e instanceof Error ? e.message : (e as any)?.message ?? e);
  }
}

async function ticketNumber(ticketId: string): Promise<number | null> {
  const { data, error } = await sb.from('tickets').select('ticket_number').eq('id', ticketId).maybeSingle();
  if (error) throw error;
  return (data as any)?.ticket_number ?? null;
}

/**
 * Ответ ученику. Фаза — только по часам сервера (now) против session_start_at запуска.
 * waiting / countdown: только номер варианта (и время старта) — ни вопросов, ни снимков: вопросы читаются из базы
 * лишь в ветке running. running: снимки без ответов (publicSnapshot), свои ответы и общий конец сессии.
 */
async function studentView(l: Link, a: Attempt | null, now: Date, cache: QCache) {
  const base = {
    now: Date.now(), // часы сервера (мс): клиент считает по ним остаток времени
    title: l.batch?.title ?? '',
    subject: l.batch?.subject?.name ?? '',
    minutes: l.session_start_at ? l.duration_min : null, // до «Начать» время не выбрано
    lang: langOf(a),
  };
  if (a && !a.finished_at && stateOf(a, l, now) === 'expired') a = await finalize(a, cache); // приём закончен — сдаём
  if (a?.finished_at) {
    // Запуск закрыли до старта сессии (вопросов ученик не видел) — «закрыто», без балла
    if (!inSession(a, l)) return { ...base, state: 'closed' as const };
    if (a.score == null) a = await finalize(a, cache); // сдана, но балл не записан (сбой) — досчитываем
    return { ...base, state: 'finished' as const, attempt: { score: a.score ?? 0, max: a.max_score ?? 0, review: !!l.review_sent_at } };
  }
  const st = a ? stateOf(a, l, now) : null;
  if (a && st === 'waiting') {
    return { ...base, state: 'waiting' as const, attempt: { ticketNumber: await ticketNumber(a.ticket_id) } };
  }
  if (a && st === 'countdown') {
    return {
      ...base,
      state: 'countdown' as const,
      attempt: { ticketNumber: await ticketNumber(a.ticket_id), startsAt: new Date(ms(l.session_start_at)).toISOString() },
    };
  }
  if (a && st === 'running') {
    const [questions, num] = await Promise.all([ticketQuestions(a.ticket_id, cache), ticketNumber(a.ticket_id)]);
    return {
      ...base,
      state: 'running' as const,
      attempt: {
        ticketNumber: num,
        deadline: new Date(effEnd(l)).toISOString(), // общий конец сессии (раньше — если запуск закрыт)
        // Пустое место (вопроса не нашлось) — только тип, без остальных полей снимка
        questions: questions.map((q) => ({
          tqId: q.tqId,
          snapshot: !q.snapshot || q.snapshot.empty === true ? { empty: true, type: q.snapshot?.type ?? null } : publicSnapshot(q.snapshot),
        })),
        answers: a.answers ?? {},
      },
    };
  }
  // Попытки нет: войти можно, пока ссылка открыта и сессия не кончилась (опоздавший получает остаток общего времени)
  const p = phaseOf(l, now);
  if (!a && linkOpen(l, now) && l.batch && p !== 'ended') {
    // Отсчёт уже идёт — время выбрано, для текста страницы это «сессия идёт»
    if (p === 'waiting') return { ...base, state: 'new' as const, session: 'waiting' as const };
    return { ...base, state: 'new' as const, session: 'running' as const, remainingMs: Math.max(0, effEnd(l) - now.getTime()) };
  }
  return { ...base, state: 'closed' as const };
}

// ---------------- Проверка ответа ученика ----------------
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= ID_MAX;

/** Ответ нужной формы для этого вопроса; undefined — ответ некорректен; null — стереть ответ */
function cleanAnswer(snap: any, ans: unknown): ExamAnswer | undefined {
  if (!snap || snap.empty === true) return undefined;
  if (ans === null) return null;
  if (snap.type === 'matching') {
    if (!ans || typeof ans !== 'object' || Array.isArray(ans)) return undefined;
    const items: any[] = snap.matching_items ?? [];
    const leftIds = new Set(items.filter((m) => m.side === 'left').map((m) => m.id));
    const rightIds = new Set(items.filter((m) => m.side === 'right').map((m) => m.id));
    const entries = Object.entries(ans as Record<string, unknown>);
    if (entries.length > leftIds.size) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (!leftIds.has(k)) return undefined;
      if (v === null || v === '') continue; // пункт без пары
      if (!isId(v) || !rightIds.has(v)) return undefined;
      out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  }
  if (snap.type === 'open') {
    if (typeof ans !== 'string') return undefined;
    const s = ans.trim();
    if (s.length > OPEN_MAX || !/^[+-]?\d*[.,]?\d*$/.test(s)) return undefined;
    return s === '' ? null : s;
  }
  // тест: id одного из вариантов этого вопроса
  if (!isId(ans)) return undefined;
  return (snap.options ?? []).some((o: any) => o.id === ans) ? ans : undefined;
}

/** Имя ученика: 2–80 знаков после обрезки, без управляющих символов, пробелы схлопнуты */
function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...s].length >= 2 && [...s].length <= 80 ? s : null;
}

// ---------------- Telegram ----------------
const sleep = (n: number) => new Promise((r) => setTimeout(r, n));

/** Вызов Bot API. Ошибки сети не логируем: в тексте ошибки fetch есть адрес с токеном. */
async function tgCall(method: string, payload: Record<string, unknown>): Promise<any> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json().catch(() => ({ ok: false }));
  } catch {
    return { ok: false, description: 'network error' };
  }
}

async function sendText(chat: number, text: string, markup?: Record<string, unknown>): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    const r = await tgCall('sendMessage', {
      chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(markup ? { reply_markup: markup } : {}),
    });
    if (r?.ok) return true;
    const wait = Number(r?.parameters?.retry_after);
    if (r?.error_code === 429 && wait > 0 && wait <= 10 && i === 0) { await sleep(wait * 1000); continue; }
    console.warn('tg-exam sendMessage failed:', r?.error_code, r?.description);
    return false;
  }
  return false;
}

let botUsername: string | null = null;
async function botName(): Promise<string | null> {
  if (botUsername) return botUsername;
  const r = await tgCall('getMe', {});
  botUsername = r?.ok && typeof r.result?.username === 'string' ? r.result.username : null;
  return botUsername;
}

async function teacherChat(userId: string): Promise<number | null> {
  const { data } = await sb.from('telegram_links').select('chat_id').eq('user_id', userId).maybeSingle();
  return data?.chat_id ? Number(data.chat_id) : null;
}

const NOT_LINKED = 'Привяжите Telegram: на сайте нажмите значок Telegram вверху страницы.';

// ---------------- Действия ученика ----------------
async function studentAction(action: string, body: any, tgUser: TgInitUser): Promise<Response> {
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!CODE_RE.test(code)) return json({ error: 'bad_code', message: 'Неверная ссылка на билет.' }, 400);
  const l = await loadLink(code);
  if (!l) return json({ error: 'not_found', message: 'Ссылка на билет не найдена: запуск или набор удалён.' }, 404);

  const now = new Date();
  const cache: QCache = new Map();
  // save не сдаёт чужие просроченные попытки: exam_attempt_save сам отказывает после срока и закрытия,
  // а состояние этой попытки считается ниже (stateOf + finalize); остальные действия подчищают запуск
  if (action !== 'save') await finishExpired(l, now, cache);
  let a = await readAttempt(code, tgUser.id);

  switch (action) {
    case 'open':
      return json(await studentView(l, a, now, cache));

    case 'start': {
      if (a) return json(await studentView(l, a, now, cache)); // повторный start — та же попытка
      // Вход в зал: пока ссылка открыта и сессия не кончилась; опоздавший сразу попадает в идущую сессию
      if (!linkOpen(l, now) || !l.batch || phaseOf(l, now) === 'ended') return json(await studentView(l, null, now, cache));
      const name = cleanName(body.name);
      if (!name) return json({ error: 'bad_name', message: 'Введите фамилию и имя (от 2 до 80 знаков).' }, 400);
      const { data: tickets, error: tErr } = await sb.from('tickets').select('id').eq('batch_id', l.batch_id);
      if (tErr) throw tErr;
      if (!tickets?.length) return json({ error: 'no_tickets', message: 'В наборе нет билетов.' }, 422);
      const ticket = pickVariant(tickets as Array<{ id: string }>);
      const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').slice(0, 128) || null;
      // Одна попытка на аккаунт: при гонке двух start вставка второй ничего не делает, обе читают одну строку.
      // Срок у попытки не пишется: конец общий для всех — effEnd(запуска), от времени входа он не зависит
      const { error } = await sb.from('exam_attempts').upsert({
        code, tg_user_id: tgUser.id, tg_username: tgUser.username ?? null, tg_name: tgName, student_name: name,
        ticket_id: ticket.id, started_at: now.toISOString(), lang: examLang(body.lang),
      }, { onConflict: 'code,tg_user_id', ignoreDuplicates: true });
      if (error) throw error;
      a = await readAttempt(code, tgUser.id);
      if (!a) return json({ error: 'start_failed', message: 'Не удалось начать билет. Попробуйте ещё раз.' }, 500);
      return json(await studentView(l, a, now, cache));
    }

    case 'save': {
      if (!a) return json({ ok: false, state: linkOpen(l, now) && phaseOf(l, now) !== 'ended' ? 'new' : 'closed', now: Date.now() });
      const st = stateOf(a, l, now);
      // До session_start_at (ожидание и отсчёт) — ничего не пишем; база тоже отказала бы
      if (st === 'waiting' || st === 'countdown') return json({ ok: false, state: 'waiting', now: Date.now() });
      if (st !== 'running') {
        const done = await finalize(a, cache);
        return json({ ok: false, state: done.finished_at && inSession(done, l) ? 'finished' : 'closed', now: Date.now() });
      }
      if (!isId(body.tqId)) return json({ error: 'bad_question', message: 'Некорректный вопрос.' }, 400);
      const questions = await ticketQuestions(a.ticket_id, cache);
      const q = questions.find((x) => x.tqId === body.tqId);
      if (!q) return json({ error: 'bad_question', message: 'Этого вопроса нет в вашем билете.' }, 400);
      const ans = cleanAnswer(q.snapshot, body.answer);
      if (ans === undefined) return json({ error: 'bad_answer', message: 'Некорректный ответ.' }, 400);
      // Одно атомарное обновление в базе: ответ дописывается к сохранённым и только пока попытка идёт
      // (не сдана, часы базы внутри окна сессии, ссылка не закрыта и не истекла) — иначе ничего не пишется
      const { data: saved, error } = await sb.rpc('exam_attempt_save', { p_attempt_id: a.id, p_tq_id: q.tqId, p_answer: ans });
      if (error) throw error;
      if (saved === true) return json({ ok: true, now: Date.now() });
      // Отказ: попытку сдали, срок прошёл или ссылку только что закрыли — сдаём с тем, что сохранено
      const fresh = (await loadLink(code)) ?? l;
      await finishExpired(fresh, new Date(), cache);
      const cur = await readAttemptById(a.id);
      // Попытка не сдана и приём, по часам функции, не кончился — расхождение часов функции и базы на границе
      // старта (миллисекунды): ответ не записан, клиент перечитает состояние
      if (cur && !cur.finished_at && phaseOf(fresh, new Date()) !== 'ended') return json({ ok: false, state: 'waiting', now: Date.now() });
      return json({ ok: false, state: cur?.finished_at && inSession(cur, fresh) ? 'finished' : 'closed', now: Date.now() });
    }

    case 'submit': {
      if (!a) return json({ error: 'not_started', message: 'Билет ещё не начат.' }, 409);
      // До старта сессии сдать нельзя: иначе ученик случайно закроет попытку с нулём, не увидев вопросов
      const st = stateOf(a, l, now);
      if (st === 'waiting' || st === 'countdown') {
        return json({ error: 'session_not_started', message: 'Преподаватель ещё не начал билет.' }, 409);
      }
      // После срока тоже сдаёт — с теми ответами, что успели сохраниться
      const done = await finalize(a, cache);
      return json({ score: done.score ?? 0, max: done.max_score ?? 0, now: Date.now() });
    }

    case 'review': {
      if (!a?.finished_at || !l.review_sent_at || !inSession(a, l)) {
        return json({ error: 'review_not_ready', message: 'Разбор появится, когда преподаватель его отправит.' }, 403);
      }
      const questions = await ticketQuestions(a.ticket_id, cache);
      const answers = (a.answers ?? {}) as ExamAnswers;
      const items = scoreAttempt(questions, answers).items;
      return json({
        questions: questions.map((q, i) => ({
          // Без лишних полей снимка: тексты, картинки и только три поля ключа
          tqId: q.tqId, snapshot: reviewSnapshot(q.snapshot), answer: answers[q.tqId] ?? null, points: items[i].points, max: items[i].max,
        })),
      });
    }
  }
  return json({ error: 'Неизвестное действие' }, 400);
}

// ---------------- Действия преподавателя ----------------
async function teacherAction(action: string, body: any, userId: string): Promise<Response> {
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const l = CODE_RE.test(code) ? await loadLink(code) : null;
  let allowed = !!l && l.created_by === userId;
  if (l && !allowed) {
    const { data: prof } = await sb.from('profiles').select('is_owner').eq('id', userId).maybeSingle();
    allowed = prof?.is_owner === true;
  }
  // Чужой запуск и несуществующий — один ответ: по коду нельзя узнать, есть ли такой запуск
  if (!l || !allowed) return json({ error: 'Запуск не найден' }, 404);

  const now = new Date();
  const cache: QCache = new Map();
  await finishExpired(l, now, cache);
  const title = tgPlain(l.batch?.title || 'Билет');

  switch (action) {
    case 'review_send': {
      // Пока ссылка открыта, разбор (с верными ответами) переслали бы тем, кто ещё пишет
      if (linkOpen(l, now)) return json({ error: 'Сначала закройте запуск: иначе ответы увидят те, кто ещё проходит билет.' }, 409);
      // Двойной щелчок или повтор запроса: вторая рассылка сразу после первой не нужна (409, клиент покажет это спокойно)
      if (reviewJustSent(l.review_sent_at, now)) return json({ error: 'Разбор только что отправлен.' }, 409);
      const { data, error } = await sb.from('exam_attempts').select(ATTEMPT_COLS).eq('code', code)
        .not('finished_at', 'is', null).order('finished_at').limit(500);
      if (error) throw error;
      // Отметка ставится до рассылки: кнопка «Открыть с формулами и рисунками» должна работать сразу
      const { error: uErr } = await sb.from('exam_links').update({ review_sent_at: now.toISOString() }).eq('code', code);
      if (uErr) throw uErr;
      let sent = 0, failed = 0, first = true;
      // Разбор — только тем, кто писал в начатой сессии (закрытые в ожидании вопросов не видели)
      for (const a of ((data ?? []) as Attempt[]).filter((x) => inSession(x, l))) {
        const lang = langOf(a); // каждому ученику — на языке его попытки
        const button = { inline_keyboard: [[{ text: reviewButtonText(lang), web_app: { url: `${EXAM_URL}?c=${code}&review=1` } }]] };
        const questions = await ticketQuestions(a.ticket_id, cache);
        const head = reviewHead(title, a.score ?? 0, a.max_score ?? 0, lang);
        const parts = chunkLines([head, ...reviewLines(questions, (a.answers ?? {}) as ExamAnswers, lang)]);
        let ok = true;
        for (let i = 0; i < parts.length && ok; i++) {
          if (!first) await sleep(50);
          first = false;
          ok = await sendText(Number(a.tg_user_id), parts[i], i === parts.length - 1 ? button : undefined);
        }
        if (ok) sent++; else failed++;
      }
      return json({ sent, failed });
    }

    case 'link_send': {
      const chat = await teacherChat(userId);
      if (!chat) return json({ error: NOT_LINKED }, 400);
      if (!linkOpen(l, now)) return json({ error: 'Запуск уже закрыт.' }, 409);
      if (phaseOf(l, now) === 'ended') return json({ error: 'Время билета уже закончилось.' }, 409);
      const bot = await botName();
      if (!bot) return json({ error: 'Не удалось получить имя бота. Попробуйте ещё раз.' }, 502);
      const url = `https://t.me/${bot}?start=exam_${code}`;
      const subject = l.batch?.subject?.name ? `\nПредмет: ${tgPlain(l.batch.subject.name)}` : '';
      const text = `📝 <b>Билет: ${title}</b>${subject}\nВремя назначит преподаватель, попытка одна.\nОткройте ссылку и нажмите «Начать билет»:\n${url}`;
      const ok = await sendText(chat, text, { inline_keyboard: [[{ text: '📝 Начать билет', url }]] });
      return ok ? json({ ok: true }) : json({ error: 'Бот не смог написать вам: откройте бота в Telegram и нажмите «Start».' }, 502);
    }

    case 'notify_closed': {
      const chat = await teacherChat(userId);
      if (!chat) return json({ error: NOT_LINKED }, 400);
      const { data, error } = await sb.from('exam_attempts').select('finished_at, score, max_score').eq('code', code).limit(1000);
      if (error) throw error;
      const rows = data ?? [];
      const done = rows.filter((r: any) => r.finished_at);
      const avg = (k: 'score' | 'max_score') => done.reduce((s: number, r: any) => s + (r[k] ?? 0), 0) / (done.length || 1);
      const fmt = (n: number) => (Math.round(n * 10) / 10).toString().replace('.', ',');
      const lines = [`🏁 <b>Итог: ${title}</b>`, `Сдали: ${done.length} из ${rows.length} начавших.`];
      if (done.length) lines.push(`Средний балл: ${fmt(avg('score'))} из ${fmt(avg('max_score'))}.`);
      const ok = await sendText(chat, lines.join('\n'));
      return ok ? json({ ok: true, finished: done.length, started: rows.length }) : json({ error: 'Бот не смог написать вам: откройте бота в Telegram и нажмите «Start».' }, 502);
    }
  }
  return json({ error: 'Неизвестное действие' }, 400);
}

const STUDENT_ACTIONS = new Set(['open', 'start', 'save', 'submit', 'review']);
const TEACHER_ACTIONS = new Set(['review_send', 'link_send', 'notify_closed']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405);

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: 'Слишком большой запрос' }, 413);
    let body: any = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* пустое тело */ }
    if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
    const action = typeof body.action === 'string' ? body.action : '';

    if (STUDENT_ACTIONS.has(action)) {
      const tgUser = await verifyInitData(req.headers.get('X-Tg-Init-Data') ?? '', BOT_TOKEN, MAX_AGE_SEC);
      if (!tgUser) return json({ error: 'bad_init_data', message: 'Откройте билет из Telegram.' }, 401);
      return await studentAction(action, body, tgUser);
    }

    if (TEACHER_ACTIONS.has(action)) {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (!token) return json({ error: 'Требуется авторизация' }, 401);
      const { data: auth, error: authErr } = await sb.auth.getUser(token);
      if (authErr || !auth?.user) return json({ error: 'Недействительная сессия' }, 401);
      return await teacherAction(action, body, auth.user.id);
    }

    return json({ error: 'Неизвестное действие' }, 400);
  } catch (err) {
    // Ошибки базы безопасны для журнала; сетевые ошибки Telegram сюда не доходят (см. tgCall)
    console.error('tg-exam', err instanceof Error ? err.message : err);
    return json({ error: 'Внутренняя ошибка. Попробуйте ещё раз.' }, 500);
  }
});
