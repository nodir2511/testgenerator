-- Ограничения генерации для обычных пользователей (сайт и Telegram одинаково).
-- Администраторы не ограничены. Применено: supabase db query --linked -f supabase/sql/generation_limits.sql
--  * до 4 вариантов за раз
--  * до 50 вопросов в одном билете
--  * до 5 наборов в сутки (по времени Таджикистана)
--  * не чаще одного набора в минуту

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
  if new.created_by is null or exists (select 1 from public.profiles where id = new.created_by and role = 'admin') then
    return new;
  end if;
  if tickets > 4 then
    raise exception 'Не больше 4 билетов за один раз';
  end if;
  if per_ticket > 50 then
    raise exception 'Не больше 50 вопросов в одном билете';
  end if;
  if exists (select 1 from public.ticket_batches where created_by = new.created_by and created_at > now() - interval '1 minute') then
    raise exception 'Генерировать можно не чаще одного раза в минуту. Подождите немного.';
  end if;
  if (select count(*) from public.ticket_batches where created_by = new.created_by and created_at >= day_start) >= 5 then
    raise exception 'Дневной лимит исчерпан: 5 генераций в сутки. Попробуйте завтра.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_generation_limits on public.ticket_batches;
create trigger trg_enforce_generation_limits
  before insert on public.ticket_batches
  for each row execute function public.enforce_generation_limits();
