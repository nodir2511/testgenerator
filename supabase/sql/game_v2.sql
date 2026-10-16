-- «Своя игра», часть 2. Требует supabase/sql/game.sql. Повторный запуск безопасен.
-- Применить: supabase db query --linked -f supabase/sql/game_v2.sql
--  * вопросы и ответы хранятся в базе (game_packs) и видны только админам — на страницах команд и проектора их нет;
--  * «Кот в мешке» и «Аукцион» решают сами команды: передача вопроса и тайные ставки;
--  * фальстарт: нажатие до старта таймера блокирует команду на 1,5 с после старта;
--  * история игр (game_results).

-- Пакеты вопросов: только для админов
create table if not exists public.game_packs (
  id text primary key,
  title text not null,
  content jsonb not null,           -- {rounds: [{id, tab, tabt, sub, subt, cats: [{name, nt, qs: [{v, q, qt, a, at, tag?}]}]}]}
  updated_at timestamptz not null default now()
);
alter table public.game_packs enable row level security;
drop policy if exists game_packs_read on public.game_packs;
create policy game_packs_read on public.game_packs for select to authenticated using (public.is_admin() or public.is_owner());
revoke insert, update, delete on public.game_packs from anon, authenticated;
revoke all on public.game_packs from anon;

-- Что сделали команды: кому передан «кот», кто уже поставил, фальстарты. Сами ставки — в game_bids (скрыты).
alter table public.game_sessions add column if not exists input jsonb not null default '{}'::jsonb;

create table if not exists public.game_bids (
  code text not null references public.game_sessions(code) on delete cascade,
  n int not null,
  amount int not null,
  t bigint not null,
  primary key (code, n)
);
alter table public.game_bids enable row level security;
revoke all on public.game_bids from anon, authenticated;

-- История игр
create table if not exists public.game_results (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null,
  session_started timestamptz not null,
  round text not null,
  title text,
  teams jsonb not null,             -- [{name, score, place}]
  finished_at timestamptz not null default now(),
  unique (code, session_started, round)
);
alter table public.game_results enable row level security;
drop policy if exists game_results_read on public.game_results;
create policy game_results_read on public.game_results for select to authenticated using (host_id = auth.uid() or public.is_owner());
drop policy if exists game_results_insert on public.game_results;
create policy game_results_insert on public.game_results for insert to authenticated
  with check (host_id = auth.uid() and (public.is_admin() or public.is_owner()));
drop policy if exists game_results_update on public.game_results;
create policy game_results_update on public.game_results for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());
drop policy if exists game_results_delete on public.game_results;
create policy game_results_delete on public.game_results for delete to authenticated using (host_id = auth.uid());
revoke all on public.game_results from anon;

create or replace function public.game_has_n(arr jsonb, p_n int) returns boolean
language sql immutable as $$
  select exists (select 1 from jsonb_array_elements(coalesce(arr, '[]'::jsonb)) x where jsonb_typeof(x) = 'number' and x::text::int = p_n)
$$;

