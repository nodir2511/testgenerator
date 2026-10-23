-- Счётчики вопросов предмета по главам/темам/видам одним запросом.
-- Используют сайт (генератор билетов), Telegram Mini App (tg-app) и бот: вместо выкачивания всех строк вопросов.
-- security invoker: права и RLS те же, что при прямом чтении таблицы questions.
create or replace function public.question_counts(p_subject_id uuid)
returns table (chapter_id uuid, topic_id uuid, type text, cnt int)
language sql
stable
security invoker
set search_path = public
as $$
  select q.chapter_id, q.topic_id, q.type::text, count(*)::int
  from public.questions q
  where q.subject_id = p_subject_id and q.is_deleted = false
  group by q.chapter_id, q.topic_id, q.type;
$$;

revoke all on function public.question_counts(uuid) from public, anon;
grant execute on function public.question_counts(uuid) to authenticated, service_role;
