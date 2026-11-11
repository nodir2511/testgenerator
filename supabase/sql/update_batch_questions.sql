-- Замена вопросов в уже созданном наборе билетов (сайт: кнопка «Заменить» и «Убрать тему»).
-- 1) Счётчик использования question_usage теперь учитывает и замену вопроса в билете (UPDATE):
--    у старого вопроса −1, у нового +1.
-- 2) update_batch_questions — одна транзакция: меняет question_id и question_snapshot у перечисленных
--    вопросов билетов и (если передано) обновляет generation_params набора, чтобы архив знал текущие темы.
--    «Пустое место» (вопроса не нашлось) хранится как question_id = null и снимок { empty: true, type, ... }.
-- Менять набор может его автор или главный админ. Партии экзамена-кластера менять нельзя.
-- Требует question_usage_counter.sql. Повторный запуск безопасен.
-- Применить: supabase db query --linked -f supabase/sql/update_batch_questions.sql

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
  elsif tg_op = 'UPDATE' then
    if old.question_id is distinct from new.question_id then
      if old.question_id is not null then
        update public.question_usage set times_used = greatest(times_used - 1, 0) where question_id = old.question_id;
      end if;
      if new.question_id is not null then
        insert into public.question_usage (question_id, times_used) values (new.question_id, 1)
        on conflict (question_id) do update set times_used = public.question_usage.times_used + 1;
      end if;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_question_usage on public.ticket_questions;
create trigger trg_question_usage
  after insert or delete or update of question_id on public.ticket_questions
  for each row execute function public.question_usage_track();

-- p_changes: [ { ticket_question_id, question_id (или null — пустое место), question_snapshot } ]
-- p_params:  новые generation_params набора (необязательно)
create or replace function public.update_batch_questions(p_batch_id uuid, p_changes jsonb, p_params jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.ticket_batches;
  c jsonb;
  n int := 0;
  cnt int;
begin
  select * into b from public.ticket_batches where id = p_batch_id;
  if not found then raise exception 'Набор билетов не найден'; end if;
  if b.created_by is distinct from auth.uid() and not public.is_owner() then
    raise exception 'Менять набор может только его автор';
  end if;
  if public.is_cluster_batch(b.generation_params) then
    raise exception 'Партии экзамена-кластера менять нельзя';
  end if;

  for c in select value from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    update public.ticket_questions tq
       set question_id = nullif(c->>'question_id', '')::uuid,
           question_snapshot = c->'question_snapshot'
     where tq.id = (c->>'ticket_question_id')::uuid
       and tq.ticket_id in (select t.id from public.tickets t where t.batch_id = p_batch_id);
    get diagnostics cnt = row_count;
    if cnt = 0 then raise exception 'Вопрос билета не найден в этом наборе'; end if;
    n := n + 1;
  end loop;

  if p_params is not null then
    update public.ticket_batches set generation_params = p_params where id = p_batch_id;
  end if;

  return jsonb_build_object('updated', n);
end;
$$;

revoke all on function public.update_batch_questions(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_batch_questions(uuid, jsonb, jsonb) to authenticated;
