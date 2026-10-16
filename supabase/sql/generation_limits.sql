-- Ограничения генерации для обычных пользователей (сайт и Telegram одинаково).
-- Администраторы не ограничены. Числа лимитов лежат в таблице generation_settings (одна строка) —
-- правятся на вкладке «Статистика» (главный админ). Применено: supabase db query --linked -f supabase/sql/generation_limits.sql
--
-- Генерации считаются по журналу generation_usage, а не по ticket_batches: удаление набора
-- в «Сохранённых» не возвращает лимит. Запись в журнал делает тот же триггер, поэтому
-- если сохранение набора откатилось, генерация не засчитывается. В журнале остаётся копия
-- параметров набора (предмет, главы, темы, число билетов) — по ней считается статистика.
-- Проверка и запись идут под блокировкой пользователя: два одновременных запроса не проходят оба.

-- Лимиты (единственная строка)
create table if not exists public.generation_settings (
  id boolean primary key default true check (id),
  per_day int not null default 5 check (per_day between 1 and 1000),
  cooldown_seconds int not null default 60 check (cooldown_seconds between 0 and 86400),
  max_tickets int not null default 4 check (max_tickets between 1 and 50),
  max_per_ticket int not null default 50 check (max_per_ticket between 1 and 200),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.generation_settings (id) values (true) on conflict (id) do nothing;
alter table public.generation_settings enable row level security;
drop policy if exists "Просмотр лимитов" on public.generation_settings;
create policy "Просмотр лимитов" on public.generation_settings for select to authenticated using (true);
drop policy if exists "Изменение лимитов" on public.generation_settings;
create policy "Изменение лимитов" on public.generation_settings for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

create or replace function public.generation_settings_stamp()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists trg_generation_settings_stamp on public.generation_settings;
create trigger trg_generation_settings_stamp before update on public.generation_settings
  for each row execute function public.generation_settings_stamp();

create table if not exists public.generation_usage (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  batch_id uuid references public.ticket_batches(id) on delete set null,
  source text,
  created_at timestamptz not null default now()
);
alter table public.generation_usage add column if not exists subject_id uuid;
alter table public.generation_usage add column if not exists params jsonb;
create index if not exists idx_generation_usage_user_time on public.generation_usage (user_id, created_at desc);
alter table public.generation_usage enable row level security;
drop policy if exists "Просмотр своих генераций" on public.generation_usage;
create policy "Просмотр своих генераций" on public.generation_usage
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Перенос уже созданных наборов (один раз; повторный запуск ничего не дублирует)
insert into public.generation_usage (user_id, batch_id, source, created_at, subject_id, params)
select b.created_by, b.id, b.generation_params->>'source', b.created_at, b.subject_id, b.generation_params
from public.ticket_batches b
where b.created_by is not null
  and exists (select 1 from public.profiles p where p.id = b.created_by)
  and not exists (select 1 from public.generation_usage u where u.batch_id = b.id);
-- Записи, перенесённые раньше без параметров, дополняем
update public.generation_usage u set subject_id = b.subject_id, params = b.generation_params
from public.ticket_batches b where u.batch_id = b.id and u.params is null;

create or replace function public.enforce_generation_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p jsonb := coalesce(new.generation_params, '{}'::jsonb);
  tickets int := coalesce((p->>'ticket_count')::int, 1);
  per_ticket int := coalesce((p->>'test_count')::int, 0) + coalesce((p->>'matching_count')::int, 0) + coalesce((p->>'open_count')::int, 0);
  day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Dushanbe') at time zone 'Asia/Dushanbe';
  cfg public.generation_settings;
begin
  if new.created_by is null then
    return new;
  end if;
  -- Генерации одного пользователя проверяются по очереди (до конца транзакции)
  perform pg_advisory_xact_lock(hashtextextended('generation:' || new.created_by::text, 0));

  if not exists (select 1 from public.profiles where id = new.created_by and role = 'admin') then
    select * into cfg from public.generation_settings where id;
    if not found then
      cfg.per_day := 5; cfg.cooldown_seconds := 60; cfg.max_tickets := 4; cfg.max_per_ticket := 50;
    end if;
    if tickets > cfg.max_tickets then
      raise exception 'Не больше % билетов за один раз', cfg.max_tickets;
    end if;
    if per_ticket > cfg.max_per_ticket then
      raise exception 'Не больше % вопросов в одном билете', cfg.max_per_ticket;
    end if;
    if cfg.cooldown_seconds > 0 and exists (
      select 1 from public.generation_usage where user_id = new.created_by and created_at > now() - make_interval(secs => cfg.cooldown_seconds)
    ) then
      raise exception 'Генерировать можно не чаще одного раза в % сек. Подождите немного.', cfg.cooldown_seconds;
    end if;
    if (select count(*) from public.generation_usage where user_id = new.created_by and created_at >= day_start) >= cfg.per_day then
      raise exception 'Дневной лимит исчерпан: % генераций в сутки. Попробуйте завтра.', cfg.per_day;
    end if;
  end if;

  insert into public.generation_usage (user_id, batch_id, source, subject_id, params)
  values (new.created_by, new.id, p->>'source', new.subject_id, p);
  return new;
end;
$$;

-- AFTER: строка набора уже есть, и ссылка batch_id в журнале корректна
drop trigger if exists trg_enforce_generation_limits on public.ticket_batches;
create trigger trg_enforce_generation_limits
  after insert on public.ticket_batches
  for each row execute function public.enforce_generation_limits();
