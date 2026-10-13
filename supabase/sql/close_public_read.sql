-- Закрывает чтение банка вопросов для гостей (без входа).
-- Выполните целиком в Supabase -> SQL Editor.
drop policy if exists "Просмотр предметов" on public.subjects;
create policy "Просмотр предметов" on public.subjects for select to authenticated using (is_deleted = false or public.is_admin());

drop policy if exists "Просмотр глав" on public.chapters;
create policy "Просмотр глав" on public.chapters for select to authenticated using (is_deleted = false or public.is_admin());

drop policy if exists "Просмотр тем" on public.topics;
create policy "Просмотр тем" on public.topics for select to authenticated using (is_deleted = false or public.is_admin());

drop policy if exists "Просмотр источников" on public.sources;
create policy "Просмотр источников" on public.sources for select to authenticated using (true);

drop policy if exists "Просмотр вопросов" on public.questions;
create policy "Просмотр вопросов" on public.questions for select to authenticated using (is_deleted = false or public.is_admin());

drop policy if exists "Просмотр вариантов" on public.question_options;
create policy "Просмотр вариантов" on public.question_options for select to authenticated using (true);

drop policy if exists "Просмотр элементов соответствия" on public.matching_items;
create policy "Просмотр элементов соответствия" on public.matching_items for select to authenticated using (true);

drop policy if exists "Просмотр партий билетов" on public.ticket_batches;
create policy "Просмотр партий билетов" on public.ticket_batches for select to authenticated using (true);

drop policy if exists "Просмотр билетов" on public.tickets;
create policy "Просмотр билетов" on public.tickets for select to authenticated using (true);

drop policy if exists "Просмотр вопросов в билетах" on public.ticket_questions;
create policy "Просмотр вопросов в билетах" on public.ticket_questions for select to authenticated using (true);
