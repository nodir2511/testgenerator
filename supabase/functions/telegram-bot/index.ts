// Edge Function: telegram-bot
//
// Telegram-бот для генерации экзаменационных билетов. Те же настройки, что на сайте:
// предмет, главы, темы, число тестов/соответствий/открытых, число билетов,
// перемешивание вариантов и соответствий, название, язык. Готовый файл Word
// (или ZIP) присылается в чат.
//
// Доступ: только преподаватели с привязанным аккаунтом (код из приложения).
// Деплой:  supabase functions deploy telegram-bot --no-verify-jwt
// Секреты: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (SUPABASE_URL и
//          SUPABASE_SERVICE_ROLE_KEY задаёт сам Supabase).

import { createClient } from 'npm:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3';
import { buildSingleTicketBlob } from '../_shared/docxExport.ts';
import * as T from '../_shared/ticketing.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')!;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ---------------- Telegram API ----------------
async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) console.warn(`telegram ${method} failed:`, json.description);
  return json;
}

const send = (chat: number, text: string, kb?: T.Kb) =>
  tg('sendMessage', { chat_id: chat, text, ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) });

async function show(chat: number, msgId: number | undefined, text: string, kb?: T.Kb) {
  if (msgId) {
    const r = await tg('editMessageText', {
      chat_id: chat, message_id: msgId, text,
      ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}),
    });
    if (r.ok || /not modified/i.test(r.description || '')) return;
  }
  await send(chat, text, kb);
}

