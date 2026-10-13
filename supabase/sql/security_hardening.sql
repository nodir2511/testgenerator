-- ==============================================================================
-- УСИЛЕНИЕ БЕЗОПАСНОСТИ
-- Преподаватели: только просмотр и скачивание (генерация билетов остаётся).
-- Изменять банк вопросов, предметы, темы, источники, импорт — только админ.
-- Выполните целиком в Supabase -> SQL Editor.
-- ==============================================================================

-- 1. Журнал аудита: запись только от своего имени
drop policy if exists "Запись в журнал аудита" on public.audit_logs;
create policy "Запись в журнал аудита" on public.audit_logs
  for insert to authenticated with check (user_id = auth.uid());

-- 2. Предметы, главы, темы, источники: запись только админам
drop policy if exists "Добавление предметов" on public.subjects;
drop policy if exists "Редактирование предметов" on public.subjects;
create policy "Добавление предметов" on public.subjects for insert to authenticated with check (public.is_admin());
create policy "Редактирование предметов" on public.subjects for update to authenticated using (public.is_admin());

drop policy if exists "Добавление глав" on public.chapters;
drop policy if exists "Редактирование глав" on public.chapters;
create policy "Добавление глав" on public.chapters for insert to authenticated with check (public.is_admin());
create policy "Редактирование глав" on public.chapters for update to authenticated using (public.is_admin());

drop policy if exists "Добавление тем" on public.topics;
drop policy if exists "Редактирование тем" on public.topics;
create policy "Добавление тем" on public.topics for insert to authenticated with check (public.is_admin());
create policy "Редактирование тем" on public.topics for update to authenticated using (public.is_admin());

drop policy if exists "Добавление источников" on public.sources;
create policy "Добавление источников" on public.sources for insert to authenticated with check (public.is_admin());

-- 3. Вопросы, варианты, соответствия: запись только админам
drop policy if exists "Создание вопросов" on public.questions;
drop policy if exists "Редактирование вопросов" on public.questions;
create policy "Создание вопросов" on public.questions for insert to authenticated with check (public.is_admin());
create policy "Редактирование вопросов" on public.questions for update to authenticated using (public.is_admin());

drop policy if exists "Создание вариантов" on public.question_options;
drop policy if exists "Редактирование вариантов" on public.question_options;
drop policy if exists "Удаление вариантов" on public.question_options;
create policy "Создание вариантов" on public.question_options for insert to authenticated with check (public.is_admin());
create policy "Редактирование вариантов" on public.question_options for update to authenticated using (public.is_admin());
create policy "Удаление вариантов" on public.question_options for delete to authenticated using (public.is_admin());

drop policy if exists "Создание элементов соответствия" on public.matching_items;
drop policy if exists "Редактирование элементов соответствия" on public.matching_items;
drop policy if exists "Удаление элементов соответствия" on public.matching_items;
create policy "Создание элементов соответствия" on public.matching_items for insert to authenticated with check (public.is_admin());
create policy "Редактирование элементов соответствия" on public.matching_items for update to authenticated using (public.is_admin());
create policy "Удаление элементов соответствия" on public.matching_items for delete to authenticated using (public.is_admin());

-- 4. Партии импорта: создание только админам
drop policy if exists "Создание партий импорта" on public.import_batches;
create policy "Создание партий импорта" on public.import_batches for insert to authenticated with check (public.is_admin());

-- 5. Хранилище картинок: без SVG; список файлов и загрузка/удаление — по ролям
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'question-images';

drop policy if exists "Публичный доступ к просмотру изображений" on storage.objects;
create policy "Просмотр изображений авторизованными" on storage.objects
  for select to authenticated using (bucket_id = 'question-images');

drop policy if exists "Авторизованные пользователи могут загружать картинки" on storage.objects;
create policy "Загрузка картинок администраторами" on storage.objects
  for insert to authenticated with check (bucket_id = 'question-images' and public.is_admin());
