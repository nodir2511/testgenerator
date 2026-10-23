-- Ускорение чтения вопросов, вариантов ответов и пар соответствия под RLS.
-- Раньше политики вызывали is_admin / can_view_subject / can_manage_subject для КАЖДОЙ строки, и каждая читала profiles:
-- подсчёт 8 тысяч вопросов занимал 0,3–4 с (у учителей предметов), выгрузка вариантов — столько же.
-- Теперь роль и список предметов пользователя вычисляются один раз на запрос.
-- Видимость прежняя:
--   admin — все вопросы, включая удалённые; user — все неудалённые;
--   subject_teacher — неудалённые вопросы своих предметов; subject_admin — все вопросы своих предметов (и удалённые).
-- Варианты и пары соответствия — как раньше: admin и user видят все, остальные — по своим предметам.
-- Откат: выполнить снова subject_roles_options.sql и question_children_rls_fast.sql, а политику вопросов вернуть из subject_roles*.sql.
begin;

create or replace function public.auth_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = (select auth.uid());
$$;

-- Предметы, назначенные текущему пользователю (для ролей «по предметам»)
create or replace function public.auth_subject_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select us.subject_id from public.user_subjects us
  join public.profiles p on p.id = us.user_id
  where p.id = (select auth.uid()) and p.role in ('subject_teacher', 'subject_admin');
$$;

-- Все вопросы назначенных предметов (в обход RLS, включая удалённые): как раньше делал can_view_question
create or replace function public.auth_question_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select q.id from public.questions q where q.subject_id in (select public.auth_subject_ids());
$$;

revoke all on function public.auth_role() from public, anon;
revoke all on function public.auth_subject_ids() from public, anon;
revoke all on function public.auth_question_ids() from public, anon;
grant execute on function public.auth_role() to authenticated, service_role;
grant execute on function public.auth_subject_ids() to authenticated, service_role;
grant execute on function public.auth_question_ids() to authenticated, service_role;

drop policy if exists "Просмотр вопросов" on public.questions;
create policy "Просмотр вопросов" on public.questions for select to authenticated using (
  ((select public.auth_role()) = 'admin')
  or ((select public.auth_role()) = 'user' and not is_deleted)
  or (not is_deleted and subject_id in (select public.auth_subject_ids()))
  or ((select public.auth_role()) = 'subject_admin' and subject_id in (select public.auth_subject_ids()))
);

drop policy if exists "Просмотр вариантов" on public.question_options;
create policy "Просмотр вариантов" on public.question_options for select to authenticated using (
  (select public.auth_role()) in ('admin', 'user')
  or question_id in (select public.auth_question_ids())
);

drop policy if exists "Просмотр элементов соответствия" on public.matching_items;
create policy "Просмотр элементов соответствия" on public.matching_items for select to authenticated using (
  (select public.auth_role()) in ('admin', 'user')
  or question_id in (select public.auth_question_ids())
);

commit;
