-- Ускорение чтения вариантов ответов и пар соответствия под RLS.
-- Раньше политики для каждой строки вызывали can_manage_question + can_view_subject с чтением questions (под её RLS):
-- запрос на 1000 вопросов с вариантами занимал ~1,5 с и упирался в statement_timeout на дальних страницах.
-- Видимость прежняя: admin и user — всё; subject_teacher и subject_admin — только свои предметы.
-- Откат: выполнить снова supabase/sql/subject_roles_options.sql.
begin;

create or replace function public.can_view_question(qid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (
    p.role in ('user', 'admin')
    or (p.role in ('subject_teacher', 'subject_admin') and exists (
      select 1 from public.questions q join public.user_subjects us on us.subject_id = q.subject_id
      where q.id = qid and us.user_id = p.id))));
$$;

drop policy if exists "Просмотр вариантов" on public.question_options;
create policy "Просмотр вариантов" on public.question_options for select to authenticated
  using (public.can_view_question(question_id));

drop policy if exists "Просмотр элементов соответствия" on public.matching_items;
create policy "Просмотр элементов соответствия" on public.matching_items for select to authenticated
  using (public.can_view_question(question_id));

commit;
