-- Статистика для администратора, версия 3 (admin_usage_stats_v3): всё из v2 и дополнительно
--   prev      — те же итоги за предыдущий период такой же длины (рост/падение),
--   today     — генерации и люди за сегодня (сутки по Душанбе),
--   people    — аккаунты: всего, новых, ни разу не генерировали, привязали Telegram, упирались в дневной лимит,
--   inactive  — кто пользовался раньше, но не в этом периоде,
--   sources   — откуда генерируют (сайт, бот, Mini App, кластер),
--   bank      — банк вопросов по предметам: всего и добавлено за период,
--   authors   — кто добавлял вопросы за период,
--   hours     — в какие часы генерируют,
--   days      — по дням без пропусков (дни без генераций — нули).
-- p_no_admins — не учитывать генерации администраторов (их проверки и тесты искажают картину).
-- Формат прежних полей не меняется. Требует generation_limits.sql.
-- Применить: supabase db query --linked -f supabase/sql/usage_stats_v3.sql

-- Журнал генераций с учётом фильтра «без администраторов». Не security definer, чтобы планировщик
-- подставлял его прямо в запрос; вызывается только из admin_usage_stats_v3 (у пользователей прав нет).
create or replace function public.usage_scope(p_no_admins boolean)
returns setof public.generation_usage
language sql
stable
set search_path = public
as $$
  select g.* from public.generation_usage g
  where not p_no_admins
     or not exists (select 1 from public.profiles p where p.id = g.user_id and p.role = 'admin')
$$;
revoke all on function public.usage_scope(boolean) from public, anon, authenticated;

