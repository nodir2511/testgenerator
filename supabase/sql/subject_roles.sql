-- Роли по предметам.
--   user            — преподаватель (все предметы, как раньше)
--   subject_teacher — преподаватель по предметам: видит и использует только назначенные предметы
--   subject_admin   — администратор по предметам: видит и редактирует только назначенные предметы
--   admin           — администратор (все предметы, как раньше)
-- Назначать роли по предметам и предметы может только главный админ (is_owner).
-- Скрипт безопасно запускать повторно. Существующим админам и преподавателям ничего не меняется.

begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('user', 'admin', 'subject_teacher', 'subject_admin'));

-- Какие предметы назначены пользователю
create table if not exists public.user_subjects (
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, subject_id)
);
alter table public.user_subjects enable row level security;

drop policy if exists "Свои предметы видит владелец записи и админ" on public.user_subjects;
create policy "Свои предметы видит владелец записи и админ" on public.user_subjects
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "Назначает предметы только главный админ" on public.user_subjects;
create policy "Назначает предметы только главный админ" on public.user_subjects
  for insert to authenticated with check (public.is_owner());
drop policy if exists "Снимает предметы только главный админ" on public.user_subjects;
create policy "Снимает предметы только главный админ" on public.user_subjects
  for delete to authenticated using (public.is_owner());

-- Функции доступа ------------------------------------------------------------
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'subject_admin'));
$$;

-- Видит ли пользователь предмет (обычные роли — все; «по предметам» — только назначенные)
create or replace function public.can_view_subject(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role in ('user', 'admin')
        or (p.role in ('subject_teacher', 'subject_admin')
            and exists (select 1 from public.user_subjects us where us.user_id = p.id and us.subject_id = sid))
      )
  );
$$;

-- Может ли пользователь редактировать содержимое предмета
create or replace function public.can_manage_subject(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (p.role = 'subject_admin'
            and exists (select 1 from public.user_subjects us where us.user_id = p.id and us.subject_id = sid))
      )
  );
$$;

