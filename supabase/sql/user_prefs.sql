-- Личные настройки пользователя, которые должны быть одинаковыми на всех устройствах
-- (сейчас: параметры экзамена-кластера, ключ 'cluster_v1'). Каждый видит и меняет только свои.
-- Применено: supabase db query --linked -f supabase/sql/user_prefs.sql

create table if not exists public.user_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  key text not null check (char_length(key) <= 64),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key),
  constraint user_prefs_size check (pg_column_size(value) <= 65536)
);
alter table public.user_prefs enable row level security;

drop policy if exists "Свои настройки: просмотр" on public.user_prefs;
create policy "Свои настройки: просмотр" on public.user_prefs for select to authenticated using (user_id = auth.uid());
drop policy if exists "Свои настройки: добавление" on public.user_prefs;
create policy "Свои настройки: добавление" on public.user_prefs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Свои настройки: изменение" on public.user_prefs;
create policy "Свои настройки: изменение" on public.user_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Свои настройки: удаление" on public.user_prefs;
create policy "Свои настройки: удаление" on public.user_prefs for delete to authenticated using (user_id = auth.uid());
