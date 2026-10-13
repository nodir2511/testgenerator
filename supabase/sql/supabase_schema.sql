-- ==============================================================================
-- СХЕМА БАЗЫ ДАННЫХ ДЛЯ СЕРВИСА ЭКЗАМЕНАЦИОННЫХ БИЛЕТОВ
-- Запустите этот скрипт в Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. Очистка старых объектов (если скрипт перезапускается)
-- (Безопасно для первого запуска)
create extension if not exists "uuid-ossp";

-- ==============================================================================
-- ТАБЛИЦА: Профили пользователей и роли
-- ==============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ==============================================================================
-- ТАКСОНОМИЯ: Предметы, Главы, Темы, Источники
-- ==============================================================================
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_deleted boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null,
  order_index int not null default 0,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  name text not null,
  order_index int not null default 0,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

-- ==============================================================================
-- ПАРТИИ МАССОВОГО ИМПОРТА
-- ==============================================================================
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  filename text,
  items_count int not null default 0,
  is_reverted boolean not null default false,
  created_at timestamptz not null default now()
);

-- ==============================================================================
-- ТАБЛИЦА ВОПРОСОВ (Банк вопросов)
-- ==============================================================================
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  source_id uuid references public.sources(id) on delete set null,
  batch_id uuid references public.import_batches(id) on delete set null,
  type text not null check (type in ('test', 'matching', 'open')),
  content text not null,
  image_url text,
  correct_numeric_answer numeric,
  version int not null default 1,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  seq bigserial,
  num int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Варианты ответов для тестовых вопросов
create table if not exists public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  text text not null,
  image_url text,
  is_correct boolean not null default false,
  order_index int not null default 0
);

-- Элементы для заданий на соответствие (левая и правая стороны)
create table if not exists public.matching_items (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  side text not null check (side in ('left', 'right')),
  text text not null,
  image_url text,
  order_index int not null default 0,
  correct_match_id uuid
);

