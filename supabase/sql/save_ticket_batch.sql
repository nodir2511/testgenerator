-- Сохранение набора билетов одной транзакцией: партия, билеты и вопросы билетов.
-- Любая ошибка (лимит, права, данные) — откатывается всё, недосозданных наборов не остаётся.
-- Работает с правами вызывающего (RLS действует как при обычной вставке), автор — текущий
-- пользователь; Edge Function с сервисным ключом передаёт автора в p_batch.created_by.
-- Требует supabase/sql/generation_limits.sql. Применено: supabase db query --linked -f supabase/sql/save_ticket_batch.sql
--
-- p_batch:   { title, subject_id, generation_params, created_by? }
-- p_tickets: [ { ticket_number, questions: [ { question_id, order_index, question_snapshot } ] } ]
-- Ответ:     { batch: <партия>, tickets: [ <билет> ] } — билеты в порядке p_tickets

create or replace function public.save_ticket_batch(p_batch jsonb, p_tickets jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  b public.ticket_batches;
  t jsonb;
  tk public.tickets;
  out_tickets jsonb := '[]'::jsonb;
begin
  insert into public.ticket_batches (title, subject_id, created_by, generation_params)
  values (
    coalesce(nullif(trim(p_batch->>'title'), ''), 'Экзаменационные билеты'),
    (p_batch->>'subject_id')::uuid,
    coalesce(auth.uid(), (p_batch->>'created_by')::uuid),
    coalesce(p_batch->'generation_params', '{}'::jsonb)
  )
  returning * into b;

  for t in select value from jsonb_array_elements(coalesce(p_tickets, '[]'::jsonb)) loop
    insert into public.tickets (batch_id, ticket_number)
    values (b.id, (t->>'ticket_number')::int)
    returning * into tk;

    insert into public.ticket_questions (ticket_id, question_id, order_index, question_snapshot)
    select tk.id, nullif(q->>'question_id', '')::uuid, (q->>'order_index')::int, q->'question_snapshot'
    from jsonb_array_elements(coalesce(t->'questions', '[]'::jsonb)) as q;

    out_tickets := out_tickets || jsonb_build_array(to_jsonb(tk));
  end loop;

  return jsonb_build_object('batch', to_jsonb(b), 'tickets', out_tickets);
end;
$$;

revoke all on function public.save_ticket_batch(jsonb, jsonb) from public, anon;
grant execute on function public.save_ticket_batch(jsonb, jsonb) to authenticated, service_role;
