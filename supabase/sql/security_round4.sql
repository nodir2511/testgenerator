-- Безопасность, раунд 4 (аудит 2026-11-07). Повторный запуск безопасен.
--
-- 1) Анонимам (без входа) не нужны права на таблицы: игра ходит через security definer-функции game_*,
--    а подписка на игру читает только game_sessions (политика game_sessions_read).
-- 2) Права TRUNCATE / REFERENCES / TRIGGER не нужны никому из ролей API.
-- 3) Триггерные функции не должны вызываться через /rest/v1/rpc.
-- 4) Индексы на внешние ключи (советы Supabase) и порядок в корзине вопросов.

-- 1. Таблицы: анониму оставляем только чтение game_sessions
revoke all on all tables in schema public from anon;
grant select on public.game_sessions to anon;

-- Новые таблицы больше не выдаются анониму автоматически
alter default privileges for role postgres revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- 2. Служебные права у вошедших пользователей
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- 3. Триггерные функции: вызываются только самой базой
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.prevent_role_escalation()   from public, anon, authenticated;
revoke execute on function public.enforce_generation_limits() from public, anon, authenticated;

-- 4. Индексы на внешние ключи
create index if not exists idx_audit_logs_user                 on public.audit_logs (user_id);
create index if not exists idx_game_results_host               on public.game_results (host_id);
create index if not exists idx_generation_settings_updated_by  on public.generation_settings (updated_by);
create index if not exists idx_generation_usage_batch          on public.generation_usage (batch_id);
create index if not exists idx_import_batches_created_by       on public.import_batches (created_by);
create index if not exists idx_questions_batch                 on public.questions (batch_id);
create index if not exists idx_questions_chapter               on public.questions (chapter_id);
create index if not exists idx_questions_created_by            on public.questions (created_by);
create index if not exists idx_questions_deleted_by            on public.questions (deleted_by);
create index if not exists idx_questions_source                on public.questions (source_id);
create index if not exists idx_questions_updated_by            on public.questions (updated_by);
create index if not exists idx_site_release_items_subject      on public.site_release_items (subject_id);
create index if not exists idx_site_release_reads_release      on public.site_release_reads (release_id);
create index if not exists idx_subjects_created_by             on public.subjects (created_by);
create index if not exists idx_telegram_link_codes_user        on public.telegram_link_codes (user_id);

-- Корзина: у удалённых вопросов должна быть дата удаления
update public.questions
   set deleted_at = coalesce(updated_at, now())
 where is_deleted and deleted_at is null;
