-- Защита от двойной генерации и статистика использования (для администратора).
-- Применено через: supabase db query --linked -f supabase/sql/usage_limits_stats.sql

-- Блокировка «одна генерация на пользователя»: Edge Function берёт её на время работы
create table if not exists public.generation_locks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  locked_at timestamptz not null default now()
);
alter table public.generation_locks enable row level security;

create or replace function public.acquire_generation_lock(p_user uuid, p_ttl_seconds int default 180)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  got uuid;
begin
  insert into public.generation_locks (user_id, locked_at) values (p_user, now())
  on conflict (user_id) do update set locked_at = now()
    where public.generation_locks.locked_at < now() - make_interval(secs => p_ttl_seconds)
  returning user_id into got;
  return got is not null;
end;
$$;
revoke all on function public.acquire_generation_lock(uuid, int) from public, anon, authenticated;

-- Статистика: кто пользуется, что генерирует, какие темы чаще (только администратор)
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
        'tickets', coalesce(sum((generation_params->>'ticket_count')::int), 0),
        'users', count(distinct created_by),
        'telegram', count(*) filter (where generation_params->>'source' like 'telegram%')
      ) from public.ticket_batches where created_at >= since
    ),
    'users', (
      select coalesce(jsonb_agg(x order by (x->>'batches')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', b.created_by,
          'name', coalesce(nullif(p.full_name, ''), p.email, '—'),
          'email', p.email,
          'batches', count(*),
          'tickets', coalesce(sum((b.generation_params->>'ticket_count')::int), 0),
          'telegram', count(*) filter (where b.generation_params->>'source' like 'telegram%'),
          'last_at', max(b.created_at)
        ) as x
        from public.ticket_batches b left join public.profiles p on p.id = b.created_by
        where b.created_at >= since
        group by b.created_by, p.full_name, p.email
      ) q
    ),
    'subjects', (
      select coalesce(jsonb_agg(x order by (x->>'batches')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'name', s.name,
          'batches', count(*),
          'tickets', coalesce(sum((b.generation_params->>'ticket_count')::int), 0),
          'tests', coalesce(sum((b.generation_params->>'test_count')::int * (b.generation_params->>'ticket_count')::int), 0),
          'matching', coalesce(sum((b.generation_params->>'matching_count')::int * (b.generation_params->>'ticket_count')::int), 0),
          'open', coalesce(sum((b.generation_params->>'open_count')::int * (b.generation_params->>'ticket_count')::int), 0)
        ) as x
        from public.ticket_batches b join public.subjects s on s.id = b.subject_id
        where b.created_at >= since
        group by s.name
      ) q
    ),
    'topics', (
      select coalesce(jsonb_agg(x order by (x->>'uses')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('name', t.name, 'chapter', c.name, 'uses', count(*)) as x
        from public.ticket_batches b
        cross join lateral jsonb_array_elements_text(coalesce(b.generation_params->'topic_ids', '[]'::jsonb)) as tid(id)
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
        from public.ticket_batches b
        cross join lateral jsonb_array_elements_text(coalesce(b.generation_params->'chapter_ids', '[]'::jsonb)) as cid(id)
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
        from public.ticket_batches b where b.created_at >= since
        group by (b.created_at at time zone 'Asia/Dushanbe')::date
      ) q
    )
  ) into res;
  return res;
end;
$$;
revoke all on function public.admin_usage_stats(int) from public, anon;
grant execute on function public.admin_usage_stats(int) to authenticated;
