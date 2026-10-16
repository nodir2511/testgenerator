-- Ограничения генерации для обычных пользователей (сайт и Telegram одинаково).
-- Администраторы не ограничены. Применено: supabase db query --linked -f supabase/sql/generation_limits.sql
--  * до 4 вариантов за раз
--  * до 50 вопросов в одном билете
--  * до 5 наборов в сутки (по времени Таджикистана)
--  * не чаще одного набора в минуту
--
-- Генерации считаются по журналу generation_usage, а не по ticket_batches: удаление набора
-- в «Сохранённых» не возвращает лимит. Запись в журнал делает тот же триггер, поэтому
-- если сохранение набора откатилось, генерация не засчитывается.
-- Проверка и запись идут под блокировкой пользователя: два одновременных запроса не проходят оба.

create table if not exists public.generation_usage (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  batch_id uuid references public.ticket_batches(id) on delete set null,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists idx_generation_usage_user_time on public.generation_usage (user_id, created_at desc);
alter table public.generation_usage enable row level security;
drop policy if exists "Просмотр своих генераций" on public.generation_usage;
create policy "Просмотр своих генераций" on public.generation_usage
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Перенос уже созданных наборов (один раз; повторный запуск ничего не дублирует)
insert into public.generation_usage (user_id, batch_id, source, created_at)
select b.created_by, b.id, b.generation_params->>'source', b.created_at
from public.ticket_batches b
where b.created_by is not null
  and exists (select 1 from public.profiles p where p.id = b.created_by)
  and not exists (select 1 from public.generation_usage u where u.batch_id = b.id);

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
begin
  if new.created_by is null then
    return new;
  end if;
  -- Генерации одного пользователя проверяются по очереди (до конца транзакции)
  perform pg_advisory_xact_lock(hashtextextended('generation:' || new.created_by::text, 0));

  if not exists (select 1 from public.profiles where id = new.created_by and role = 'admin') then
    if tickets > 4 then
      raise exception 'Не больше 4 билетов за один раз';
    end if;
    if per_ticket > 50 then
      raise exception 'Не больше 50 вопросов в одном билете';
    end if;
    if exists (select 1 from public.generation_usage where user_id = new.created_by and created_at > now() - interval '1 minute') then
      raise exception 'Генерировать можно не чаще одного раза в минуту. Подождите немного.';
    end if;
    if (select count(*) from public.generation_usage where user_id = new.created_by and created_at >= day_start) >= 5 then
      raise exception 'Дневной лимит исчерпан: 5 генераций в сутки. Попробуйте завтра.';
    end if;
  end if;

  insert into public.generation_usage (user_id, batch_id, source) values (new.created_by, new.id, p->>'source');
  return new;
end;
$$;

-- AFTER: строка набора уже есть, и ссылка batch_id в журнале корректна
drop trigger if exists trg_enforce_generation_limits on public.ticket_batches;
create trigger trg_enforce_generation_limits
  after insert on public.ticket_batches
  for each row execute function public.enforce_generation_limits();
