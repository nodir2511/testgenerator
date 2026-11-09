-- Сколько раз вопрос попадал в билеты (по всем пользователям). Подбор билетов берёт
-- реже использованные вопросы чаще (см. pickParallel в supabase/functions/_shared/ticketing.ts).
-- Счётчик ведёт триггер на ticket_questions: вставка +1, удаление набора (в т. ч. каскадом) −1.
-- Отдельная таблица, чтобы не менять questions.updated_at при каждой генерации.
-- Повторный запуск безопасен. Применить: supabase db query --linked -f supabase/sql/question_usage_counter.sql

create table if not exists public.question_usage (
  question_id uuid primary key references public.questions(id) on delete cascade,
  times_used int not null default 0 check (times_used >= 0)
);

alter table public.question_usage enable row level security;
drop policy if exists "Просмотр использования вопросов" on public.question_usage;
create policy "Просмотр использования вопросов" on public.question_usage for select to authenticated using (true);

create or replace function public.question_usage_track()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.question_id is not null then
      insert into public.question_usage (question_id, times_used) values (new.question_id, 1)
      on conflict (question_id) do update set times_used = public.question_usage.times_used + 1;
    end if;
  elsif tg_op = 'DELETE' then
    if old.question_id is not null then
      update public.question_usage set times_used = greatest(times_used - 1, 0) where question_id = old.question_id;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_question_usage on public.ticket_questions;
create trigger trg_question_usage
  after insert or delete on public.ticket_questions
  for each row execute function public.question_usage_track();

-- Пересчёт по уже созданным билетам
insert into public.question_usage (question_id, times_used)
select tq.question_id, count(*)::int
from public.ticket_questions tq
join public.questions q on q.id = tq.question_id
where tq.question_id is not null
group by tq.question_id
on conflict (question_id) do update set times_used = excluded.times_used;
