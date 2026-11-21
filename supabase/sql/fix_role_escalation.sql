-- !!! УСТАРЕЛ. ПОВТОРНО НЕ ПРИМЕНЯТЬ. Файл оставлен только как история.
-- Его политики и функции заменены более поздними файлами (subject_roles.sql, questions_rls_fast.sql,
-- security_round2–5.sql, cluster_batches.sql, owner_only_delete_batches.sql). Повторный запуск
-- вернёт старые, более широкие права (например, все наборы билетов станут видны всем).
-- Запрет смены роли не-администраторами.
-- Роль может менять только админ (через приложение) либо service role / SQL Editor (auth.uid() is null).
create or replace function public.prevent_role_escalation()
returns trigger as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Только администратор может менять роль пользователя';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists prevent_profiles_role_escalation on public.profiles;
create trigger prevent_profiles_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_escalation();
