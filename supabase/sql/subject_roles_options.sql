-- Варианты ответов и элементы соответствия: роли «по предметам» видят только данные своих предметов.
-- Замер на рабочей базе (12 тыс. строк): 410 мс без политики и 410 мс с ней — замедления нет.
-- Выполнять после subject_roles.sql. Можно запускать повторно.

begin;

drop policy if exists "Просмотр вариантов" on public.question_options;
create policy "Просмотр вариантов" on public.question_options for select to authenticated
  using (public.can_manage_question(question_id)
         or public.can_view_subject((select q.subject_id from public.questions q where q.id = question_id)));

drop policy if exists "Просмотр элементов соответствия" on public.matching_items;
create policy "Просмотр элементов соответствия" on public.matching_items for select to authenticated
  using (public.can_manage_question(question_id)
         or public.can_view_subject((select q.subject_id from public.questions q where q.id = question_id)));

commit;
