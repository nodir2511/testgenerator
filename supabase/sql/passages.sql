-- Тексты для заданий (английский язык): чтение и текст с пропусками.
-- Вопрос к тексту — обычный тест (questions.type = 'test') со ссылкой passage_id и местом passage_order (1–8).
-- В тексте с пропусками место пропуска записано как {{1}} … {{8}} (номер = passage_order вопроса).
-- Идемпотентно: можно запускать повторно.

begin;

create table if not exists public.passages (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.subjects(id),
  chapter_id  uuid references public.chapters(id),
  topic_id    uuid references public.topics(id),
  source_id   uuid references public.sources(id),
  batch_id    uuid references public.import_batches(id),
  kind        text not null check (kind in ('reading', 'cloze')),
  title       text not null default '',
  content     text not null,
  is_deleted  boolean not null default false,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.passages is 'Тексты для чтения и с пропусками; вопросы ссылаются через questions.passage_id';
comment on column public.passages.content is 'Текст; в kind = cloze место пропуска — {{1}} … {{8}} (номер = questions.passage_order)';

create index if not exists passages_topic_idx   on public.passages (topic_id) where not is_deleted;
create index if not exists passages_subject_idx on public.passages (subject_id) where not is_deleted;
create index if not exists passages_batch_idx   on public.passages (batch_id);

alter table public.questions add column if not exists passage_id uuid references public.passages(id);
alter table public.questions add column if not exists passage_order smallint;
create index if not exists questions_passage_idx on public.questions (passage_id) where passage_id is not null;

drop trigger if exists set_passages_updated_at on public.passages;
create trigger set_passages_updated_at before update on public.passages
  for each row execute function public.handle_updated_at();

-- RLS: как у вопросов своего предмета
alter table public.passages enable row level security;

drop policy if exists "Просмотр текстов" on public.passages;
create policy "Просмотр текстов" on public.passages for select to authenticated using (
  public.can_view_subject(subject_id) and (not is_deleted or public.can_manage_subject(subject_id))
);
drop policy if exists "Создание текстов" on public.passages;
create policy "Создание текстов" on public.passages for insert to authenticated with check (public.can_manage_subject(subject_id));
drop policy if exists "Редактирование текстов" on public.passages;
create policy "Редактирование текстов" on public.passages for update to authenticated using (public.can_manage_subject(subject_id));
drop policy if exists "Удаление текстов" on public.passages;
create policy "Удаление текстов" on public.passages for delete to authenticated using (public.can_manage_subject(subject_id));

revoke all on public.passages from anon;

-- Сколько готовых текстов (с полным набором из 8 вопросов) в теме: для генератора и бота. security invoker — RLS как при чтении таблиц.
create or replace function public.passage_counts(p_subject_id uuid)
returns table (chapter_id uuid, topic_id uuid, kind text, passages int, questions int)
language sql
stable
security invoker
set search_path = public
as $$
  select p.chapter_id, p.topic_id, p.kind, count(*)::int, sum(c.n)::int
  from public.passages p
  join lateral (
    select count(*)::int as n
    from public.questions q
    where q.passage_id = p.id and q.is_deleted = false
  ) c on c.n >= 8
  where p.subject_id = p_subject_id and p.is_deleted = false
  group by p.chapter_id, p.topic_id, p.kind;
$$;

revoke all on function public.passage_counts(uuid) from public, anon;
grant execute on function public.passage_counts(uuid) to authenticated, service_role;

commit;
