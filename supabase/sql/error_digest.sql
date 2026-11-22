-- Сводка ошибок сайта главному админу в Telegram: раз в день, раз в неделю, раз в месяц и раз в год.
--  1) error_digest_runs — какие сводки уже отправлены. Строка с ключом периода (day:2026-11-21, week:2026-11-16,
--     month:2026-10, year:2025) «занимает» период: повторный или чужой вызов функции ничего не разошлёт дважды.
--     Читает и пишет таблицу только Edge Function error-digest (сервисный ключ).
--  2) Задание pg_cron раз в сутки в 03:00 UTC (08:00 по Душанбе) вызывает Edge Function error-digest.
-- Требует client_errors.sql, telegram_bot.sql (telegram_links) и задеплоенной функции error-digest.
-- Скрипт безопасно запускать повторно.

begin;

create table if not exists public.error_digest_runs (
  key     text primary key,
  period  text not null check (period in ('day', 'week', 'month', 'year')),
  sent_at timestamptz not null default now(),
  total   int not null default 0
);

-- RLS включён, политик нет: с сайта таблица недоступна никому
alter table public.error_digest_runs enable row level security;
revoke all on public.error_digest_runs from public, anon, authenticated;

commit;

-- Расписание (вне транзакции: расширения создаются отдельно)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Если у функции задан секрет ERROR_DIGEST_SECRET, добавьте в headers "x-cron-secret": "<значение>"
select cron.unschedule('error-digest') where exists (select 1 from cron.job where jobname = 'error-digest');
select cron.schedule(
  'error-digest',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://ovxrgkyexuudgtqglegk.supabase.co/functions/v1/error-digest',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
