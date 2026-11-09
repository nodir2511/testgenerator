-- Раздел «Подборы» (только главный админ): как вопросы банка попадают в билеты.
-- owner_question_usage(предмет, период) возвращает:
--   totals — вопросов в банке, из них использованных, всего попаданий в билеты;
--   topics — по каждой теме: вопросов, использованных, попаданий, когда в последний раз;
--   top    — самые частые вопросы;
--   unused — вопросы, которые не попадали в билеты ни разу (первые 150, самые старые сверху).
-- p_days = null — за всё время. Считаются все билеты, включая кластер.
-- Требует public.is_owner(). Применить: supabase db query --linked -f supabase/sql/question_usage.sql
create or replace function public.owner_question_usage(p_subject_id uuid, p_days int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  since timestamptz := case when p_days is null then null else now() - make_interval(days => p_days) end;
  res jsonb;
begin
  if not public.is_owner() then
    raise exception 'Только для главного администратора';
  end if;

  with u as (
    select tq.question_id as qid, count(*)::int as uses, max(tq.created_at) as last_at
    from public.ticket_questions tq
    join public.questions q on q.id = tq.question_id
    where q.subject_id = p_subject_id and (since is null or tq.created_at >= since)
    group by tq.question_id
  ), base as (
    select q.id, q.type, q.created_at,
           left(regexp_replace(q.content, '\s+', ' ', 'g'), 160) as txt,
           c.id as cid, c.name as cname, c.order_index as corder,
           t.id as tid, t.name as tname, t.order_index as torder,
           coalesce(u.uses, 0) as uses, u.last_at
    from public.questions q
    join public.chapters c on c.id = q.chapter_id
    join public.topics t on t.id = q.topic_id
    left join u on u.qid = q.id
    where q.subject_id = p_subject_id and not q.is_deleted
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'questions', count(*), 'used', count(*) filter (where uses > 0), 'uses', coalesce(sum(uses), 0)) from base),
    'topics', coalesce((select jsonb_agg(to_jsonb(x) order by x.corder, x.torder) from (
        select cid as chapter_id, cname as chapter, corder, tid as topic_id, tname as topic, torder,
               count(*) as total, count(*) filter (where uses > 0) as used,
               coalesce(sum(uses), 0) as uses, max(last_at) as last_at
        from base group by cid, cname, corder, tid, tname, torder) x), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(to_jsonb(x) order by x.uses desc) from (
        select id, type, txt, cname as chapter, tname as topic, uses from base
        where uses > 0 order by uses desc, id limit 30) x), '[]'::jsonb),
    'unused', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
        select id, type, txt, cname as chapter, tname as topic, created_at from base
        where uses = 0 order by created_at, id limit 150) x), '[]'::jsonb)
  ) into res;

  return res;
end;
$$;

revoke all on function public.owner_question_usage(uuid, int) from public, anon;
grant execute on function public.owner_question_usage(uuid, int) to authenticated;
