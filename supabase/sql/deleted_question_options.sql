-- Варианты ответов и пары соответствия удалённого вопроса видит только тот, кто видит сам удалённый вопрос.
-- Раньше can_view_question не смотрела на is_deleted: преподаватель (user) и преподаватель по предметам (subject_teacher)
-- могли прочитать варианты и пары вопросов из корзины, хотя сами вопросы им не показываются.
-- Теперь видимость совпадает с политикой «Просмотр вопросов» (questions_rls_fast.sql):
--   admin — всё; user — неудалённые; subject_teacher — неудалённые своих предметов; subject_admin — все своих предметов.
-- Политики question_options и matching_items не меняются: они вызывают эту функцию.
-- Снимки вопросов в билетах самодостаточны и от этого не зависят.
-- Повторный запуск безопасен. Откат: выполнить снова supabase/sql/question_children_rls_fast.sql.
-- Применить: supabase db query --linked -f supabase/sql/deleted_question_options.sql

create or replace function public.can_view_question(qid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (
    p.role = 'admin'
    or (p.role = 'user' and exists (
      select 1 from public.questions q where q.id = qid and not q.is_deleted))
    or (p.role in ('subject_teacher', 'subject_admin') and exists (
      select 1 from public.questions q join public.user_subjects us on us.subject_id = q.subject_id
      where q.id = qid and us.user_id = p.id and (p.role = 'subject_admin' or not q.is_deleted)))));
$$;
