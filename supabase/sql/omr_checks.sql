-- Результаты проверки бланков по фото (мини-приложение, раздел «Проверка»). Повторный запуск безопасен.
-- Пишет только Edge Function tg-app (сервисным ключом); пользователь видит только свои записи.
-- Баллы считает функция по ключу из базы: тест 1, пункт соответствия 1, открытый 2.
create table if not exists public.omr_checks (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  batch_id     uuid references public.ticket_batches(id) on delete set null,
  ticket_number int,
  student      text not null default '',
  layout       text not null,
  score        int not null,
  max_score    int not null,
  details      jsonb not null default '{}'::jsonb
);
create index if not exists idx_omr_checks_user_created on public.omr_checks (user_id, created_at desc);
create index if not exists idx_omr_checks_batch on public.omr_checks (batch_id);

alter table public.omr_checks enable row level security;
revoke all on public.omr_checks from anon, authenticated;
grant select, delete on public.omr_checks to authenticated;

drop policy if exists "Проверки: свои — просмотр" on public.omr_checks;
create policy "Проверки: свои — просмотр" on public.omr_checks
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Проверки: свои — удаление" on public.omr_checks;
create policy "Проверки: свои — удаление" on public.omr_checks
  for delete to authenticated using (user_id = (select auth.uid()));
