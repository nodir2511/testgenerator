-- Занятия по игре «Приём пациента»: учитель создаёт занятие, ординаторы заходят по коду со своих телефонов,
-- баллы приходят на экран учителя. Повторный запуск безопасен.
--
-- Роль game_teacher («Учитель игры»): видит на сайте только раздел «Игры». Банк вопросов ей закрыт:
-- can_view_subject() и политики вопросов пускают только user / admin / роли по предметам, остальным — пусто.
-- Роль назначает главный админ (триггер prevent_role_escalation уже требует is_owner).

begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('user', 'admin', 'subject_teacher', 'subject_admin', 'game_teacher'));

-- Может ли человек вести занятия: учитель игры и админы
create or replace function public.is_clinic_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('game_teacher', 'admin'));
$$;
revoke all on function public.is_clinic_teacher() from public, anon;
grant execute on function public.is_clinic_teacher() to authenticated, service_role;

create table if not exists public.clinic_sessions (
  code text primary key,
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '',
  case_keys text[] not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);
create index if not exists idx_clinic_sessions_host on public.clinic_sessions (host_id, created_at desc);

create table if not exists public.clinic_players (
  code text not null references public.clinic_sessions(code) on delete cascade,
  n int not null,
  name text not null,
  secret text not null,
  results jsonb not null default '{}'::jsonb,   -- {ключ случая: баллы}, засчитывается первое прохождение
  score int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (code, n)
);

-- Прямого доступа к таблицам нет ни у кого: всё идёт через функции ниже
alter table public.clinic_sessions enable row level security;
alter table public.clinic_players enable row level security;
revoke all on public.clinic_sessions, public.clinic_players from anon, authenticated;

-- Создать занятие (учитель) ---------------------------------------------------
create or replace function public.clinic_create(p_title text, p_keys text[]) returns text
language plpgsql security definer set search_path = public as $$
declare
  c text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if not public.is_clinic_teacher() then raise exception 'Нет доступа'; end if;
  if p_keys is null or cardinality(p_keys) = 0 then raise exception 'Выберите хотя бы один случай'; end if;
  if cardinality(p_keys) > 40 then raise exception 'Слишком много случаев'; end if;
  loop
    c := '';
    for i in 1..5 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.clinic_sessions where code = c);
  end loop;
  insert into public.clinic_sessions (code, host_id, title, case_keys)
    values (c, auth.uid(), left(btrim(coalesce(p_title, '')), 80), p_keys);
  return c;
end;
$$;

-- Что видит ординатор до входа: название и число случаев (ключи случаев — только после входа)
create or replace function public.clinic_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title', title, 'count', cardinality(case_keys), 'status', status)
  from public.clinic_sessions where code = upper(btrim(p_code));
$$;

-- Вход ординатора ---------------------------------------------------------------
create or replace function public.clinic_join(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.clinic_sessions;
  nm text := left(btrim(coalesce(p_name, '')), 40);
  k int;
  sec text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into s from public.clinic_sessions where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Занятие не найдено'; end if;
  if s.status <> 'open' then raise exception 'Занятие закончилось'; end if;
  if nm = '' then raise exception 'Введите имя'; end if;
  select coalesce(max(n), 0) + 1 into k from public.clinic_players where code = s.code;
  if k > 80 then raise exception 'В занятии уже 80 участников'; end if;
  insert into public.clinic_players (code, n, name, secret) values (s.code, k, nm, sec);
  return jsonb_build_object('n', k, 'secret', sec, 'name', nm, 'keys', to_jsonb(s.case_keys), 'title', s.title);
end;
$$;

-- Вернуться на занятие (телефон перезагрузили): по номеру и секрету, сохранённому в браузере
create or replace function public.clinic_state(p_code text, p_n int, p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s public.clinic_sessions;
  p public.clinic_players;
begin
  select * into s from public.clinic_sessions where code = upper(btrim(p_code));
  if not found then raise exception 'Занятие не найдено'; end if;
  select * into p from public.clinic_players where code = s.code and n = p_n and secret = p_secret;
  if not found then raise exception 'Вход не подтверждён'; end if;
  return jsonb_build_object('n', p.n, 'name', p.name, 'keys', to_jsonb(s.case_keys), 'title', s.title,
                            'status', s.status, 'results', p.results, 'score', p.score);
end;
$$;

-- Результат случая от ординатора. Засчитывается первое прохождение; позже тот же случай не меняет баллы.
create or replace function public.clinic_report(p_code text, p_n int, p_secret text, p_key text, p_pts int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.clinic_sessions;
  p public.clinic_players;
  pts int := greatest(-300, least(1000, coalesce(p_pts, 0)));
begin
  select * into s from public.clinic_sessions where code = upper(btrim(p_code));
  if not found then raise exception 'Занятие не найдено'; end if;
  if s.status <> 'open' then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if not (p_key = any (s.case_keys)) then raise exception 'Этого случая нет в занятии'; end if;
  select * into p from public.clinic_players where code = s.code and n = p_n and secret = p_secret for update;
  if not found then raise exception 'Вход не подтверждён'; end if;
  if p.results ? p_key then
    return jsonb_build_object('ok', true, 'counted', false, 'score', p.score);
  end if;
  update public.clinic_players
     set results = results || jsonb_build_object(p_key, pts), score = score + pts, updated_at = now()
   where code = s.code and n = p_n
   returning score into p.score;
  return jsonb_build_object('ok', true, 'counted', true, 'score', p.score);
end;
$$;

-- Табло для учителя -------------------------------------------------------------
create or replace function public.clinic_board(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s public.clinic_sessions;
begin
  select * into s from public.clinic_sessions where code = upper(btrim(p_code)) and host_id = auth.uid();
  if not found then raise exception 'Занятие не найдено'; end if;
  return jsonb_build_object(
    'title', s.title, 'status', s.status, 'keys', to_jsonb(s.case_keys),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('n', n, 'name', name, 'score', score, 'done', (select count(*) from jsonb_object_keys(results)), 'results', results)
                       order by score desc, updated_at asc)
      from public.clinic_players where code = s.code
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.clinic_close(p_code text, p_open boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.clinic_sessions set status = case when p_open then 'open' else 'closed' end
   where code = upper(btrim(p_code)) and host_id = auth.uid();
  if not found then raise exception 'Занятие не найдено'; end if;
end;
$$;

-- Мои занятия (последние 30)
create or replace function public.clinic_my_sessions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'created_at') desc), '[]'::jsonb) from (
    select jsonb_build_object('code', s.code, 'title', s.title, 'status', s.status, 'created_at', s.created_at,
             'cases', cardinality(s.case_keys),
             'players', (select count(*) from public.clinic_players p where p.code = s.code)) as x
    from public.clinic_sessions s where s.host_id = auth.uid() order by s.created_at desc limit 30
  ) t;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.clinic_create(text, text[])', 'public.clinic_board(text)',
    'public.clinic_close(text, boolean)', 'public.clinic_my_sessions()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.clinic_info(text)', 'public.clinic_join(text, text)',
    'public.clinic_state(text, int, text)', 'public.clinic_report(text, int, text, text, int)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

commit;
