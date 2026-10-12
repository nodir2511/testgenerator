// Edge Function: send-to-telegram
//
// Кнопка «В Telegram» на сайте: браузер собирает тот же файл Word/ZIP, что и при
// скачивании, и передаёт его сюда. Функция проверяет вход пользователя и отправляет
// файл через бота в Telegram, привязанный к ЭТОМУ аккаунту (telegram_links).
// Отправить файл в чужой чат нельзя: chat_id берётся только из привязки.
//
// Также отдаёт имя бота ({"action":"bot"}) для ссылки привязки на сайте.
// Деплой:  supabase functions deploy send-to-telegram
// Секреты: TELEGRAM_BOT_TOKEN (тот же, что у telegram-bot).

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

const MAX_BYTES = 45 * 1024 * 1024; // Telegram принимает от бота до 50 МБ
const ALLOWED = /\.(docx|zip)$/i;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405);

  try {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!token) return json({ error: 'Требуется авторизация' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: auth, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !auth?.user) return json({ error: 'Недействительная сессия' }, 401);
    const userId = auth.user.id;

    // Имя бота для ссылки привязки t.me/<bot>?start=КОД
    if ((req.headers.get('content-type') || '').includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      if (body?.action === 'bot') {
        const me = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`).then((r) => r.json()).catch(() => ({}));
        return me?.ok ? json({ username: me.result.username }) : json({ error: 'Не удалось получить имя бота' }, 502);
      }
      return json({ error: 'Неизвестное действие' }, 400);
    }

    const { data: link } = await admin.from('telegram_links').select('chat_id').eq('user_id', userId).maybeSingle();
    if (!link) {
      return json({ error: 'Telegram не привязан к аккаунту. Нажмите значок ✈ (Telegram-бот) вверху страницы и привяжите его.' }, 400);
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return json({ error: 'Файл не передан' }, 400);
    const fileName = String(form?.get('fileName') || file.name || 'file.docx').slice(0, 200);
    if (!ALLOWED.test(fileName)) return json({ error: 'Можно отправлять только файлы .docx и .zip' }, 400);
    if (file.size === 0 || file.size > MAX_BYTES) return json({ error: 'Файл слишком большой для Telegram (больше 45 МБ)' }, 400);
    const caption = String(form?.get('caption') || '').slice(0, 1000);

    const tgForm = new FormData();
    tgForm.append('chat_id', String(link.chat_id));
    if (caption) tgForm.append('caption', caption);
    tgForm.append('document', file, fileName);
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: tgForm });
    const tg = await res.json().catch(() => ({}));
    if (!tg.ok) {
      const blocked = /blocked|chat not found|deactivated/i.test(tg.description || '');
      return json({
        error: blocked
          ? 'Бот не может написать вам: откройте бота в Telegram и нажмите «Start», затем повторите.'
          : `Telegram не принял файл: ${tg.description || res.status}`,
      }, 502);
    }

    const batchId = String(form?.get('batchId') || '');
    await admin.from('audit_logs').insert({
      user_id: userId, action: 'TELEGRAM_SEND', entity_type: 'ticket_batches',
      entity_id: /^[0-9a-f-]{36}$/i.test(batchId) ? batchId : null,
      details: { file: fileName, size: file.size },
    });

    return json({ ok: true });
  } catch (err) {
    console.error('send-to-telegram', err);
    return json({ error: (err as Error).message || 'Внутренняя ошибка' }, 500);
  }
});