create or replace function public.can_manage_chapter(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_subject((select subject_id from public.chapters where id = cid));
$$;

create or replace function public.can_manage_question(qid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_subject((select subject_id from public.questions where id = qid));
$$;

-- Смена роли: обычные роли — админ; роли «по предметам» (в обе стороны) — только главный админ
create or replace function public.prevent_role_escalation()
returns trigger as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    if new.role in ('subject_teacher', 'subject_admin') or old.role in ('subject_teacher', 'subject_admin') then
      if not public.is_owner() then
        raise exception 'Роли по предметам назначает только главный администратор';
      end if;
    elsif not public.is_admin() then
      raise exception 'Только администратор может менять роль пользователя';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- Чтение: «по предметам» видят только свои предметы ----------------------------
drop policy if exists "Просмотр предметов" on public.subjects;
create policy "Просмотр предметов" on public.subjects for select to authenticated
  using (public.is_admin() or (is_deleted = false and public.can_view_subject(id)) or public.can_manage_subject(id));

drop policy if exists "Просмотр глав" on public.chapters;
create policy "Просмотр глав" on public.chapters for select to authenticated
  using (public.is_admin() or (is_deleted = false and public.can_view_subject(subject_id)) or public.can_manage_subject(subject_id));

drop policy if exists "Просмотр тем" on public.topics;
create policy "Просмотр тем" on public.topics for select to authenticated
  using (public.is_admin() or (is_deleted = false and public.can_view_subject((select c.subject_id from public.chapters c where c.id = chapter_id)))
         or public.can_manage_chapter(chapter_id));

drop policy if exists "Просмотр вопросов" on public.questions;
create policy "Просмотр вопросов" on public.questions for select to authenticated
  using (public.is_admin() or (is_deleted = false and public.can_view_subject(subject_id)) or public.can_manage_subject(subject_id));

-- Запись: админ предмета — только в своём предмете ----------------------------
drop policy if exists "Добавление глав" on public.chapters;
create policy "Добавление глав" on public.chapters for insert to authenticated with check (public.can_manage_subject(subject_id));
drop policy if exists "Редактирование глав" on public.chapters;
create policy "Редактирование глав" on public.chapters for update to authenticated using (public.can_manage_subject(subject_id));
drop policy if exists "Удаление глав только админам" on public.chapters;
create policy "Удаление глав только админам" on public.chapters for delete to authenticated using (public.can_manage_subject(subject_id));

drop policy if exists "Добавление тем" on public.topics;
create policy "Добавление тем" on public.topics for insert to authenticated with check (public.can_manage_chapter(chapter_id));
drop policy if exists "Редактирование тем" on public.topics;
create policy "Редактирование тем" on public.topics for update to authenticated using (public.can_manage_chapter(chapter_id));
drop policy if exists "Удаление тем только админам" on public.topics;
create policy "Удаление тем только админам" on public.topics for delete to authenticated using (public.can_manage_chapter(chapter_id));

drop policy if exists "Создание вопросов" on public.questions;
create policy "Создание вопросов" on public.questions for insert to authenticated with check (public.can_manage_subject(subject_id));
drop policy if exists "Редактирование вопросов" on public.questions;
create policy "Редактирование вопросов" on public.questions for update to authenticated using (public.can_manage_subject(subject_id));
drop policy if exists "Удаление вопросов только админам" on public.questions;
create policy "Удаление вопросов только админам" on public.questions for delete to authenticated using (public.can_manage_subject(subject_id));

drop policy if exists "Создание вариантов" on public.question_options;
create policy "Создание вариантов" on public.question_options for insert to authenticated with check (public.can_manage_question(question_id));
drop policy if exists "Редактирование вариантов" on public.question_options;
create policy "Редактирование вариантов" on public.question_options for update to authenticated using (public.can_manage_question(question_id));
drop policy if exists "Удаление вариантов" on public.question_options;
create policy "Удаление вариантов" on public.question_options for delete to authenticated using (public.can_manage_question(question_id));

drop policy if exists "Создание элементов соответствия" on public.matching_items;
create policy "Создание элементов соответствия" on public.matching_items for insert to authenticated with check (public.can_manage_question(question_id));
drop policy if exists "Редактирование элементов соответствия" on public.matching_items;
create policy "Редактирование элементов соответствия" on public.matching_items for update to authenticated using (public.can_manage_question(question_id));
drop policy if exists "Удаление элементов соответствия" on public.matching_items;
create policy "Удаление элементов соответствия" on public.matching_items for delete to authenticated using (public.can_manage_question(question_id));

-- Общие служебные таблицы: достаточно быть администратором (любого уровня)
drop policy if exists "Создание партий импорта" on public.import_batches;
create policy "Создание партий импорта" on public.import_batches for insert to authenticated with check (public.is_staff());
drop policy if exists "Откат партий импорта только админам" on public.import_batches;
create policy "Откат партий импорта только админам" on public.import_batches for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()));

drop policy if exists "Добавление источников" on public.sources;
create policy "Добавление источников" on public.sources for insert to authenticated with check (public.is_staff());
drop policy if exists "Редактирование источников" on public.sources;
create policy "Редактирование источников" on public.sources for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "Запись в журнал аудита" on public.audit_logs;
create policy "Запись в журнал аудита" on public.audit_logs for insert to authenticated
  with check (user_id = auth.uid() and public.is_staff());

drop policy if exists "Загрузка картинок администратора" on storage.objects;
create policy "Загрузка картинок администратора" on storage.objects for insert to authenticated
  with check (bucket_id = 'question-images' and public.is_staff());
drop policy if exists "Удаление картинок администратора" on storage.objects;
create policy "Удаление картинок администратора" on storage.objects for delete to authenticated
  using (bucket_id = 'question-images' and public.is_staff());

commit;
