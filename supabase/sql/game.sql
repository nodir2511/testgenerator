-- «Своя игра»: ведущий (админ) + команды по ссылке + проектор. Применить: supabase db query --linked -f supabase/sql/game.sql
-- Состояние игры живёт в одной строке game_sessions; её меняет только ведущий (RLS), команды — через функции.
-- Кто быстрее, решает сервер: порядок нажатий определяется очередью buzz (время — серверное).

create table if not exists public.game_sessions (
  code text primary key,
  host_id uuid not null references auth.users(id) on delete cascade,
  teams jsonb not null default '[]'::jsonb,   -- [{n, name}] — меняется только функциями
  board jsonb not null default '{}'::jsonb,   -- табло, счёт, вопрос, таймер — пишет ведущий
  buzz jsonb not null default '[]'::jsonb,    -- очередь нажатий [{n, t}], t — серверное время, мс
  created_at timestamptz not null default now()
);
create index if not exists game_sessions_host_idx on public.game_sessions (host_id, created_at desc);

-- Секреты команд: к таблице нет доступа ни у кого, кроме функций ниже
create table if not exists public.game_secrets (
  code text not null references public.game_sessions(code) on delete cascade,
  n int not null,
  secret text not null,
  primary key (code, n)
);
alter table public.game_secrets enable row level security;
revoke all on public.game_secrets from anon, authenticated;

alter table public.game_sessions enable row level security;
drop policy if exists game_sessions_read on public.game_sessions;
create policy game_sessions_read on public.game_sessions for select to anon, authenticated using (true);
drop policy if exists game_sessions_host_update on public.game_sessions;
create policy game_sessions_host_update on public.game_sessions for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());
-- ведущий напрямую меняет только board; teams, buzz и host_id — только через функции
revoke insert, update, delete on public.game_sessions from anon, authenticated;
grant update (board) on public.game_sessions to authenticated;

-- realtime: подписка клиентов на изменения строки
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_sessions') then
    alter publication supabase_realtime add table public.game_sessions;
  end if;
end $$;

create or replace function public.game_now_ms() returns bigint
language sql stable as $$ select floor(extract(epoch from clock_timestamp()) * 1000)::bigint $$;

create or replace function public.game_is_host(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_sessions where code = p_code and host_id = auth.uid())
$$;

-- Серверное время (мс) — клиенты синхронизируют по нему таймер
create or replace function public.game_time() returns bigint
language sql stable security definer set search_path = public as $$ select public.game_now_ms() $$;

-- Создать игру: только админы. Игры старше 2 суток удаляются.
create or replace function public.game_create() returns text
language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
  i int;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_owner()) then
    raise exception 'Игру может вести только администратор';
  end if;
  delete from public.game_sessions where created_at < now() - interval '2 days';
  loop
    c := '';
    for i in 1..5 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.game_sessions where code = c);
  end loop;
  insert into public.game_sessions (code, host_id) values (c, auth.uid());
  return c;
end;
$$;

