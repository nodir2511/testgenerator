-- Статистика: кто пользуется, что генерирует, какие темы чаще (только администратор).
-- Считается по журналу generation_usage: наборы, удалённые из «Сохранённых», остаются в статистике.
-- Требует supabase/sql/generation_limits.sql. Применено: supabase db query --linked -f supabase/sql/usage_stats_v2.sql
create or replace function public.admin_usage_stats(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  res jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Только для администратора';
  end if;

  select jsonb_build_object(
    'since', since,
    'totals', (
      select jsonb_build_object(
        'batches', count(*),
        'tickets', coalesce(sum(coalesce((params->>'ticket_count')::int, 0)), 0),
        'users', count(distinct user_id),
        'telegram', count(*) filter (where params->>'source' like 'telegram%')
      ) from public.generation_usage where created_at >= since
    ),
    'users', (
      select coalesce(jsonb_agg(x order by (x->>'batches')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', b.user_id,
          'name', coalesce(nullif(p.full_name, ''), p.email, '—'),
          'email', p.email,
          'batches', count(*),
          'tickets', coalesce(sum(coalesce((b.params->>'ticket_count')::int, 0)), 0),
          'telegram', count(*) filter (where b.params->>'source' like 'telegram%'),
          'last_at', max(b.created_at)
        ) as x
        from public.generation_usage b left join public.profiles p on p.id = b.user_id
        where b.created_at >= since
        group by b.user_id, p.full_name, p.email
      ) q
    ),
    'subjects', (
      select coalesce(jsonb_agg(x order by (x->>'batches')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'name', s.name,
          'batches', count(*),
          'tickets', coalesce(sum(coalesce((b.params->>'ticket_count')::int, 0)), 0),
          'tests', coalesce(sum((b.params->>'test_count')::int * coalesce((b.params->>'ticket_count')::int, 0)), 0),
          'matching', coalesce(sum((b.params->>'matching_count')::int * coalesce((b.params->>'ticket_count')::int, 0)), 0),
          'open', coalesce(sum((b.params->>'open_count')::int * coalesce((b.params->>'ticket_count')::int, 0)), 0)
        ) as x
        from public.generation_usage b join public.subjects s on s.id = b.subject_id
        where b.created_at >= since
        group by s.name
      ) q
    ),
    'topics', (
      select coalesce(jsonb_agg(x order by (x->>'uses')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('name', t.name, 'chapter', c.name, 'uses', count(*)) as x
        from public.generation_usage b
        cross join lateral jsonb_array_elements_text(coalesce(b.params->'topic_ids', '[]'::jsonb)) as tid(id)
        join public.topics t on t.id::text = tid.id
        join public.chapters c on c.id = t.chapter_id
        where b.created_at >= since
        group by t.id, t.name, c.name
        order by count(*) desc
        limit 30
      ) q
    ),
    'chapters', (
      select coalesce(jsonb_agg(x order by (x->>'uses')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('name', c.name, 'uses', count(*)) as x
        from public.generation_usage b
        cross join lateral jsonb_array_elements_text(coalesce(b.params->'chapter_ids', '[]'::jsonb)) as cid(id)
        join public.chapters c on c.id::text = cid.id
        where b.created_at >= since
        group by c.id, c.name
        order by count(*) desc
        limit 30
      ) q
    ),
    'days', (
      select coalesce(jsonb_agg(x order by x->>'day'), '[]'::jsonb) from (
        select jsonb_build_object('day', to_char((b.created_at at time zone 'Asia/Dushanbe')::date, 'YYYY-MM-DD'), 'batches', count(*)) as x
        from public.generation_usage b where b.created_at >= since
        group by (b.created_at at time zone 'Asia/Dushanbe')::date
      ) q
    )
  ) into res;
  return res;
end;
$$;
revoke all on function public.admin_usage_stats(int) from public, anon;
grant execute on function public.admin_usage_stats(int) to authenticated;
