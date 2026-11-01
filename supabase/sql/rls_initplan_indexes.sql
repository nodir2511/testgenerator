-- Ускорение политик доступа и несколько индексов (подсказки Supabase: auth_rls_initplan, unindexed_foreign_keys).
-- Раньше auth.uid() в политиках вычислялся заново для каждой строки; в виде (select auth.uid()) он считается один раз на запрос.
-- Смысл политик не меняется: правится только запись auth.uid() -> (select auth.uid()). Имена политик взяты из pg_policies как есть.
-- Повторный запуск безопасен. Применено: supabase db query --linked -f supabase/sql/rls_initplan_indexes.sql
begin;

-- Своя игра
alter policy "game_results_delete" on public.game_results using ((host_id = (select auth.uid())));
alter policy "game_results_insert" on public.game_results with check (((host_id = (select auth.uid())) and (is_admin() or is_owner())));
alter policy "game_results_read" on public.game_results using (((host_id = (select auth.uid())) or is_owner()));
alter policy "game_results_update" on public.game_results using ((host_id = (select auth.uid()))) with check ((host_id = (select auth.uid())));
alter policy "game_sessions_host_update" on public.game_sessions using ((host_id = (select auth.uid()))) with check ((host_id = (select auth.uid())));

-- Журнал генераций, импорт
alter policy "Просмотр своих генераций" on public.generation_usage using (((user_id = (select auth.uid())) or is_admin()));
alter policy "Откат партий импорта только админ" on public.import_batches using ((is_admin() or (is_staff() and (created_by = (select auth.uid())))));

-- Профили и предметы пользователей (читаются при каждом входе)
alter policy "Пользователь может изменять свой " on public.profiles
  using (((id = (select auth.uid())) or is_owner() or (is_admin() and (role <> 'admin'::text) and (not is_owner))))
  with check (((id = (select auth.uid())) or is_owner() or (is_admin() and (role <> 'admin'::text) and (not is_owner))));
alter policy "Просмотр профилей доступен автори" on public.profiles using (((id = (select auth.uid())) or is_admin()));
alter policy "Свои предметы видит владелец запи" on public.user_subjects using (((user_id = (select auth.uid())) or is_admin()));

-- «Что нового»
alter policy "Отметить прочитанным" on public.site_release_reads with check ((user_id = (select auth.uid())));
alter policy "Свои отметки прочтения" on public.site_release_reads using ((user_id = (select auth.uid())));

-- Telegram и настройки пользователя
alter policy "Свой Telegram: отвязка" on public.telegram_links using ((user_id = (select auth.uid())));
alter policy "Свой Telegram: просмотр" on public.telegram_links using ((user_id = (select auth.uid())));
alter policy "Свои настройки: добавление" on public.user_prefs with check ((user_id = (select auth.uid())));
alter policy "Свои настройки: изменение" on public.user_prefs using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
alter policy "Свои настройки: просмотр" on public.user_prefs using ((user_id = (select auth.uid())));
alter policy "Свои настройки: удаление" on public.user_prefs using ((user_id = (select auth.uid())));

-- Партии, билеты и их вопросы (сохранение билета вставляет сотни строк ticket_questions, политика проверяется на каждой)
alter policy "Просмотр партий билетов" on public.ticket_batches
  using ((is_owner() or ((created_by = (select auth.uid())) and (not is_cluster_batch(generation_params)))));
alter policy "Создание партий билетов" on public.ticket_batches
  with check (((created_by = (select auth.uid())) and ((not is_cluster_batch(generation_params)) or is_owner())));
alter policy "Удаление партий билетов" on public.ticket_batches
  using ((((is_admin() or (created_by = (select auth.uid())))) and ((not is_cluster_batch(generation_params)) or is_owner())));

alter policy "Просмотр билетов" on public.tickets using (exists (
  select 1 from ticket_batches b
  where b.id = tickets.batch_id and (is_owner() or ((b.created_by = (select auth.uid())) and (not is_cluster_batch(b.generation_params))))));
alter policy "Создание билетов" on public.tickets with check (exists (
  select 1 from ticket_batches b
  where b.id = tickets.batch_id and b.created_by = (select auth.uid())));

alter policy "Просмотр вопросов в билетах" on public.ticket_questions using (exists (
  select 1 from tickets t join ticket_batches b on b.id = t.batch_id
  where t.id = ticket_questions.ticket_id and (is_owner() or ((b.created_by = (select auth.uid())) and (not is_cluster_batch(b.generation_params))))));
alter policy "Создание вопросов в билетах" on public.ticket_questions with check (exists (
  select 1 from tickets t join ticket_batches b on b.id = t.batch_id
  where t.id = ticket_questions.ticket_id and b.created_by = (select auth.uid())));

-- Индексы: удаление вопросов проверяет ticket_questions.question_id; список последних наборов фильтрует по автору и сортирует по дате
create index if not exists idx_ticket_questions_qid on public.ticket_questions (question_id);
create index if not exists idx_ticket_batches_creator on public.ticket_batches (created_by, created_at desc);
create index if not exists idx_ticket_batches_subject on public.ticket_batches (subject_id);
create index if not exists idx_user_subjects_subject on public.user_subjects (subject_id);

commit;
