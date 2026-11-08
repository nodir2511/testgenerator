-- Журнал ошибок интерфейса (мониторинг). Повторный запуск безопасен.
-- Сайт сам присылает сюда необработанные ошибки (src/lib/errorReporter.ts); читать журнал может только главный админ.
create table if not exists public.client_errors (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid,
  message    text not null,
  stack      text,
  url        text,
  app_version text
);
create index if not exists idx_client_errors_created on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
grant select on public.client_errors to authenticated;
grant delete on public.client_errors to authenticated;

drop policy if exists "Журнал ошибок: просмотр главным админом" on public.client_errors;
create policy "Журнал ошибок: просмотр главным админом" on public.client_errors
  for select to authenticated using ((select public.is_owner()));
drop policy if exists "Журнал ошибок: очистка главным админом" on public.client_errors;
create policy "Журнал ошибок: очистка главным админом" on public.client_errors
  for delete to authenticated using ((select public.is_owner()));

-- Запись только через функцию: обрезает длину и не даёт засыпать журнал (не больше 60 записей в минуту)
create or replace function public.report_client_error(p_message text, p_stack text default null, p_url text default null, p_version text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(p_message), '') = '' then return; end if;
  if (select count(*) from public.client_errors where created_at > now() - interval '1 minute') >= 60 then return; end if;
  insert into public.client_errors (user_id, message, stack, url, app_version)
  values (auth.uid(), left(p_message, 1000), left(p_stack, 4000), left(p_url, 500), left(p_version, 32));
  -- Хранить не дольше 30 дней
  delete from public.client_errors where created_at < now() - interval '30 days';
end;
$$;
revoke all on function public.report_client_error(text, text, text, text) from public;
grant execute on function public.report_client_error(text, text, text, text) to anon, authenticated;