-- ==============================================================================
-- БИЛЕТЫ И ИХ НЕИЗМЕНЯЕМЫЙ СОСТАВ (СНАПШОТЫ)
-- ==============================================================================
create table if not exists public.ticket_batches (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  generation_params jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ticket_batches(id) on delete cascade,
  ticket_number int not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_questions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  question_id uuid references public.questions(id) on delete set null,
  order_index int not null,
  question_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

-- ==============================================================================
-- ЖУРНАЛ АУДИТА (Действия пользователей)
-- ==============================================================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ==============================================================================
-- ИНДЕКСЫ ДЛЯ МАКСИМАЛЬНОГО БЫСТРОДЕЙСТВИЯ (<0.5 сек)
-- ==============================================================================
create index if not exists idx_questions_lookup on public.questions (subject_id, chapter_id, topic_id, type) where is_deleted = false;
create index if not exists idx_questions_created_at on public.questions (created_at desc);
create index if not exists idx_questions_topic_seq on public.questions (topic_id, seq);
create index if not exists idx_question_options_qid on public.question_options (question_id);
create index if not exists idx_matching_items_qid on public.matching_items (question_id);
create index if not exists idx_chapters_subject on public.chapters (subject_id, order_index);
create index if not exists idx_topics_chapter on public.topics (chapter_id, order_index);
create index if not exists idx_ticket_questions_tid on public.ticket_questions (ticket_id, order_index);
create index if not exists idx_tickets_batch on public.tickets (batch_id, ticket_number);

-- ==============================================================================
-- ТРИГГЕРЫ: Автоматическое обновление updated_at
-- ==============================================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.handle_updated_at();

drop trigger if exists set_subjects_updated_at on public.subjects;
create trigger set_subjects_updated_at before update on public.subjects for each row execute function public.handle_updated_at();

drop trigger if exists set_chapters_updated_at on public.chapters;
create trigger set_chapters_updated_at before update on public.chapters for each row execute function public.handle_updated_at();

drop trigger if exists set_topics_updated_at on public.topics;
create trigger set_topics_updated_at before update on public.topics for each row execute function public.handle_updated_at();

drop trigger if exists set_questions_updated_at on public.questions;
create trigger set_questions_updated_at before update on public.questions for each row execute function public.handle_updated_at();

-- ==============================================================================
-- ТРИГГЕР: Создание профиля при регистрации в auth.users
-- Первый зарегистрированный пользователь автоматически получает роль 'admin'
-- ==============================================================================
create or replace function public.handle_new_user()
returns trigger as $$
declare
  user_count int;
begin
  select count(*) into user_count from public.profiles;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when user_count = 0 then 'admin' else 'user' end
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ==============================================================================
-- ФУНКЦИЯ ДЛЯ ПРОВЕРКИ РОЛИ АДМИНИСТРАТОРА (SECURITY DEFINER)
-- ==============================================================================
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

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

-- ==============================================================================
-- БЕЗОПАСНОСТЬ: ROW LEVEL SECURITY (RLS)
-- ==============================================================================
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.chapters enable row level security;
alter table public.topics enable row level security;
alter table public.sources enable row level security;
alter table public.import_batches enable row level security;
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.matching_items enable row level security;
alter table public.ticket_batches enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_questions enable row level security;
alter table public.audit_logs enable row level security;

-- Политики profiles
create policy "Просмотр профилей доступен авторизованным пользователям" on public.profiles
  for select to authenticated using (true);

create policy "Пользователь может изменять свой профиль" on public.profiles
  for update to authenticated using (auth.uid() = id or public.is_admin());

-- Политики subjects, chapters, topics, sources
create policy "Просмотр предметов" on public.subjects
  for select to authenticated using (is_deleted = false or public.is_admin());
create policy "Добавление предметов" on public.subjects
  for insert to authenticated with check (public.is_admin());
create policy "Редактирование предметов" on public.subjects
  for update to authenticated using (public.is_admin());
create policy "Удаление предметов только админам" on public.subjects
  for delete to authenticated using (public.is_admin());

create policy "Просмотр глав" on public.chapters
  for select to authenticated using (is_deleted = false or public.is_admin());
create policy "Добавление глав" on public.chapters
  for insert to authenticated with check (public.is_admin());
create policy "Редактирование глав" on public.chapters
  for update to authenticated using (public.is_admin());
create policy "Удаление глав только админам" on public.chapters
  for delete to authenticated using (public.is_admin());

create policy "Просмотр тем" on public.topics
  for select to authenticated using (is_deleted = false or public.is_admin());
create policy "Добавление тем" on public.topics
  for insert to authenticated with check (public.is_admin());
create policy "Редактирование тем" on public.topics
  for update to authenticated using (public.is_admin());
create policy "Удаление тем только админам" on public.topics
  for delete to authenticated using (public.is_admin());

create policy "Просмотр источников" on public.sources
  for select to authenticated using (true);
create policy "Добавление источников" on public.sources
  for insert to authenticated with check (public.is_admin());

-- Политики вопросов
create policy "Просмотр вопросов" on public.questions
  for select to authenticated using (is_deleted = false or public.is_admin());
create policy "Создание вопросов" on public.questions
  for insert to authenticated with check (public.is_admin());
create policy "Редактирование вопросов" on public.questions
  for update to authenticated using (public.is_admin());
create policy "Удаление вопросов только админам" on public.questions
  for delete to authenticated using (public.is_admin());

-- Политики вариантов и соответствий
create policy "Просмотр вариантов" on public.question_options for select to authenticated using (true);
create policy "Создание вариантов" on public.question_options for insert to authenticated with check (public.is_admin());
create policy "Редактирование вариантов" on public.question_options for update to authenticated using (public.is_admin());
create policy "Удаление вариантов" on public.question_options for delete to authenticated using (public.is_admin());

create policy "Просмотр элементов соответствия" on public.matching_items for select to authenticated using (true);
create policy "Создание элементов соответствия" on public.matching_items for insert to authenticated with check (public.is_admin());
create policy "Редактирование элементов соответствия" on public.matching_items for update to authenticated using (public.is_admin());
create policy "Удаление элементов соответствия" on public.matching_items for delete to authenticated using (public.is_admin());

-- Политики билетов
create policy "Просмотр партий билетов" on public.ticket_batches for select to authenticated using (true);
create policy "Создание партий билетов" on public.ticket_batches for insert to authenticated with check (created_by = auth.uid());
create policy "Удаление партий билетов" on public.ticket_batches for delete to authenticated using (public.is_admin() or created_by = auth.uid());

create policy "Просмотр билетов" on public.tickets for select to authenticated using (true);
create policy "Создание билетов" on public.tickets for insert to authenticated with check (exists (select 1 from public.ticket_batches b where b.id = batch_id and b.created_by = auth.uid()));

create policy "Просмотр вопросов в билетах" on public.ticket_questions for select to authenticated using (true);
create policy "Создание вопросов в билетах" on public.ticket_questions for insert to authenticated with check (exists (select 1 from public.tickets t join public.ticket_batches b on b.id = t.batch_id where t.id = ticket_id and b.created_by = auth.uid()));

-- Политики партий импорта
create policy "Просмотр партий импорта" on public.import_batches for select to authenticated using (true);
create policy "Создание партий импорта" on public.import_batches for insert to authenticated with check (public.is_admin());
create policy "Откат партий импорта только админам" on public.import_batches for update to authenticated using (public.is_admin());

-- Политики журнала аудита
create policy "Запись в журнал аудита" on public.audit_logs for insert to authenticated with check (user_id = auth.uid());
create policy "Просмотр журнала аудита только админам" on public.audit_logs for select to authenticated using (public.is_admin());

-- ==============================================================================
-- ХРАНИЛИЩЕ SUPABASE STORAGE: Бакет question-images
-- ==============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-images',
  'question-images',
  true,
  5242880, -- Лимит 5 МБ на файл
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880;

-- Политики доступа к бакету картинок
create policy "Просмотр изображений авторизованными" on storage.objects
  for select to authenticated using (bucket_id = 'question-images');

create policy "Загрузка картинок администраторами" on storage.objects
  for insert to authenticated with check (bucket_id = 'question-images' and public.is_admin());

create policy "Удаление картинок администраторами" on storage.objects
  for delete to authenticated using (bucket_id = 'question-images' and public.is_admin());