-- Нажатие «Ответить» (см. game.sql), теперь с режимами вопроса, участниками доп. вопроса и фальстартом
create or replace function public.game_buzz(p_code text, p_n int, p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.game_sessions;
  now_ms bigint := public.game_now_ms();
  tm jsonb;
  q jsonb;
  pos int;
  started bigint;
begin
  select * into s from public.game_sessions where code = upper(btrim(p_code)) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_game'); end if;
  if p_secret is null then
    if s.host_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  elsif not exists (select 1 from public.game_secrets where code = s.code and n = p_n and secret = p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  q := s.board->'q';
  tm := s.board->'timer';
  if q is null or jsonb_typeof(q) <> 'object' or coalesce(q->>'mode', 'buzz') <> 'buzz' then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if jsonb_typeof(q->'only') = 'array' and not public.game_has_n(q->'only', p_n) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if public.game_has_n(q->'wrong', p_n) then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;
  if coalesce((tm->>'running')::boolean, false) is not true then
    -- нажали до старта таймера — фальстарт
    if p_secret is not null and coalesce((q->>'shown')::boolean, false) is not true then
      if not public.game_has_n(s.input->'fs', p_n) then
        update public.game_sessions
          set input = jsonb_set(input, '{fs}', coalesce(input->'fs', '[]'::jsonb) || to_jsonb(p_n))
          where code = s.code;
      end if;
      return jsonb_build_object('ok', false, 'reason', 'false_start');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if now_ms > coalesce((tm->>'endsAt')::bigint, 0) + 400 then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  started := coalesce((tm->>'startedAt')::bigint, 0);
  if p_secret is not null and public.game_has_n(s.input->'fs', p_n) and now_ms < started + 1500 then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'wait_ms', started + 1500 - now_ms);
  end if;
  select ord into pos from jsonb_array_elements(s.buzz) with ordinality as b(v, ord) where (v->>'n')::int = p_n;
  if pos is not null then return jsonb_build_object('ok', true, 'pos', pos); end if;
  update public.game_sessions set buzz = buzz || jsonb_build_array(jsonb_build_object('n', p_n, 't', now_ms)) where code = s.code
    returning jsonb_array_length(buzz) into pos;
  return jsonb_build_object('ok', true, 'pos', pos);
end;
$$;

-- Действия команды на особых вопросах: 'cat' — кому передать вопрос, 'bid' — ставка на аукционе
create or replace function public.game_team_act(p_code text, p_n int, p_secret text, p_kind text, p_value int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.game_sessions;
  q jsonb;
  max_bid int;
begin
  select * into s from public.game_sessions where code = upper(btrim(p_code)) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_game'); end if;
  if not exists (select 1 from public.game_secrets where code = s.code and n = p_n and secret = p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  q := s.board->'q';
  if q is null or jsonb_typeof(q) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;

  if p_kind = 'cat' then
    if q->>'mode' <> 'cat' or (q->>'chooser')::int is distinct from p_n then
      return jsonb_build_object('ok', false, 'reason', 'closed');
    end if;
    if p_value = p_n or not exists (select 1 from jsonb_array_elements(s.teams) t where (t->>'n')::int = p_value) then
      return jsonb_build_object('ok', false, 'reason', 'bad_team');
    end if;
    if s.input ? 'cat' then return jsonb_build_object('ok', true); end if;
    update public.game_sessions set input = input || jsonb_build_object('cat', p_value) where code = s.code;
    return jsonb_build_object('ok', true);
  elsif p_kind = 'bid' then
    if q->>'mode' <> 'bids' then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
    max_bid := greatest(coalesce((s.board->'scores'->>p_n::text)::int, 0), coalesce((q->>'v')::int, 0));
    if p_value is null or p_value < 0 or p_value > max_bid then
      return jsonb_build_object('ok', false, 'reason', 'too_much', 'max', max_bid);
    end if;
    insert into public.game_bids (code, n, amount, t) values (s.code, p_n, p_value, public.game_now_ms())
      on conflict (code, n) do update set amount = excluded.amount, t = excluded.t;
    if not public.game_has_n(s.input->'bidders', p_n) then
      update public.game_sessions
        set input = jsonb_set(input, '{bidders}', coalesce(input->'bidders', '[]'::jsonb) || to_jsonb(p_n))
        where code = s.code;
    end if;
    return jsonb_build_object('ok', true, 'amount', p_value);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'bad_kind');
end;
$$;

-- Ставки аукциона (только ведущему): от большей к меньшей, при равенстве — кто раньше
create or replace function public.game_bids_get(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.game_is_host(p_code) then raise exception 'Нет доступа'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('n', n, 'amount', amount, 't', t) order by amount desc, t asc)
    from public.game_bids where code = p_code), '[]'::jsonb);
end;
$$;

