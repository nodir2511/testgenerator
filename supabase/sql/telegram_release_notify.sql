-- «Что нового» в Telegram.
--  1) У пункта обновления появляется поле scope — где изменение: site (сайт), bot (чат-бот), app (мини-приложение).
--     Кнопка «Что нового» в боте показывает только пункты сайта, а рассылка о новой версии — все.
--  2) site_releases.notified_at — когда версия разослана в Telegram. У уже вышедших версий проставляется сейчас,
--     чтобы старая история не разослалась всем заново.
--  3) Задание pg_cron раз в минуту вызывает Edge Function release-notify, но только если есть неразосланные версии.
-- Требует site_releases.sql и задеплоенной функции release-notify. Скрипт безопасно запускать повторно.

begin;

alter table public.site_release_items add column if not exists scope text not null default 'site'
  check (scope in ('site', 'bot', 'app'));

-- Разметка уже имеющихся пунктов по тексту (однократно, только там, где метка ещё «сайт»)
update public.site_release_items set scope = 'app'
  where scope = 'site' and text ~* 'мини-приложен|mini app';
update public.site_release_items set scope = 'bot'
  where scope = 'site' and (
    text ~* '^(в |во )?(чат-|telegram-|телеграм-)?бот'
    or text ~* '(в|в самом) (чат-|telegram-|телеграм-)боте'
  );

alter table public.site_releases add column if not exists notified_at timestamptz;
update public.site_releases set notified_at = now() where notified_at is null;

-- add_site_release: пункт может содержать "scope":"site|bot|app" (по умолчанию site)
create or replace function public.add_site_release(p_version text, p_title text, p_items jsonb, p_released_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  it jsonb;
  n int := 0;
  sid uuid;
begin
  if auth.uid() is not null and not public.is_owner() then
    raise exception 'Записи об обновлениях добавляет только главный администратор';
  end if;

  insert into public.site_releases (version, title, released_at)
  values (p_version, coalesce(p_title, ''), p_released_at)
  on conflict (version) do nothing
  returning id into rid;

  if rid is null then
    return (select id from public.site_releases where version = p_version);
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    sid := null;
    if it->>'subject' is not null then
      select id into sid from public.subjects where name = it->>'subject' and not is_deleted limit 1;
      if sid is null then raise exception 'Предмет не найден: %', it->>'subject'; end if;
    end if;
    insert into public.site_release_items (release_id, kind, scope, text, min_rank, subject_id, order_index)
    values (rid, coalesce(it->>'kind', 'new'), coalesce(it->>'scope', 'site'), it->>'text', coalesce((it->>'min_rank')::smallint, 1), sid, n);
    n := n + 1;
  end loop;
  return rid;
end;
$$;

revoke all on function public.add_site_release(text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.add_site_release(text, text, jsonb, timestamptz) to authenticated;

commit;

-- Расписание рассылки (вне транзакции: расширения создаются отдельно)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('release-notify') where exists (select 1 from cron.job where jobname = 'release-notify');
select cron.schedule(
  'release-notify',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ovxrgkyexuudgtqglegk.supabase.co/functions/v1/release-notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  where exists (select 1 from public.site_releases where notified_at is null);
  $$
);
