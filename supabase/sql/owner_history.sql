-- Главный админ (владелец) и история создания билетов.
-- Историю всех партий (кто и когда создал) видит только владелец; остальные, включая обычных админов,
-- видят только свои партии. Признак is_owner нельзя выставить из приложения — только SQL/service role.

alter table public.profiles add column if not exists is_owner boolean not null default false;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_owner from public.profiles where id = auth.uid()), false);
$$;

-- is_owner меняется только вне приложения (auth.uid() is null: SQL Editor / service role)
create or replace function public.prevent_owner_escalation()
returns trigger
language plpgsql
as $$
begin
  if new.is_owner is distinct from old.is_owner and auth.uid() is not null then
    raise exception 'Признак главного администратора нельзя менять из приложения';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_profiles_owner_escalation on public.profiles;
create trigger prevent_profiles_owner_escalation
  before update on public.profiles
  for each row execute function public.prevent_owner_escalation();

create or replace function public.prevent_owner_on_insert()
returns trigger
language plpgsql
as $$
begin
  if new.is_owner and auth.uid() is not null then
    new.is_owner := false;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_profiles_owner_insert on public.profiles;
create trigger prevent_profiles_owner_insert
  before insert on public.profiles
  for each row execute function public.prevent_owner_on_insert();

-- Видимость партий: владелец — все, остальные — только свои
drop policy if exists "Просмотр партий билетов" on public.ticket_batches;
create policy "Просмотр партий билетов" on public.ticket_batches
  for select to authenticated using (public.is_owner() or created_by = auth.uid());

drop policy if exists "Просмотр билетов" on public.tickets;
create policy "Просмотр билетов" on public.tickets
  for select to authenticated
  using (exists (select 1 from public.ticket_batches b where b.id = batch_id and (public.is_owner() or b.created_by = auth.uid())));

drop policy if exists "Просмотр вопросов в билетах" on public.ticket_questions;
create policy "Просмотр вопросов в билетах" on public.ticket_questions
  for select to authenticated
  using (exists (
    select 1 from public.tickets t join public.ticket_batches b on b.id = t.batch_id
    where t.id = ticket_id and (public.is_owner() or b.created_by = auth.uid())
  ));

-- Главные администраторы
update public.profiles set is_owner = true where email in ('nodir.burhonow@gmail.com', 'admin@repetitor.tj');

select email, role, is_owner from public.profiles where is_owner order by email;