-- Новый вопрос: очищаем очередь, действия команд и ставки
create or replace function public.game_buzz_clear(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.game_is_host(p_code) then raise exception 'Нет доступа'; end if;
  update public.game_sessions set buzz = '[]'::jsonb, input = '{}'::jsonb where code = p_code;
  delete from public.game_bids where code = p_code;
end;
$$;

create or replace function public.game_remove_team(p_code text, p_n int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.game_is_host(p_code) then raise exception 'Нет доступа'; end if;
  delete from public.game_secrets where code = p_code and n = p_n;
  delete from public.game_bids where code = p_code and n = p_n;
  update public.game_sessions set
    teams = coalesce((select jsonb_agg(t order by ord) from jsonb_array_elements(teams) with ordinality as x(t, ord) where (t->>'n')::int <> p_n), '[]'::jsonb),
    buzz = coalesce((select jsonb_agg(v order by ord) from jsonb_array_elements(buzz) with ordinality as b(v, ord) where (v->>'n')::int <> p_n), '[]'::jsonb)
  where code = p_code;
end;
$$;

grant execute on function public.game_team_act(text, int, text, text, int) to anon, authenticated;
grant execute on function public.game_bids_get(text) to authenticated;
grant execute on function public.game_has_n(jsonb, int) to anon, authenticated;

-- Возврат в игру: у каждой команды есть 4-значный код команды (видит сама команда и ведущий).
-- Вышли из игры или сменили телефон — выбирают своё название и вводят код; старое устройство отключается.
alter table public.game_secrets add column if not exists pin text;
alter table public.game_secrets add column if not exists fails int not null default 0;
alter table public.game_secrets add column if not exists last_fail timestamptz;
update public.game_secrets set pin = lpad(floor(random() * 10000)::int::text, 4, '0') where pin is null;

create or replace function public.game_join(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.game_sessions;
  free int;
  nm text := left(btrim(coalesce(p_name, '')), 24);
  sec text := replace(gen_random_uuid()::text, '-', '');
  pn text := lpad(floor(random() * 10000)::int::text, 4, '0');
begin
  select * into s from public.game_sessions where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Игра не найдена'; end if;
  select min(g) into free from generate_series(1, 6) g
    where not exists (select 1 from jsonb_array_elements(s.teams) t where (t->>'n')::int = g);
  if free is null then raise exception 'Все 6 мест заняты'; end if;
  if nm = '' then nm := 'Команда ' || free; end if;
  update public.game_sessions set teams = teams || jsonb_build_array(jsonb_build_object('n', free, 'name', nm)) where code = s.code;
  insert into public.game_secrets (code, n, secret, pin) values (s.code, free, sec, pn)
    on conflict (code, n) do update set secret = excluded.secret, pin = excluded.pin, fails = 0, last_fail = null;
  return jsonb_build_object('n', free, 'secret', sec, 'name', nm, 'pin', pn);
end;
$$;

-- Вернуться в игру по коду команды. 10 неверных попыток — пауза 5 минут.
create or replace function public.game_rejoin(p_code text, p_n int, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c text := upper(btrim(p_code));
  g public.game_secrets;
  sec text := replace(gen_random_uuid()::text, '-', '');
  nm text;
begin
  select * into g from public.game_secrets where code = c and n = p_n for update;
  if not found then raise exception 'Команда не найдена'; end if;
  if g.fails >= 10 and g.last_fail > now() - interval '5 minutes' then
    raise exception 'Слишком много попыток. Подождите 5 минут или спросите код у ведущего';
  end if;
  if g.pin is distinct from btrim(coalesce(p_pin, '')) then
    update public.game_secrets
      set fails = case when last_fail < now() - interval '5 minutes' then 1 else fails + 1 end, last_fail = now()
      where code = c and n = p_n;
    return jsonb_build_object('ok', false, 'reason', 'bad_pin');
  end if;
  update public.game_secrets set secret = sec, fails = 0, last_fail = null where code = c and n = p_n;
  select t->>'name' into nm from public.game_sessions s, jsonb_array_elements(s.teams) t where s.code = c and (t->>'n')::int = p_n;
  return jsonb_build_object('ok', true, 'n', p_n, 'secret', sec, 'name', nm, 'pin', g.pin);
end;
$$;

-- Проверка, что устройство всё ещё в игре (после возврата с другого телефона старое отключается)
create or replace function public.game_check(p_code text, p_n int, p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_secrets where code = upper(btrim(p_code)) and n = p_n and secret = p_secret)
$$;

-- Коды команд — только ведущему
create or replace function public.game_team_pins(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.game_is_host(p_code) then raise exception 'Нет доступа'; end if;
  return coalesce((select jsonb_object_agg(n::text, pin) from public.game_secrets where code = p_code), '{}'::jsonb);
end;
$$;

grant execute on function public.game_rejoin(text, int, text) to anon, authenticated;
grant execute on function public.game_check(text, int, text) to anon, authenticated;
grant execute on function public.game_team_pins(text) to authenticated;
