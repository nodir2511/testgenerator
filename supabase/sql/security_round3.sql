-- ==============================================================================
-- УСИЛЕНИЕ БЕЗОПАСНОСТИ (раунд 3). Выполнить целиком в Supabase -> SQL Editor.
-- Можно запускать повторно. Без DROP: политики меняются через ALTER POLICY.
-- ==============================================================================

-- 1. Роли назначает только главный администратор; его собственную роль не меняет никто.
--    Раньше любой админ мог сделать человека админом или понизить главного админа.
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    if not public.is_owner() then
      raise exception 'Роли назначает только главный администратор';
    end if;
    if old.is_owner then
      raise exception 'Роль главного администратора менять нельзя';
    end if;
  end if;
  return new;
end;
$$;

-- 2. Профили: каждый видит только себя, админы — всех. Админ (не главный) может менять
--    только свой профиль и профили не-админов; профили админов и главного — только главный.
alter policy "Просмотр профилей доступен автори" on public.profiles
  using (id = auth.uid() or public.is_admin());
alter policy "Пользователь может изменять свой " on public.profiles
  using (id = auth.uid() or public.is_owner() or (public.is_admin() and role <> 'admin' and not is_owner))
  with check (id = auth.uid() or public.is_owner() or (public.is_admin() and role <> 'admin' and not is_owner));

-- 3. Обязательная смена пароля после того, как его задал администратор.
--    Флаг ставят только серверные функции (service role); снимается сам, когда меняется пароль.
alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- Email и флаг смены пароля из приложения не меняются (только серверные функции)
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if new.email is distinct from old.email then
      raise exception 'Email меняется только через управление пользователями';
    end if;
    if new.must_change_password is distinct from old.must_change_password then
      raise exception 'Это поле меняется только при смене пароля';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_fields on public.profiles;
create trigger protect_profile_fields before update on public.profiles
  for each row execute function public.protect_profile_fields();

create or replace function public.password_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set must_change_password = false where id = new.id and must_change_password;
  return new;
end;
$$;
revoke all on function public.password_changed() from public, anon, authenticated;
drop trigger if exists on_auth_password_changed on auth.users;
create trigger on_auth_password_changed after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.password_changed();

-- 4. Регистрация закрыта: аккаунт создаётся, только если серверная функция admin-create-user
--    заранее записала приглашение на этот email (действует 10 минут). Самостоятельный signUp падает.
create table if not exists public.account_invites (
  email text primary key,
  expires_at timestamptz not null
);
alter table public.account_invites enable row level security; -- политик нет: только service role

create or replace function public.guard_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.account_invites where expires_at < now();
  if new.email is not null and exists (select 1 from public.account_invites where email = lower(new.email)) then
    delete from public.account_invites where email = lower(new.email);
    return new;
  end if;
  raise exception 'Регистрация закрыта: аккаунты создаёт администратор';
end;
$$;
revoke all on function public.guard_signup() from public, anon, authenticated;
drop trigger if exists guard_signup on auth.users;
create trigger guard_signup before insert on auth.users
  for each row execute function public.guard_signup();

-- Новый профиль всегда с ролью «преподаватель» (раньше первый аккаунт становился админом)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 'user');
  return new;
end;
$$;

-- 5. Журнал аудита пишет только сервер: из приложения записи не добавить (и не подделать).
--    Смены ролей и предметов журналируются самой базой.
alter policy "Запись в журнал аудита" on public.audit_logs with check (false);

create or replace function public.audit_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and new.role is distinct from old.role then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'CHANGE_USER_ROLE', 'profiles', new.id, jsonb_build_object('old_role', old.role, 'new_role', new.role));
  end if;
  return new;
end;
$$;
revoke all on function public.audit_role_change() from public, anon, authenticated;
drop trigger if exists audit_role_change on public.profiles;
create trigger audit_role_change after update of role on public.profiles
  for each row execute function public.audit_role_change();

create or replace function public.audit_user_subjects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
    select auth.uid(), 'SET_USER_SUBJECTS', 'profiles', n.user_id, jsonb_build_object('subject_ids', jsonb_agg(n.subject_id))
    from new_rows n group by n.user_id;
  end if;
  return null;
end;
$$;
revoke all on function public.audit_user_subjects() from public, anon, authenticated;
drop trigger if exists audit_user_subjects on public.user_subjects;
create trigger audit_user_subjects after insert on public.user_subjects
  referencing new table as new_rows
  for each statement execute function public.audit_user_subjects();

-- 6. В сохранённый набор нельзя дописывать билеты и вопросы в обход лимитов:
--    только в течение 2 минут после создания набора и не больше лимитов генерации.
--    Администраторов и серверные функции не касается.
create or replace function public.guard_ticket_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.ticket_batches;
  cfg public.generation_settings;
  bid uuid;
  tid uuid;
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  -- Поля NEW разные у двух таблиц: обращаемся к ним только в своей ветке
  if tg_table_name = 'tickets' then
    bid := new.batch_id;
  else
    tid := new.ticket_id;
    select t.batch_id into bid from public.tickets t where t.id = tid;
  end if;
  select * into b from public.ticket_batches where id = bid;
  if not found or b.created_at < now() - interval '2 minutes' then
    raise exception 'Набор уже сохранён — изменить его нельзя';
  end if;
  select * into cfg from public.generation_settings where id;
  if not found then
    cfg.max_tickets := 4; cfg.max_per_ticket := 50;
  end if;
  if tg_table_name = 'tickets' then
    if (select count(*) from public.tickets where batch_id = bid) >= cfg.max_tickets then
      raise exception 'Не больше % билетов за один раз', cfg.max_tickets;
    end if;
  elsif (select count(*) from public.ticket_questions where ticket_id = tid) >= cfg.max_per_ticket then
    raise exception 'Не больше % вопросов в одном билете', cfg.max_per_ticket;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_ticket_insert() from public, anon, authenticated;
drop trigger if exists guard_ticket_insert on public.tickets;
create trigger guard_ticket_insert before insert on public.tickets
  for each row execute function public.guard_ticket_insert();
drop trigger if exists guard_ticket_insert on public.ticket_questions;
create trigger guard_ticket_insert before insert on public.ticket_questions
  for each row execute function public.guard_ticket_insert();

-- 7. Фиксированный search_path у всех функций, где его не было (защита от подмены таблиц)
alter function public.is_admin() set search_path = public;
alter function public.handle_updated_at() set search_path = public;
alter function public.prevent_owner_escalation() set search_path = public;
alter function public.prevent_owner_on_insert() set search_path = public;
alter function public.is_cluster_batch(jsonb) set search_path = public;
alter function public.game_now_ms() set search_path = public;
alter function public.game_has_n(jsonb, integer) set search_path = public;
alter function public.generation_settings_stamp() set search_path = public;

-- 8. Проверки прав нужны только вошедшим: гостю (anon) их вызывать незачем
do $$
declare f text;
begin
  foreach f in array array[
    'public.can_manage_chapter(uuid)', 'public.can_manage_question(uuid)', 'public.can_manage_subject(uuid)',
    'public.can_view_question(uuid)', 'public.can_view_subject(uuid)',
    'public.is_admin()', 'public.is_owner()', 'public.is_staff()', 'public.my_rank()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
