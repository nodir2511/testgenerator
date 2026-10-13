-- ==============================================================================
-- TELEGRAM-БОТ: привязка аккаунтов преподавателей и сессии диалога
-- Выполните целиком в Supabase -> SQL Editor.
-- ==============================================================================
create table if not exists public.telegram_link_codes (
  code text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists public.telegram_links (
  chat_id bigint primary key,
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_sessions (
  chat_id bigint primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS включён, политик для коды/сессий нет: доступ только у Edge Function (service role)
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_sessions enable row level security;
alter table public.telegram_links enable row level security;

-- Пользователь видит и может отвязать только свой Telegram
drop policy if exists "Свой Telegram: просмотр" on public.telegram_links;
create policy "Свой Telegram: просмотр" on public.telegram_links for select to authenticated using (user_id = auth.uid());
drop policy if exists "Свой Telegram: отвязка" on public.telegram_links;
create policy "Свой Telegram: отвязка" on public.telegram_links for delete to authenticated using (user_id = auth.uid());

-- Одноразовый код привязки (действует 10 минут)
create or replace function public.create_telegram_link_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c text;
begin
  if auth.uid() is null then
    raise exception 'Требуется вход в систему';
  end if;
  delete from public.telegram_link_codes where user_id = auth.uid() or expires_at < now();
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.telegram_link_codes (code, user_id, expires_at)
  values (c, auth.uid(), now() + interval '10 minutes');
  return c;
end;
$$;

revoke all on function public.create_telegram_link_code() from public, anon;
grant execute on function public.create_telegram_link_code() to authenticated;