-- Команда заходит по ссылке: получает номер и секрет (хранится у неё в браузере)
create or replace function public.game_join(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.game_sessions;
  free int;
  nm text := left(btrim(coalesce(p_name, '')), 24);
  sec text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into s from public.game_sessions where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Игра не найдена'; end if;
  select min(g) into free from generate_series(1, 6) g
    where not exists (select 1 from jsonb_array_elements(s.teams) t where (t->>'n')::int = g);
  if free is null then raise exception 'Все 6 мест заняты'; end if;
  if nm = '' then nm := 'Команда ' || free; end if;
  update public.game_sessions set teams = teams || jsonb_build_array(jsonb_build_object('n', free, 'name', nm)) where code = s.code;
  insert into public.game_secrets (code, n, secret) values (s.code, free, sec)
    on conflict (code, n) do update set secret = excluded.secret;
  return jsonb_build_object('n', free, 'secret', sec, 'name', nm);
end;
$$;

-- Нажатие «Ответить». Команда: p_secret обязателен. Ведущий может нажать за команду (клавиши 1–6): p_secret = null.
create or replace function public.game_buzz(p_code text, p_n int, p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.game_sessions;
  now_ms bigint := public.game_now_ms();
  tm jsonb;
  pos int;
begin
  select * into s from public.game_sessions where code = upper(btrim(p_code)) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_game'); end if;
  if p_secret is null then
    if s.host_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  elsif not exists (select 1 from public.game_secrets where code = s.code and n = p_n and secret = p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  tm := s.board->'timer';
  if s.board->'q' is null or s.board->'q' = 'null'::jsonb or coalesce((tm->>'running')::boolean, false) is not true
     or now_ms > coalesce((tm->>'endsAt')::bigint, 0) + 400 then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(s.board->'q'->'wrong', '[]'::jsonb)) w where w::text::int = p_n) then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;
  select ord into pos from jsonb_array_elements(s.buzz) with ordinality as b(v, ord) where (v->>'n')::int = p_n;
  if pos is not null then return jsonb_build_object('ok', true, 'pos', pos); end if;
  update public.game_sessions set buzz = buzz || jsonb_build_array(jsonb_build_object('n', p_n, 't', now_ms)) where code = s.code
    returning jsonb_array_length(buzz) into pos;
  return jsonb_build_object('ok', true, 'pos', pos);
end;
$$;

-- Убрать команду из очереди нажатий (после неверного ответа)
create or replace function public.game_buzz_drop(p_code text, p_n int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.game_is_host(p_code) then raise exception 'Нет доступа'; end if;
  update public.game_sessions
    set buzz = coalesce((select jsonb_agg(v order by ord) from jsonb_array_elements(buzz) with ordinality as b(v, ord) where (v->>'n')::int <> p_n), '[]'::jsonb)
    where code = p_code;
end;
$$;

-- Очистить очередь (новый вопрос)
create or replace function public.game_buzz_clear(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.game_is_host(p_code) then raise exception 'Нет доступа'; end if;
  update public.game_sessions set buzz = '[]'::jsonb where code = p_code;
end;
$$;

create or replace function public.game_rename(p_code text, p_n int, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text := left(btrim(coalesce(p_name, '')), 24);
begin
  if not public.game_is_host(p_code) then raise exception 'Нет доступа'; end if;
  if nm = '' then nm := 'Команда ' || p_n; end if;
  update public.game_sessions set teams = coalesce((
    select jsonb_agg(case when (t->>'n')::int = p_n then jsonb_set(t, '{name}', to_jsonb(nm)) else t end order by ord)
    from jsonb_array_elements(teams) with ordinality as x(t, ord)), '[]'::jsonb)
  where code = p_code;
end;
$$;

create or replace function public.game_remove_team(p_code text, p_n int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.game_is_host(p_code) then raise exception 'Нет доступа'; end if;
  delete from public.game_secrets where code = p_code and n = p_n;
  update public.game_sessions set
    teams = coalesce((select jsonb_agg(t order by ord) from jsonb_array_elements(teams) with ordinality as x(t, ord) where (t->>'n')::int <> p_n), '[]'::jsonb),
    buzz = coalesce((select jsonb_agg(v order by ord) from jsonb_array_elements(buzz) with ordinality as b(v, ord) where (v->>'n')::int <> p_n), '[]'::jsonb)
  where code = p_code;
end;
$$;

grant execute on function public.game_time() to anon, authenticated;
grant execute on function public.game_join(text, text) to anon, authenticated;
grant execute on function public.game_buzz(text, int, text) to anon, authenticated;
grant execute on function public.game_create() to authenticated;
grant execute on function public.game_buzz_drop(text, int) to authenticated;
grant execute on function public.game_buzz_clear(text) to authenticated;
grant execute on function public.game_rename(text, int, text) to authenticated;
grant execute on function public.game_remove_team(text, int) to authenticated;
revoke execute on function public.game_is_host(text) from public, anon, authenticated;
revoke execute on function public.game_now_ms() from public, anon, authenticated;
