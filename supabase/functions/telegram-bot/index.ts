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
import { allowedSubjectIds, generateAndSend, limitsFor, linkedUser as linkedUserOf } from '../_shared/generate.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')!;
const APP_URL = Deno.env.get('MINIAPP_URL') || 'https://testgenerator-3s51.vercel.app/tg';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ---------------- Постоянное нижнее меню (Reply Keyboard) ----------------
const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '🚀 Конструктор билетов', web_app: { url: APP_URL } }],
    [{ text: '⚡ Быстрый билет' }, { text: '📂 Мои билеты' }],
    [{ text: 'ℹ️ Профиль и лимиты' }, { text: '❓ Помощь' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

const send = (chat: number, text: string, kb?: T.Kb, replyMarkup?: Record<string, unknown>) => {
  const markup = kb && kb.length > 0
    ? { inline_keyboard: kb }
    : (replyMarkup || MAIN_KEYBOARD);
  return tg('sendMessage', {
    chat_id: chat,
    text,
    parse_mode: 'HTML',
    reply_markup: markup,
  });
};

async function show(chat: number, msgId: number | undefined, text: string, kb?: T.Kb, replyMarkup?: Record<string, unknown>) {
  if (msgId) {
    const r = await tg('editMessageText', {
      chat_id: chat,
      message_id: msgId,
      text,
      parse_mode: 'HTML',
      ...(kb && kb.length > 0 ? { reply_markup: { inline_keyboard: kb } } : {}),
    });
    if (r.ok || /not modified/i.test(r.description || '')) return;
  }
  await send(chat, text, kb, replyMarkup);
}

// Анимированный индикатор прогресса в реальном времени
async function runWithLiveProgress<T>(chat: number, msgId: number, fn: () => Promise<T>): Promise<T> {
  const stages = [
    '⏳ <b>[■□□□□] 20%</b> · Загрузка вопросов из пула...',
    '⏳ <b>[■■□□□] 50%</b> · Балансировка тем без повторов...',
    '⏳ <b>[■■■□□] 75%</b> · Оформление вариантов Word (.docx)...',
    '⏳ <b>[■■■■□] 90%</b> · Формирование матрицы ключей ответов...',
  ];
  let stageIdx = 0;
  await tg('editMessageText', {
    chat_id: chat,
    message_id: msgId,
    text: stages[0],
    parse_mode: 'HTML',
  }).catch(() => {});

  const interval = setInterval(async () => {
    stageIdx++;
    if (stageIdx < stages.length) {
      await tg('editMessageText', {
        chat_id: chat,
        message_id: msgId,
        text: stages[stageIdx],
        parse_mode: 'HTML',
      }).catch(() => {});
    }
  }, 2200);

  try {
    const res = await fn();
    clearInterval(interval);
    await tg('editMessageText', {
      chat_id: chat,
      message_id: msgId,
      text: '✨ <b>[■■■■■] 100%</b> · Билеты готовы! Отправляю документ...',
      parse_mode: 'HTML',
    }).catch(() => {});
    return res;
  } finally {
    clearInterval(interval);
  }
}

// ---------------- Сессии и пользователи ----------------
interface State {
  step: 'subject' | 'chapters' | 'topics' | 'settings' | 'lang';
  subjectId?: string;
  chapterIds: string[];
  topicIds: string[];
  topicSel: string[];
  topicCh: number;
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
async function subjects(user: { id: string; role?: string }) {
  const { data } = await sb.from('subjects').select('id, name').eq('is_deleted', false).order('name');
  const allowed = await allowedSubjectIds(sb, user);
  return (data ?? []).filter((s: any) => !allowed || allowed.includes(s.id));
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
async function screenStart(chat: number, user: any) {
  const [limits, userSubs] = await Promise.all([limitsFor(sb, user), subjects(user)]);
  const shift = 5 * 3600 * 1000;
  const local = Date.now() + shift;
  const dayStart = new Date(local - (local % 86400000) - shift).toISOString();
  const { count: usageCount } = await sb.from('generation_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', dayStart);

  const rem = Number.isFinite(limits.perDay) ? Math.max(0, limits.perDay - (usageCount ?? 0)) : '∞';
  const perDayStr = Number.isFinite(limits.perDay) ? `${limits.perDay} в сутки` : 'без ограничений';
  const roleName = user.role === 'admin' ? '👑 Администратор' : '🎓 Преподаватель';

  const text = (
    `👋 <b>Здравствуйте, ${escapeHtml(user.full_name || user.email)}!</b>\n\n` +
    `Добро пожаловать в генератор экзаменационных билетов.\n\n` +
    `📊 <b>Ваш статус:</b>\n` +
    `• <b>Роль:</b> ${roleName}\n` +
    `• <b>Осталось на сегодня:</b> ${rem} из ${perDayStr}\n` +
    `• <b>Максимум в наборе:</b> до ${limits.tickets} вариантов\n` +
    `• <b>Предметы:</b> ${userSubs.map((s: any) => escapeHtml(s.name)).join(', ') || 'все доступные'}\n\n` +
    `👇 Выберите действие в нижнем меню:`
  );

  const kb = [
    [{ text: '🚀 Открыть конструктор билетов', web_app: { url: APP_URL } }],
    [{ text: '⚡ Быстрый билет в 1 клик', callback_data: 'ACT:QUICK' }],
    [{ text: '📂 Мои билеты (История)', callback_data: 'ACT:HISTORY' }],
  ];

  return send(chat, text, kb, MAIN_KEYBOARD);
}

async function screenProfile(chat: number, user: any) {
  const [limits, userSubs] = await Promise.all([limitsFor(sb, user), subjects(user)]);
  const shift = 5 * 3600 * 1000;
  const local = Date.now() + shift;
  const dayStart = new Date(local - (local % 86400000) - shift).toISOString();
  const { count: usageCount } = await sb.from('generation_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', dayStart);

  const rem = Number.isFinite(limits.perDay) ? Math.max(0, limits.perDay - (usageCount ?? 0)) : 'без ограничений';
  const perDayStr = Number.isFinite(limits.perDay) ? `${limits.perDay} в сутки` : 'без ограничений';

  const text = (
    `👤 <b>Профиль преподавателя</b>\n\n` +
    `• <b>ФИО:</b> ${escapeHtml(user.full_name || 'Не указано')}\n` +
    `• <b>Email:</b> ${escapeHtml(user.email || '—')}\n` +
    `• <b>Роль:</b> ${user.role === 'admin' ? '👑 Администратор' : '🎓 Преподаватель'}\n` +
    `• <b>Назначено предметов:</b> ${userSubs.length} (${userSubs.map((s: any) => escapeHtml(s.name)).join(', ') || 'все'})\n\n` +
    `📊 <b>Лимиты генерации:</b>\n` +
    `• <b>Осталось на сегодня:</b> ${rem}\n` +
    `• <b>Дневной лимит:</b> ${perDayStr}\n` +
    `• <b>Максимум вариантов за раз:</b> до ${limits.tickets} шт.\n` +
    `• <b>Вопросов в билете:</b> до ${limits.total ?? 50} шт.`
  );

  const kb = [
    [{ text: '🚀 Открыть конструктор билетов', web_app: { url: APP_URL } }],
    [{ text: '🔓 Отвязать аккаунт от Telegram', callback_data: 'ACT:UNLINK' }],
  ];

  return send(chat, text, kb, MAIN_KEYBOARD);
}

async function screenMyTickets(chat: number, user: any) {
  const { data: batches } = await sb.from('ticket_batches')
    .select('id, title, created_at, subject_id, generation_params, subject:subjects(name)')
    .eq('created_by', user.id)
    .neq('generation_params->>source', 'cluster')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!batches || !batches.length) {
    return send(chat, 'У вас пока нет созданных наборов билетов.\nНажмите <b>«🚀 Конструктор билетов»</b> ниже, чтобы создать первый!', undefined, MAIN_KEYBOARD);
  }

  const text = `📂 <b>Ваши недавние наборы билетов:</b>\n\nНажмите на кнопку под сообщением, чтобы повторно скачать нужный комплект:`;
  const kb = batches.map((b: any) => [{
    text: `📥 ${T.shortName(b.title, 32)} (${b.generation_params?.ticket_count ?? '?'} вар.)`,
    callback_data: `RESEND:${b.id}`,
  }]);

  return send(chat, text, kb, MAIN_KEYBOARD);
}

async function screenQuick(chat: number, user: any, msgId?: number) {
  const userSubs = await subjects(user);
  if (!userSubs.length) return show(chat, msgId, 'Вам пока не назначены предметы.', undefined, MAIN_KEYBOARD);

  const { data: recent } = await sb.from('ticket_batches')
    .select('id, title, subject_id, generation_params, subject:subjects(name)')
    .eq('created_by', user.id)
    .neq('generation_params->>source', 'cluster')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const kb: any[] = [];

  if (recent) {
    const p = recent.generation_params || {};
    const count = p.ticket_count ?? 2;
    kb.push([{
      text: `🔁 Повторить: ${T.clip(recent.title, 26)} (${count} вар.)`,
      callback_data: `Q:REC:${recent.id}`,
    }]);
  }

  const physChem = userSubs.find((s: any) => /хим|физ/i.test(s.name));
  if (physChem) {
    kb.push([{
      text: `🧪 Физ / Хим (18+2+7 = 27 в.) · ${T.shortName(physChem.name, 20)}`,
      callback_data: `Q:PRE:phys:${physChem.id}`,
    }]);
  }

  const bioState = userSubs.find((s: any) => /биол|тоҷик|таджик/i.test(s.name));
  if (bioState) {
    kb.push([{
      text: `🧬 Био / Гос (20+4+2 = 26 в.) · ${T.shortName(bioState.name, 20)}`,
      callback_data: `Q:PRE:bio:${bioState.id}`,
    }]);
  }

  userSubs.forEach((s: any, idx: number) => {
    if (s.id !== physChem?.id && s.id !== bioState?.id && kb.length < 5) {
      kb.push([{
        text: `📚 ${T.shortName(s.name, 35)}`,
        callback_data: `S:${idx}`,
      }]);
    }
  });

  kb.push([{ text: '🚀 Открыть полный конструктор (Mini App)', web_app: { url: APP_URL } }]);

  const text = (
    `⚡ <b>Экспресс-генерация билетов</b>\n\n` +
    `Выберите готовый стандарт экзамена или повторите прошлый набор в 1 клик:`
  );

  return show(chat, msgId, text, kb, MAIN_KEYBOARD);
}

async function screenQuickVariants(chat: number, msgId: number, type: 'phys' | 'bio', subjectId: string, user: any) {
  const limits = await limitsFor(sb, user);
  const options = (limits.tickets <= 4 ? [1, 2, 4] : [1, 2, 4, 10, 20]).filter((n) => n <= limits.tickets);
  const title = type === 'phys' ? '🧪 Физика / Химия (18 тестов, 2 соотв., 7 откр.)' : '🧬 Биология / Гос (20 тестов, 4 соотв., 2 откр.)';

  const kb = [
    options.map((n) => ({
      text: `${n} вар.`,
      callback_data: `Q:RUN:${type}:${subjectId}:${n}`,
    })),
    [{ text: '« Назад к выбору', callback_data: 'ACT:QUICK' }],
  ];

  const text = `📋 <b>Стандарт:</b> ${title}\n\nСколько параллельных вариантов билетов сформировать?`;
  return show(chat, msgId, text, kb);
}

async function handleQuickRun(chat: number, msgId: number, type: 'phys' | 'bio', subjectId: string, count: number, user: any) {
  const chs = await chaptersOf(subjectId);
  if (!chs.length) return show(chat, msgId, 'У выбранного предмета нет доступных глав.');

  const { data: subj } = await sb.from('subjects').select('name').eq('id', subjectId).maybeSingle();
  const subjName = subj?.name || (type === 'phys' ? 'Химия' : 'Биология');

  const testCount = type === 'phys' ? 18 : 20;
  const matchingCount = type === 'phys' ? 2 : 4;
  const openCount = type === 'phys' ? 7 : 2;
  const title = `Экзамен — ${subjName}`;

  const st: State = {
    step: 'settings',
    subjectId,
    chapterIds: chs.map((c: any) => c.id),
    topicIds: [],
    topicSel: [],
    topicCh: 0,
    settings: {
      testCount,
      matchingCount,
      openCount,
      ticketCount: count,
      shuffleOptions: true,
      shuffleMatching: true,
      title,
    },
    awaiting: null,
  };

  await saveState(chat, st);

  return runWithLiveProgress(chat, msgId, async () => {
    await generate(chat, msgId, st, user, 'ru');
  });
}

async function handleQuickRepeat(chat: number, msgId: number, batchId: string, user: any) {
  const { data: batch } = await sb.from('ticket_batches')
    .select('id, title, subject_id, generation_params')
    .eq('id', batchId)
    .maybeSingle();

  if (!batch) return show(chat, msgId, 'Набор не найден.');
  const p = batch.generation_params || {};
  const r = p.requested ?? { test: p.test_count ?? 10, matching: p.matching_count ?? 2, open: p.open_count ?? 3 };

  const st: State = {
    step: 'settings',
    subjectId: batch.subject_id,
    chapterIds: p.chapter_ids ?? [],
    topicIds: p.topic_ids ?? [],
    topicSel: [],
    topicCh: 0,
    settings: {
      testCount: r.test,
      matchingCount: r.matching,
      openCount: r.open,
      ticketCount: p.ticket_count ?? 2,
      shuffleOptions: p.shuffle_options ?? true,
      shuffleMatching: p.shuffle_matching ?? true,
      title: batch.title || 'Экзаменационные билеты',
    },
    awaiting: null,
  };

  await saveState(chat, st);

  return runWithLiveProgress(chat, msgId, async () => {
    await generate(chat, msgId, st, user, (p.lang as any) ?? 'ru');
  });
}

async function handleResend(chat: number, msgId: number, batchId: string, user: any) {
  await show(chat, msgId, '⏳ <b>Отправляю файл из архива...</b>');
  try {
    const { resendBatch } = await import('../_shared/generate.ts');
    await resendBatch({ sb, botToken: BOT_TOKEN, chat, user, batchId });
    await send(chat, '✅ <b>Файл успешно отправлен в чат!</b>', [
      [{ text: '📂 Другие билеты', callback_data: 'ACT:HISTORY' }],
      [{ text: '🚀 Создать новый набор', web_app: { url: APP_URL } }],
    ], MAIN_KEYBOARD);
  } catch (err: any) {
    await send(chat, `❌ Ошибка отправки: ${err.message || err}`, undefined, MAIN_KEYBOARD);
  }
}

async function screenHelp(chat: number) {
  const text = (
    `❓ <b>Справка по генератору билетов</b>\n\n` +
    `Бот помогает преподавателям за секунды создавать билеты по стандартам вуза с правильными ключами ответов.\n\n` +
    `<b>Основные функции:</b>\n` +
    `1. <b>🚀 Конструктор билетов</b> — полноценное визуальное приложение с фильтрами тем и индикатором запаса вопросов (рекомендуется).\n` +
    `2. <b>⚡ Быстрый билет</b> — экспресс-составление вариантов по стандартам (Физ/Хим 18+2+7, Био/Гос 20+4+2) в 2 клика.\n` +
    `3. <b>📂 Мои билеты</b> — доступ к ранее созданным наборам с возможностью повторно скачать файл.\n\n` +
    `<b>Команды:</b>\n` +
    `• /app — открыть конструктор билетов\n` +
    `• /quick — экспресс-билет\n` +
    `• /history — история билетов\n` +
    `• /profile — лимиты и статус аккаунта\n` +
    `• /ticket — пошаговый мастер в чате\n` +
    `• /unlink — отвязать Telegram от аккаунта`
  );
  return send(chat, text, [
    [{ text: '🚀 Открыть конструктор билетов', web_app: { url: APP_URL } }],
  ], MAIN_KEYBOARD);
}

async function screenSubjects(chat: number, msgId?: number) {
  const user = await linkedUser(chat);
  const list = user ? await subjects(user) : [];
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
  const chId = st.chapterIds[st.topicCh ?? 0];
  const [chs, list] = await Promise.all([chaptersOf(st.subjectId!), chId ? topicsOf([chId]) : Promise.resolve([] as any[])]);
  const ch = chs.find((c) => c.id === chId);
  if (!ch) return screenChapters(chat, msgId, st);
  st.step = 'topics';
  await saveState(chat, st);
  const last = (st.topicCh ?? 0) >= st.chapterIds.length - 1;
  return show(chat, msgId, T.topicsText(ch.name, st.topicCh ?? 0, st.chapterIds.length, list, st.topicSel), T.kbTopics(list, st.topicSel, last));
}

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
  const me = await linkedUser(chat);
  const subj = (me ? await subjects(me) : []).find((s) => s.id === st.subjectId)?.name ?? '';
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
  const bad = T.checkSettings(s, await limitsFor(sb, user));
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
  const kb = [
    [{ text: '🚀 Открыть конструктор билетов', web_app: { url: APP_URL } }],
    [{ text: '⚡ Создать ещё один быстрый набор', callback_data: 'ACT:QUICK' }],
  ];
  await send(chat, '🎉 <b>Экзаменационный комплект отправлен в чат!</b>\n\nФайлы готовы к печати. Вы можете повторить или настроить новый набор:', kb, MAIN_KEYBOARD);
}

// ---------------- Обработка апдейтов ----------------
async function onMessage(m: any) {
  const chat: number = m.chat.id;
  const text: string = (m.text ?? '').trim();
  if (m.chat.type !== 'private') return;

  // привязка по коду
  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1]?.toUpperCase();
    if (!code) {
      const u = await linkedUser(chat);
      if (u) return screenStart(chat, u);
      return send(chat, '👋 <b>Добро пожаловать в генератор экзаменационных билетов!</b>\n\nЧтобы привязать свой аккаунт, откройте сайт, нажмите на значок <b>Telegram</b> в шапке, скопируйте код и отправьте сюда:\n<code>/start КОД</code>');
    }
    const { data: row } = await sb.from('telegram_link_codes').select('user_id, expires_at').eq('code', code).maybeSingle();
    if (!row || new Date(row.expires_at) < new Date()) {
      return send(chat, '⚠️ Код недействителен или устарел. Получите новый код на сайте.');
    }
    await sb.from('telegram_links').delete().eq('user_id', row.user_id);
    const { error } = await sb.from('telegram_links').upsert({ chat_id: chat, user_id: row.user_id });
    await sb.from('telegram_link_codes').delete().eq('code', code);
    if (error) return send(chat, '❌ Не удалось привязать аккаунт.');
    const u = await linkedUser(chat);
    return screenStart(chat, u);
  }

  const user = await linkedUser(chat);
  if (!user) {
    return send(chat, '👋 <b>Аккаунт не привязан.</b>\n\nНажмите на сайте значок <b>Telegram</b>, получите код привязки и отправьте мне:\n<code>/start КОД</code>');
  }

  // Кнопки главного меню и команды
  if (text === '⚡ Быстрый билет' || text === '/quick') {
    return screenQuick(chat, user);
  }
  if (text === '📂 Мои билеты' || text === '/history') {
    return screenMyTickets(chat, user);
  }
  if (text === 'ℹ️ Профиль и лимиты' || text === '/profile') {
    return screenProfile(chat, user);
  }
  if (text === '❓ Помощь' || text === '/help') {
    return screenHelp(chat);
  }
  if (text === '🚀 Конструктор билетов' || text === '/app') {
    return tg('sendMessage', {
      chat_id: chat,
      text: '🚀 Нажмите кнопку ниже, чтобы открыть конструктор билетов:',
      reply_markup: {
        inline_keyboard: [[{ text: '📝 Открыть конструктор билетов', web_app: { url: APP_URL } }]],
      },
    });
  }
  if (text === '/unlink') {
    await sb.from('telegram_links').delete().eq('chat_id', chat);
    await sb.from('telegram_sessions').delete().eq('chat_id', chat);
    return send(chat, '✅ Аккаунт отвязан. Чтобы войти снова, отправьте <code>/start КОД</code>');
  }
  if (text === '/ticket' || text === '/new') {
    const old = await loadState(chat);
    await saveState(chat, freshState(old.settings));
    return screenSubjects(chat);
  }

  // Ответ на вопрос «введите число/название»
  const st = await loadState(chat);
  if (st.awaiting) {
    const a = st.awaiting;
    if (a === 'title') {
      const t = text.slice(0, 100);
      if (!t) return send(chat, 'Название не может быть пустым.');
      st.settings.title = t;
    } else {
      const lim = await limitsFor(sb, user);
      const max = a === 'tickets' ? lim.tickets : lim.perType;
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
    st.topicSel = [...st.topicSel.filter((id) => !mine.includes(id)), ...(nums === 'all' ? [] : ids)];
    return screenTopics(chat, undefined, st);
  }

  return screenStart(chat, user);
}

async function onCallback(cb: any) {
  const chat: number = cb.message?.chat?.id || cb.from?.id;
  const msgId: number = cb.message?.message_id;
  const data: string = cb.data ?? '';
  await tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});

  const user = await linkedUser(chat);
  if (!user) return send(chat, 'Сначала привяжите аккаунт: <code>/start КОД</code>');
  const st = await loadState(chat);

  if (data.startsWith('L:') && st.busyAt && Date.now() - st.busyAt < 180000) return;
  if (data === 'NOOP') return;

  // Меню быстрых действий
  if (data === 'ACT:QUICK') {
    return screenQuick(chat, user, msgId);
  }
  if (data === 'ACT:HISTORY') {
    return screenMyTickets(chat, user);
  }
  if (data === 'ACT:UNLINK') {
    await sb.from('telegram_links').delete().eq('chat_id', chat);
    await sb.from('telegram_sessions').delete().eq('chat_id', chat);
    return show(chat, msgId, '✅ Аккаунт отвязан. Чтобы привязать снова, отправьте: <code>/start КОД</code>');
  }

  // Быстрый выбор вариантов для стандартов
  if (data.startsWith('Q:PRE:')) {
    const parts = data.split(':');
    const type = parts[2] as 'phys' | 'bio';
    const subjectId = parts[3];
    return screenQuickVariants(chat, msgId, type, subjectId, user);
  }

  // Быстрый запуск генерации стандарта
  if (data.startsWith('Q:RUN:')) {
    const parts = data.split(':');
    const type = parts[2] as 'phys' | 'bio';
    const subjectId = parts[3];
    const count = parseInt(parts[4]) || 2;
    return handleQuickRun(chat, msgId, type, subjectId, count, user);
  }

  // Быстрый повтор набора
  if (data.startsWith('Q:REC:')) {
    const batchId = data.slice(6);
    return handleQuickRepeat(chat, msgId, batchId, user);
  }

  // Повторная отправка файла из архива
  if (data.startsWith('RESEND:')) {
    const batchId = data.slice(7);
    return handleResend(chat, msgId, batchId, user);
  }

  // Выбор предмета
  if (data.startsWith('S:')) {
    const list = await subjects(user);
    const s = list[+data.slice(2)];
    if (!s) return;
    st.subjectId = s.id; st.chapterIds = []; st.topicIds = [];
    return screenChapters(chat, msgId, st);
  }

  // Выбор глав
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

  // Выбор тем
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

  // Настройка параметров билета
  if (data.startsWith('V:')) {
    st.awaiting = data.slice(2) as State['awaiting'];
    await saveState(chat, st);
    return send(chat, prompts(await limitsFor(sb, user))[st.awaiting!]);
  }

  // Перемешивание
  if (data === 'O:opt' || data === 'O:mat') {
    if (data === 'O:opt') st.settings.shuffleOptions = !st.settings.shuffleOptions;
    else st.settings.shuffleMatching = !st.settings.shuffleMatching;
    return screenSettings(chat, msgId, st);
  }

  // Переход к выбору языка
  if (data === 'SN') {
    const bad = T.checkSettings(st.settings, await limitsFor(sb, user));
    if (bad) return send(chat, `⚠️ ${bad}`);
    const fit = T.fitSettings(await countPool(st), st.settings);
    if (fit.error) return send(chat, `⚠️ ${fit.error}`);
    if (fit.notes.length) await send(chat, `ℹ️ Вопросов не хватает — возьмём сколько есть:\n• ${fit.notes.join('\n• ')}`);
    st.step = 'lang';
    await saveState(chat, st);
    return show(chat, msgId, 'На каком языке подготовить файлы?', T.kbLang());
  }

  // Генерация билетов с живым прогрессом
  if (data.startsWith('L:')) {
    const lang = data.slice(2) as 'ru' | 'tg' | 'both';
    st.busyAt = Date.now();
    await saveState(chat, st);

    return runWithLiveProgress(chat, msgId, async () => {
      try {
        await generate(chat, msgId, st, user, lang);
      } catch (e) {
        console.error('generate failed', e);
        await send(chat, `❌ Ошибка генерации: ${(e as Error).message || e}`, undefined, MAIN_KEYBOARD);
      } finally {
        st.busyAt = undefined;
        st.step = 'settings';
        await saveState(chat, st);
      }
    });
  }
}

async function handle(update: any) {
  try {
    if (update.message) await onMessage(update.message);
    else if (update.callback_query) await onCallback(update.callback_query);
  } catch (e) {
    console.error('update failed', e);
    const chat = update.message?.chat?.id || update.callback_query?.message?.chat?.id || update.callback_query?.from?.id;
    if (chat) {
      await send(chat, `⚠️ Произошла ошибка: ${(e as Error).message || e}`);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await req.json().catch(() => null);
  if (!update) return new Response('bad request', { status: 400 });
  await handle(update);
  return new Response('ok');
});
