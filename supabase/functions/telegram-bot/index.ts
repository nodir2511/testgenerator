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
import * as T from '../_shared/ticketing.ts';
import { generateAndSend, limitsFor, linkedUser as linkedUserOf } from '../_shared/generate.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')!;
const APP_URL = Deno.env.get('MINIAPP_URL') || 'https://testgenerator-3s51.vercel.app/tg';

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

const linkedUser = (chat: number) => linkedUserOf(sb, chat);

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

const prompts = (lim: { perType: number; tickets: number }): Record<string, string> => ({
  test: `Сколько тестовых вопросов в билете? Отправьте число (0–${lim.perType}).`,
  matching: `Сколько заданий на соответствие в билете? Отправьте число (0–${lim.perType}).`,
  open: `Сколько открытых вопросов в билете? Отправьте число (0–${lim.perType}).`,
  title: 'Отправьте название билетов (до 100 символов).',
  tickets: `Сколько билетов (вариантов) создать? Отправьте число (1–${lim.tickets}).`,
});

// ---------------- Генерация ----------------
async function generate(chat: number, msgId: number | undefined, st: State, user: any, lang: 'ru' | 'tg' | 'both') {
  const s = st.settings;
  const bad = T.checkSettings(s, limitsFor(user));
  if (bad) return send(chat, `⚠️ ${bad}`, T.kbSettings(s));
  try {
    await generateAndSend({
      sb, botToken: BOT_TOKEN, chat, user, lang, settings: s, source: 'telegram',
      sel: { subjectId: st.subjectId!, chapterIds: st.chapterIds, topicIds: st.topicIds },
      onNotes: async (notes) => { await send(chat, 'ℹ️ Вопросов не хватает, билеты составлены из того, что есть:\n• ' + notes.join('\n• ')); },
    });
  } catch (e) {
    if (/нет вопросов нужных видов/.test((e as Error).message)) return send(chat, `⚠️ ${(e as Error).message}`, T.kbSettings(s));
    throw e;
  }
  await send(chat, '✅ Готово. Новый набор: /ticket');
}

// ---------------- Обработка апдейтов ----------------
const HELP = 'Команды:\n/app — открыть приложение (удобнее всего)\n/ticket — создать билеты в чате\n/unlink — отвязать аккаунт\n/help — помощь';

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
  if (text === '/app') {
    return tg('sendMessage', { chat_id: chat, text: 'Откройте приложение, чтобы собрать билеты:', reply_markup: { inline_keyboard: [[{ text: '📝 Создать билеты', web_app: { url: APP_URL } }]] } });
  }
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
      const max = a === 'tickets' ? limitsFor(user).tickets : limitsFor(user).perType;
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
    return send(chat, prompts(limitsFor(user))[st.awaiting!]);
  }
  if (data === 'O:opt' || data === 'O:mat') {
    if (data === 'O:opt') st.settings.shuffleOptions = !st.settings.shuffleOptions;
    else st.settings.shuffleMatching = !st.settings.shuffleMatching;
    return screenSettings(chat, msgId, st);
  }
  if (data === 'SN') {
    const bad = T.checkSettings(st.settings, limitsFor(user));
    if (bad) return send(chat, `⚠️ ${bad}`);
    const fit = T.fitSettings(await countPool(st), st.settings);
    if (fit.error) return send(chat, `⚠️ ${fit.error}`);
    if (fit.notes.length) await send(chat, `ℹ️ Вопросов не хватает — возьмём сколько есть:\n• ${fit.notes.join('\n• ')}`);
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