async function sendDocument(chat: number, bytes: Uint8Array, filename: string, caption: string) {
  const form = new FormData();
  form.append('chat_id', String(chat));
  form.append('caption', caption);
  form.append('document', new Blob([bytes]), filename);
  const res = await fetch(`${API}/sendDocument`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Не удалось отправить файл: ${json.description || res.status}`);
}

// ---------------- Сессии и пользователи ----------------
interface State {
  step: 'subject' | 'chapters' | 'topics' | 'settings' | 'lang';
  subjectId?: string;
  chapterIds: string[];
  topicIds: string[]; // итоговый набор тем ([] = все темы выбранных глав)
  topicSel: string[]; // отметки пользователя
  topicCh: number; // индекс главы, темы которой выбираем
  settings: T.Settings;
  awaiting: null | 'test' | 'matching' | 'open' | 'tickets' | 'title';
  busyAt?: number;
}

const freshState = (settings?: T.Settings): State => ({
  step: 'subject', chapterIds: [], topicIds: [], topicSel: [], topicCh: 0,
  settings: settings ?? { ...T.DEFAULT_SETTINGS }, awaiting: null,
});

async function loadState(chat: number): Promise<State> {
  const { data } = await sb.from('telegram_sessions').select('state').eq('chat_id', chat).maybeSingle();
  return (data?.state as State) ?? freshState();
}
async function saveState(chat: number, st: State) {
  await sb.from('telegram_sessions').upsert({ chat_id: chat, state: st, updated_at: new Date().toISOString() });
}

async function linkedUser(chat: number) {
  const { data: link } = await sb.from('telegram_links').select('user_id').eq('chat_id', chat).maybeSingle();
  if (!link) return null;
  const { data: profile } = await sb.from('profiles').select('id, full_name, email, role').eq('id', link.user_id).maybeSingle();
  return profile ?? null;
}

// ---------------- Данные ----------------
async function subjects() {
  const { data } = await sb.from('subjects').select('id, name').eq('is_deleted', false).order('name');
  return data ?? [];
}
async function chaptersOf(subjectId: string) {
  const { data } = await sb.from('chapters').select('id, name').eq('subject_id', subjectId).eq('is_deleted', false).order('order_index');
  return data ?? [];
}
async function topicsOf(chapterIds: string[]) {
  if (!chapterIds.length) return [];
  const { data } = await sb.from('topics').select('id, name, chapter_id, order_index').in('chapter_id', chapterIds).eq('is_deleted', false).order('chapter_id').order('order_index');
  return data ?? [];
}

async function countPool(st: State) {
  const base = () => {
    let q = sb.from('questions').select('*', { count: 'exact', head: true }).eq('subject_id', st.subjectId!).eq('is_deleted', false);
    if (st.topicIds.length) q = q.in('topic_id', st.topicIds);
    else q = q.in('chapter_id', st.chapterIds);
    return q;
  };
  const [t, m, o] = await Promise.all(['test', 'matching', 'open'].map((ty) => base().eq('type', ty)));
  return { total: (t.count ?? 0) + (m.count ?? 0) + (o.count ?? 0), test: t.count ?? 0, matching: m.count ?? 0, open: o.count ?? 0 };
}

async function loadPool(st: State) {
  const all: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from('questions')
      .select('*, chapter:chapters(name), topic:topics(name), options:question_options(*), matching_items:matching_items(*)')
      .eq('subject_id', st.subjectId!).eq('is_deleted', false).order('id');
    if (st.topicIds.length) q = q.in('topic_id', st.topicIds);
    else q = q.in('chapter_id', st.chapterIds);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

// ---------------- Экраны ----------------
async function screenSubjects(chat: number, msgId?: number) {
  const list = await subjects();
  if (!list.length) return show(chat, msgId, 'В базе нет предметов.');
  const st = await loadState(chat);
  if (list.length === 1) {
    st.subjectId = list[0].id;
    return screenChapters(chat, msgId, st);
  }
  st.step = 'subject';
  await saveState(chat, st);
  return show(chat, msgId, 'Выберите предмет:', T.kbSubjects(list));
}

async function screenChapters(chat: number, msgId: number | undefined, st: State) {
  const list = await chaptersOf(st.subjectId!);
  if (!list.length) return show(chat, msgId, 'У предмета нет глав.');
  st.step = 'chapters';
  await saveState(chat, st);
  return show(chat, msgId, T.chaptersText(list, st.chapterIds), T.kbChapters(list, st.chapterIds));
}

async function screenTopics(chat: number, msgId: number | undefined, st: State) {
  const chs = await chaptersOf(st.subjectId!);
  const ch = chs.find((c) => c.id === st.chapterIds[st.topicCh ?? 0]);
  if (!ch) return screenChapters(chat, msgId, st);
  const list = await topicsOf([ch.id]);
  st.step = 'topics';
  await saveState(chat, st);
  const last = (st.topicCh ?? 0) >= st.chapterIds.length - 1;
  return show(chat, msgId, T.topicsText(ch.name, st.topicCh ?? 0, st.chapterIds.length, list, st.topicSel), T.kbTopics(list, st.topicSel, last));
}

// Итоговый набор тем: у главы без отметок берутся все её темы
async function finalizeTopics(st: State) {
  const all = await topicsOf(st.chapterIds);
  const ids: string[] = [];
  let any = false;
  for (const chId of st.chapterIds) {
    const mine = all.filter((t) => t.chapter_id === chId);
    const sel = mine.filter((t) => st.topicSel.includes(t.id));
    if (sel.length) any = true;
    ids.push(...(sel.length ? sel : mine).map((t) => t.id));
  }
  st.topicIds = any ? ids : [];
}

async function screenSettings(chat: number, msgId: number | undefined, st: State) {
  st.step = 'settings';
  st.awaiting = null;
  await saveState(chat, st);
  const subj = (await subjects()).find((s) => s.id === st.subjectId)?.name ?? '';
  const chs = (await chaptersOf(st.subjectId!)).filter((c) => st.chapterIds.includes(c.id)).map((c) => c.name);
  const stats = await countPool(st);
  return show(chat, msgId, T.settingsText(subj, chs, st.topicIds.length, st.settings, stats), T.kbSettings(st.settings));
}

const PROMPTS: Record<string, string> = {
  test: 'Сколько тестовых вопросов в билете? Отправьте число (0–100).',
  matching: 'Сколько заданий на соответствие в билете? Отправьте число (0–100).',
  open: 'Сколько открытых вопросов в билете? Отправьте число (0–100).',
  tickets: `Сколько билетов (вариантов) создать? Отправьте число (1–${T.LIMITS.tickets}).`,
  title: 'Отправьте название билетов (до 100 символов).',
};

// ---------------- Генерация ----------------
async function generate(chat: number, msgId: number | undefined, st: State, user: any, lang: 'ru' | 'tg' | 'both') {
  const s = st.settings;
  const bad = T.checkSettings(s);
  if (bad) return send(chat, `⚠️ ${bad}`, T.kbSettings(s));

  const pool = await loadPool(st);
  const err = T.checkPool(T.poolStats(pool), s);
  if (err) return send(chat, `⚠️ ${err}`, T.kbSettings(s));

  const tickets = T.buildTickets(pool, s);
  const title = s.title.trim() || 'Экзаменационные билеты';
  const subjectName = (await subjects()).find((x) => x.id === st.subjectId)?.name ?? 'Химия';

  // сохраняем партию, как это делает сайт
  const { data: batch, error: bErr } = await sb.from('ticket_batches').insert({
    title, subject_id: st.subjectId, created_by: user.id,
    generation_params: {
      chapter_ids: st.chapterIds, topic_ids: st.topicIds,
      test_count: s.testCount, matching_count: s.matchingCount, open_count: s.openCount, ticket_count: s.ticketCount,
      shuffle_options: s.shuffleOptions, shuffle_matching: s.shuffleMatching, source: 'telegram',
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
    details: { tickets: s.ticketCount, lang, chat_id: chat },
  });

  // файлы Word
  const shaped = tickets.map((t) => ({ ticket_number: t.ticketNumber, questions: t.questions.map((q: any) => ({ question_snapshot: q.question_snapshot })) }));
  const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
  const files: Array<{ name: string; data: Uint8Array }> = [];
  for (const t of shaped) {
    if (lang === 'ru' || lang === 'both') files.push({ name: lang === 'both' ? `Русский/Вариант ${t.ticket_number}.docx` : `Вариант ${t.ticket_number}.docx`, data: await bytes(await buildSingleTicketBlob(title, t, subjectName, false)) });
    if (lang === 'tg' || lang === 'both') files.push({ name: lang === 'both' ? `Тоҷикӣ/Варианти ${t.ticket_number}.docx` : `Варианти ${t.ticket_number}.docx`, data: await bytes(await buildSingleTicketBlob(title, t, subjectName, true)) });
  }

  const caption = `${title}: ${s.ticketCount} шт. (${lang === 'both' ? 'RU + TG' : lang.toUpperCase()})`;
  if (files.length === 1) {
    await sendDocument(chat, files[0].data, files[0].name, caption);
  } else {
    const zip = new JSZip();
    files.forEach((f) => zip.file(f.name, f.data));
    const zbytes = await zip.generateAsync({ type: 'uint8array' });
    const suffix = lang === 'both' ? 'RU_TG' : lang.toUpperCase();
    await sendDocument(chat, zbytes, `${T.safeFileName(title)}_${suffix}.zip`, caption);
  }
  await send(chat, '✅ Готово. Новый набор: /ticket');
}

// ---------------- Обработка апдейтов ----------------
const HELP = 'Команды:\n/ticket — создать билеты\n/unlink — отвязать аккаунт\n/help — помощь';

async function onMessage(m: any) {
  const chat: number = m.chat.id;
  const text: string = (m.text ?? '').trim();
  if (m.chat.type !== 'private') return;

  // привязка по коду
  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1]?.toUpperCase();
    if (!code) {
      const u = await linkedUser(chat);
      return send(chat, u ? `Вы вошли как ${u.full_name || u.email}.\n${HELP}` : 'Это бот генератора билетов. Откройте на сайте «Telegram», получите код и отправьте мне: /start КОД');
    }
    const { data: row } = await sb.from('telegram_link_codes').select('user_id, expires_at').eq('code', code).maybeSingle();
    if (!row || new Date(row.expires_at) < new Date()) return send(chat, 'Код недействителен или устарел. Получите новый на сайте.');
    await sb.from('telegram_links').delete().eq('user_id', row.user_id);
    const { error } = await sb.from('telegram_links').upsert({ chat_id: chat, user_id: row.user_id });
    await sb.from('telegram_link_codes').delete().eq('code', code);
    if (error) return send(chat, 'Не удалось привязать аккаунт.');
    return send(chat, `✅ Аккаунт привязан.\n${HELP}`);
  }

  const user = await linkedUser(chat);
  if (!user) return send(chat, 'Сначала привяжите аккаунт: на сайте нажмите «Telegram», получите код и отправьте мне /start КОД');

  if (text === '/unlink') {
    await sb.from('telegram_links').delete().eq('chat_id', chat);
    await sb.from('telegram_sessions').delete().eq('chat_id', chat);
    return send(chat, 'Аккаунт отвязан.');
  }
  if (text === '/help') return send(chat, HELP);
  if (text === '/ticket' || text === '/new') {
    const old = await loadState(chat);
    await saveState(chat, freshState(old.settings));
    return screenSubjects(chat);
  }

  // ответ на вопрос «введите число/название»
  const st = await loadState(chat);
  if (st.awaiting) {
    const a = st.awaiting;
    if (a === 'title') {
      const t = text.slice(0, 100);
      if (!t) return send(chat, 'Название не может быть пустым.');
      st.settings.title = t;
    } else {
      const max = a === 'tickets' ? T.LIMITS.tickets : T.LIMITS.perType;
      const n = T.parseCount(text, max, a === 'tickets' ? 1 : 0);
      if (n === null) return send(chat, `Нужно целое число от ${a === 'tickets' ? 1 : 0} до ${max}.`);
      if (a === 'test') st.settings.testCount = n;
      if (a === 'matching') st.settings.matchingCount = n;
      if (a === 'open') st.settings.openCount = n;
      if (a === 'tickets') st.settings.ticketCount = n;
    }
    return screenSettings(chat, undefined, st);
  }
  if (st.step === 'chapters' || st.step === 'topics') {
    const isCh = st.step === 'chapters';
    const items: Array<{ id: string; name: string }> = isCh
      ? await chaptersOf(st.subjectId!)
      : await topicsOf([st.chapterIds[st.topicCh ?? 0]]);
    const nums = T.parseNumbers(text, items.length);
    if (nums === null) return send(chat, `Не понял. Отправьте номера, например 1-3, 5 — или нажмите кнопки. Допустимо от 1 до ${items.length}.`);
    const ids = nums === 'all' ? items.map((i) => i.id) : nums.map((n) => items[n - 1].id);
    if (isCh) {
      st.chapterIds = ids;
      await saveState(chat, st);
      return screenChapters(chat, undefined, st);
    }
    const mine = items.map((i) => i.id);
    // «все» в темах = ничего не отмечено = все темы главы
    st.topicSel = [...st.topicSel.filter((id) => !mine.includes(id)), ...(nums === 'all' ? [] : ids)];
    return screenTopics(chat, undefined, st);
  }
  return send(chat, HELP);
}

async function onCallback(cb: any) {
  const chat: number = cb.message.chat.id;
  const msgId: number = cb.message.message_id;
  const data: string = cb.data ?? '';
  await tg('answerCallbackQuery', { callback_query_id: cb.id });

  const user = await linkedUser(chat);
  if (!user) return send(chat, 'Сначала привяжите аккаунт: /start КОД');
  const st = await loadState(chat);
  if (data.startsWith('L:') && st.busyAt && Date.now() - st.busyAt < 180000) return;

  if (data === 'NOOP') return;

  if (data.startsWith('S:')) {
    const list = await subjects();
    const s = list[+data.slice(2)];
    if (!s) return;
    st.subjectId = s.id; st.chapterIds = []; st.topicIds = [];
    return screenChapters(chat, msgId, st);
  }
  if (data.startsWith('C:') || data === 'CA' || data === 'CR' || data === 'CN') {
    const list = await chaptersOf(st.subjectId!);
    if (data === 'CA') st.chapterIds = list.map((c) => c.id);
    else if (data === 'CR') st.chapterIds = [];
    else if (data.startsWith('C:')) { const c = list[+data.slice(2)]; if (c) st.chapterIds = T.toggle(st.chapterIds, c.id); }
    else if (data === 'CN') {
      if (!st.chapterIds.length) return send(chat, 'Выберите хотя бы одну главу.');
      st.chapterIds = list.filter((c) => st.chapterIds.includes(c.id)).map((c) => c.id);
      st.topicIds = []; st.topicSel = []; st.topicCh = 0;
      return screenTopics(chat, msgId, st);
    }
    await saveState(chat, st);
    return show(chat, msgId, T.chaptersText(list, st.chapterIds), T.kbChapters(list, st.chapterIds));
  }
  if (data === 'BC') return screenChapters(chat, msgId, st);
  if (data.startsWith('T:') || data === 'TX' || data === 'TB' || data === 'TN' || data === 'BT') {
    const cur = st.topicCh ?? 0;
    const list = await topicsOf([st.chapterIds[cur]]);
    if (data === 'TX') {
      const mine = list.map((t) => t.id);
      st.topicSel = st.topicSel.filter((id) => !mine.includes(id));
    } else if (data.startsWith('T:')) {
      const t = list[+data.slice(2)];
      if (t) st.topicSel = T.toggle(st.topicSel, t.id);
    } else if (data === 'TB') {
      if (cur <= 0) return screenChapters(chat, msgId, st);
      st.topicCh = cur - 1;
    } else if (data === 'TN') {
      if (cur < st.chapterIds.length - 1) st.topicCh = cur + 1;
      else { await finalizeTopics(st); return screenSettings(chat, msgId, st); }
    } else if (data === 'BT') {
      st.topicCh = Math.max(0, st.chapterIds.length - 1);
    }
    return screenTopics(chat, msgId, st);
  }
  if (data === 'BS') return screenSettings(chat, msgId, st);
  if (data.startsWith('V:')) {
    st.awaiting = data.slice(2) as State['awaiting'];
    await saveState(chat, st);
    return send(chat, PROMPTS[st.awaiting!]);
  }
  if (data === 'O:opt' || data === 'O:mat') {
    if (data === 'O:opt') st.settings.shuffleOptions = !st.settings.shuffleOptions;
    else st.settings.shuffleMatching = !st.settings.shuffleMatching;
    return screenSettings(chat, msgId, st);
  }
  if (data === 'SN') {
    const bad = T.checkSettings(st.settings);
    if (bad) return send(chat, `⚠️ ${bad}`);
    const err = T.checkPool(await countPool(st), st.settings);
    if (err) return send(chat, `⚠️ ${err}`);
    st.step = 'lang';
    await saveState(chat, st);
    return show(chat, msgId, 'На каком языке подготовить файлы?', T.kbLang());
  }
  if (data.startsWith('L:')) {
    const lang = data.slice(2) as 'ru' | 'tg' | 'both';
    st.busyAt = Date.now();
    await saveState(chat, st);
    await show(chat, msgId, '⏳ Формирую билеты, это может занять до минуты…');
    try {
      await generate(chat, msgId, st, user, lang);
    } catch (e) {
      console.error('generate failed', e);
      await send(chat, `❌ Ошибка: ${(e as Error).message || e}`);
    } finally {
      st.busyAt = undefined;
      st.step = 'settings';
      await saveState(chat, st);
    }
  }
}

async function handle(update: any) {
  try {
    if (update.message) await onMessage(update.message);
    else if (update.callback_query) await onCallback(update.callback_query);
  } catch (e) {
    console.error('update failed', e);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await req.json().catch(() => null);
  if (!update) return new Response('bad request', { status: 400 });
  // Отвечаем Telegram сразу, работу делаем в фоне — чтобы он не повторял запрос
  const work = handle(update);
  // @ts-ignore EdgeRuntime есть в среде Supabase
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return new Response('ok');
});