-- Отдельное имя: прежняя admin_usage_stats(int) остаётся как есть (на ней работает старая версия сайта),
-- а одноимённая функция с двумя параметрами сделала бы вызов по имени неоднозначным.
create or replace function public.admin_usage_stats_v3(p_days int default 30, p_no_admins boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := greatest(coalesce(p_days, 30), 1);
  since timestamptz := now() - make_interval(days => n);
  prev_since timestamptz := now() - make_interval(days => 2 * n);
  day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Dushanbe') at time zone 'Asia/Dushanbe';
  per_day int := coalesce((select s.per_day from public.generation_settings s where s.id), 5);
  res jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Только для администратора';
  end if;

  select jsonb_build_object(
    'since', since,
    'per_day', per_day,
    'totals', (
      select jsonb_build_object(
        'batches', count(*),
        'tickets', coalesce(sum(coalesce((params->>'ticket_count')::int, 0)), 0),
        'users', count(distinct user_id),
        'telegram', count(*) filter (where coalesce(source, params->>'source') like 'telegram%')
      ) from public.usage_scope(p_no_admins) where created_at >= since
    ),
    'prev', (
      select jsonb_build_object(
        'batches', count(*),
        'tickets', coalesce(sum(coalesce((params->>'ticket_count')::int, 0)), 0),
        'users', count(distinct user_id)
      ) from public.usage_scope(p_no_admins) where created_at >= prev_since and created_at < since
    ),
    'today', (
      select jsonb_build_object('batches', count(*), 'users', count(distinct user_id))
      from public.usage_scope(p_no_admins) where created_at >= day_start
    ),
    'people', (
      select jsonb_build_object(
        'total', (select count(*) from public.profiles),
        'new', (select count(*) from public.profiles where created_at >= since),
        'never', (select count(*) from public.profiles p where not exists (select 1 from public.generation_usage g where g.user_id = p.id)),
        'telegram', (select count(distinct user_id) from public.telegram_links),
        -- Сколько раз (человеко-дней) обычные пользователи выбирали весь дневной лимит
        'limit_days', (
          select count(*) from (
            select g.user_id, (g.created_at at time zone 'Asia/Dushanbe')::date
            from public.generation_usage g join public.profiles p on p.id = g.user_id
            where g.created_at >= since and p.role <> 'admin'
            group by 1, 2 having count(*) >= per_day
          ) x
        ),
        'limit_users', (
          select count(distinct user_id) from (
            select g.user_id
            from public.generation_usage g join public.profiles p on p.id = g.user_id
            where g.created_at >= since and p.role <> 'admin'
            group by g.user_id, (g.created_at at time zone 'Asia/Dushanbe')::date having count(*) >= per_day
          ) x
        )
      )
    ),
    'users', (
      select coalesce(jsonb_agg(x order by (x->>'batches')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', b.user_id,
          'name', coalesce(nullif(p.full_name, ''), p.email, '—'),
          'email', p.email,
          'role', p.role,
          'batches', count(*),
          'tickets', coalesce(sum(coalesce((b.params->>'ticket_count')::int, 0)), 0),
          'telegram', count(*) filter (where coalesce(b.source, b.params->>'source') like 'telegram%'),
          'days', count(distinct (b.created_at at time zone 'Asia/Dushanbe')::date),
          'subject', (
            select s.name from public.generation_usage b2 join public.subjects s on s.id = b2.subject_id
            where b2.user_id = b.user_id and b2.created_at >= since
            group by s.name order by count(*) desc limit 1
          ),
          'last_at', max(b.created_at)
        ) as x
        from public.usage_scope(p_no_admins) b left join public.profiles p on p.id = b.user_id
        where b.created_at >= since
        group by b.user_id, p.full_name, p.email, p.role
      ) q
    ),
    'inactive', (
      select coalesce(jsonb_agg(x order by x->>'last_at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', p.id,
          'name', coalesce(nullif(p.full_name, ''), p.email, '—'),
          'email', p.email,
          'last_at', l.last_at
        ) as x
        from public.profiles p
        join lateral (select max(g.created_at) as last_at from public.generation_usage g where g.user_id = p.id) l on true
        where l.last_at < since
        order by l.last_at desc
        limit 50
      ) q
    ),
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object('source', src, 'batches', c) order by c desc), '[]'::jsonb) from (
        select coalesce(source, params->>'source', 'site') as src, count(*) as c
        from public.usage_scope(p_no_admins) where created_at >= since group by 1
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
        from public.usage_scope(p_no_admins) b join public.subjects s on s.id = b.subject_id
        where b.created_at >= since
        group by s.name
      ) q
    ),
    'bank', (
      select coalesce(jsonb_agg(x order by (x->>'total')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'name', s.name,
          'total', count(q.id),
          'added', count(q.id) filter (where q.created_at >= since),
          'test', count(q.id) filter (where q.type = 'test'),
          'matching', count(q.id) filter (where q.type = 'matching'),
          'open', count(q.id) filter (where q.type = 'open')
        ) as x
        from public.subjects s
        left join public.questions q on q.subject_id = s.id and not q.is_deleted
        where not s.is_deleted
        group by s.id, s.name
      ) q
    ),
    'authors', (
      select coalesce(jsonb_agg(x order by (x->>'added')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('name', coalesce(nullif(p.full_name, ''), p.email, '—'), 'added', count(*)) as x
        from public.questions q left join public.profiles p on p.id = q.created_by
        where q.created_at >= since and not q.is_deleted
        group by q.created_by, p.full_name, p.email
        order by count(*) desc
        limit 10
      ) q
    ),
    'topics', (
      select coalesce(jsonb_agg(x order by (x->>'uses')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('name', t.name, 'chapter', c.name, 'uses', count(*)) as x
        from public.usage_scope(p_no_admins) b
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
        from public.usage_scope(p_no_admins) b
        cross join lateral jsonb_array_elements_text(coalesce(b.params->'chapter_ids', '[]'::jsonb)) as cid(id)
        join public.chapters c on c.id::text = cid.id
        where b.created_at >= since
        group by c.id, c.name
        order by count(*) desc
        limit 30
      ) q
    ),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'batches', coalesce(c, 0)) order by h), '[]'::jsonb)
      from generate_series(0, 23) h
      left join (
        select extract(hour from created_at at time zone 'Asia/Dushanbe')::int as hr, count(*) as c
        from public.usage_scope(p_no_admins) where created_at >= since group by 1
      ) g on g.hr = h
    ),
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'), 'batches', coalesce(c, 0), 'users', coalesce(u, 0)) order by d), '[]'::jsonb)
      from generate_series((since at time zone 'Asia/Dushanbe')::date, (now() at time zone 'Asia/Dushanbe')::date, interval '1 day') d
      left join (
        select (created_at at time zone 'Asia/Dushanbe')::date as dd, count(*) as c, count(distinct user_id) as u
        from public.usage_scope(p_no_admins) where created_at >= since group by 1
      ) g on g.dd = d::date
    )
  ) into res;
  return res;
end;
$$;
revoke all on function public.admin_usage_stats_v3(int, boolean) from public, anon;
grant execute on function public.admin_usage_stats_v3(int, boolean) to authenticated;
