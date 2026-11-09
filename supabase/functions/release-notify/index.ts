// Edge Function: release-notify
//
// Рассылает в Telegram пункты новых версий («Что нового»): каждому привязанному пользователю —
// только то, что доступно его роли и предметам, по всем изменениям (сайт, чат-бот, мини-приложение).
// Запускается раз в минуту заданием pg_cron (см. supabase/sql/telegram_release_notify.sql), но только
// когда есть неразосланные версии (site_releases.notified_at is null). Версия «занимается» одним запросом,
// поэтому параллельный запуск не пришлёт сообщение дважды. Тела запроса функция не читает.
// Деплой:  supabase functions deploy release-notify --no-verify-jwt
// Секреты: TELEGRAM_BOT_TOKEN (SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY задаёт сам Supabase).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { chunkLines, itemVisible, rankOf, releaseLines, type ReleaseItem, type ReleaseRow } from '../_shared/releases.ts';

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

Deno.serve(async () => {
  // «Занимаем» неразосланные версии: второй параллельный вызов получит пустой список
  const { data: claimed, error } = await sb.from('site_releases')
    .update({ notified_at: new Date().toISOString() })
    .is('notified_at', null)
    .select('id, version, title, released_at');
  if (error) {
    console.error('claim failed', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  if (!claimed?.length) return Response.json({ releases: 0, sent: 0 });

  const releases = [...claimed].sort((a, b) => String(a.released_at).localeCompare(String(b.released_at)));
  const { data: itemRows } = await sb.from('site_release_items')
    .select('release_id, kind, scope, text, min_rank, subject_id, order_index')
    .in('release_id', releases.map((r) => r.id))
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
    const lines = releaseLines(rows);
    if (!lines.length) { skipped++; continue; }

    let ok = true;
    for (const chunk of chunkLines(['🆕 <b>Что нового</b>', '', ...lines])) {
      ok = (await sendMessage(link.chat_id, chunk)) && ok;
      await sleep(50);
    }
    if (ok) sent++; else failed++;
  }
  return Response.json({ releases: releases.length, sent, failed, skipped });
});
