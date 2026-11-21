// Edge Function: release-notify
//
// Рассылает в Telegram пункты новых версий («Что нового»): каждому привязанному пользователю —
// только то, что доступно его роли и предметам, по всем изменениям (сайт, чат-бот, мини-приложение).
// Запускается раз в минуту заданием pg_cron (см. supabase/sql/telegram_release_notify.sql), но только
// когда есть неразосланные версии (site_releases.notified_at is null). Версия «занимается» одним запросом,
// поэтому параллельный запуск не пришлёт сообщение дважды. Тела запроса функция не читает.
// Деплой:  supabase functions deploy release-notify --no-verify-jwt
// Секреты: TELEGRAM_BOT_TOKEN (SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY задаёт сам Supabase).
// Сообщение короткое: счётчики по версии («Новое на сайте (1)», «Мелкие исправления (2)»), кнопка «Подробнее»
// (раздел «Что нового» на сайте, адрес — секрет SITE_URL) и кнопка «/release 1.0.0» — полное описание версии в чате.
// Необязательно: RELEASE_NOTIFY_SECRET — если задан, вызов принимается только с заголовком x-cron-secret
// с тем же значением (его же нужно добавить в задание pg_cron).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { itemVisible, rankOf, releaseSummaryLines, RELEASE_CB, type ReleaseItem, type ReleaseRow } from '../_shared/releases.ts';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const API = `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')!}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SITE_URL = (Deno.env.get('SITE_URL') || 'https://testgenerator-3s51.vercel.app').replace(/\/+$/, '');

async function sendMessage(chat: number, text: string, keyboard?: unknown[][]): Promise<boolean> {
  const res = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    }),
  });
  if (!res.ok) console.error('sendMessage failed', chat, res.status);
  return res.ok;
}

const CRON_SECRET = Deno.env.get('RELEASE_NOTIFY_SECRET');

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response('forbidden', { status: 403 });

  // Берём только версии, у которых уже есть пункты: форма «Что нового» пишет версию и пункты двумя
  // запросами, и версия, занятая в этот промежуток, осталась бы неразосланной навсегда.
  const { data: fresh, error: freshErr } = await sb.from('site_releases')
    .select('id, site_release_items!inner(id)').is('notified_at', null);
  if (freshErr) {
    console.error('lookup failed', freshErr);
    return new Response(JSON.stringify({ error: 'lookup failed' }), { status: 500 });
  }
  const ids = (fresh ?? []).map((r: any) => r.id);
  if (!ids.length) return Response.json({ releases: 0, sent: 0 });

  // «Занимаем» неразосланные версии: второй параллельный вызов получит пустой список
  const { data: claimed, error } = await sb.from('site_releases')
    .update({ notified_at: new Date().toISOString() })
    .is('notified_at', null)
    .in('id', ids)
    .select('id, version, title, released_at');
  if (error) {
    console.error('claim failed', error);
    return new Response(JSON.stringify({ error: 'claim failed' }), { status: 500 });
  }
  if (!claimed?.length) return Response.json({ releases: 0, sent: 0 });

  const releases = [...claimed].sort((a, b) => String(a.released_at).localeCompare(String(b.released_at)));
  const { data: itemRows } = await sb.from('site_release_items')
    .select('release_id, kind, scope, text, min_rank, subject_id, order_index')
    .in('release_id', releases.map((r) => r.id))
    .neq('scope', 'game') // пункты раздела «Игры» видны только на странице игр
    .order('order_index');
  const items = itemRows ?? [];

  const { data: links } = await sb.from('telegram_links').select('chat_id, user_id');
  const userIds = (links ?? []).map((l: any) => l.user_id);
  const [{ data: profiles }, { data: userSubjects }] = await Promise.all([
    sb.from('profiles').select('id, role, is_owner').in('id', userIds),
    sb.from('user_subjects').select('user_id, subject_id').in('user_id', userIds),
  ]);
  const profileOf = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  let sent = 0, failed = 0, skipped = 0;
  for (const link of links ?? []) {
    const p = profileOf.get(link.user_id) as { role?: string; is_owner?: boolean } | undefined;
    if (!p) { skipped++; continue; }
    const rank = rankOf(p.role, p.is_owner);
    // Предметы назначены только ролям «по предметам»; остальным доступны все
    const allowed = p.role === 'subject_teacher' || p.role === 'subject_admin'
      ? (userSubjects ?? []).filter((u: any) => u.user_id === link.user_id).map((u: any) => u.subject_id as string)
      : null;

    const rows: ReleaseRow[] = releases.map((r) => ({
      version: r.version,
      title: r.title,
      items: items
        .filter((i: any) => i.release_id === r.id && itemVisible(i, rank, allowed))
        .map((i: any): ReleaseItem => ({ kind: i.kind, scope: i.scope ?? 'site', text: i.text, min_rank: i.min_rank, subject_id: i.subject_id })),
    }));
    const lines = releaseSummaryLines(rows);
    if (!lines.length) { skipped++; continue; }

    // Внизу: «Подробнее» (на сайт) и по кнопке на каждую версию — описание в чате
    const keyboard: unknown[][] = [[{ text: '📖 Подробнее', url: `${SITE_URL}/#news` }]];
    for (const r of rows.filter((x) => x.items.length)) {
      keyboard.push([{ text: `/release ${r.version}`, callback_data: `${RELEASE_CB}${r.version}`.slice(0, 64) }]);
    }
    const ok = await sendMessage(link.chat_id, ['🆕 <b>Что нового</b>', '', ...lines].join('\n'), keyboard);
    await sleep(50);
    if (ok) sent++; else failed++;
  }
  return Response.json({ releases: releases.length, sent, failed, skipped });
});
