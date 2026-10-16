-- «Своя игра» 0.9: надёжность. Требует game_v2.sql и game_v4.sql. Повторный запуск безопасен.
-- Применить: supabase db query --linked -f supabase/sql/game_v5.sql
--  * у каждого открытого вопроса свой номер (board.q.seq). Нажатия, «кот», ставки и фальстарты привязаны к нему:
--    остатки прошлого вопроса больше не могут попасть в новый, даже если очистка от ведущего не дошла;
--  * одинаковые названия команд запрещены (чтобы на экране не было двух «1234»).

-- Если действия команд относятся к другому вопросу — начинаем с чистого листа (очередь, «кот», ставки, фальстарты).
create or replace function public.game_sync_seq(p_code text) returns public.game_sessions
language plpgsql security definer set search_path = public as $$
declare
  s public.game_sessions;
  seq jsonb;
begin
  select * into s from public.game_sessions where code = p_code for update;
  if not found then return null; end if;
  seq := s.board->'q'->'seq';
  if seq is not null and (s.input->'seq') is distinct from seq then
    update public.game_sessions set input = jsonb_build_object('seq', seq), buzz = '[]'::jsonb where code = p_code returning * into s;
    delete from public.game_bids where code = p_code;
  end if;
  return s;
end;
$$;
revoke execute on function public.game_sync_seq(text) from public, anon, authenticated;

create or replace function public.game_buzz(p_code text, p_n int, p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c text := upper(btrim(p_code));
  s public.game_sessions;
  now_ms bigint := public.game_now_ms();
  tm jsonb;
  q jsonb;
  pos int;
  started bigint;
begin
  s := public.game_sync_seq(c);
  if s is null then return jsonb_build_object('ok', false, 'reason', 'no_game'); end if;
  if p_secret is null then
    if s.host_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  elsif not exists (select 1 from public.game_secrets where code = s.code and n = p_n and secret = p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  q := s.board->'q';
  tm := s.board->'timer';
  if q is null or jsonb_typeof(q) <> 'object' or coalesce(q->>'mode', 'buzz') <> 'buzz' or q->'won' is not null and q->'won' <> 'null'::jsonb then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if jsonb_typeof(q->'only') = 'array' and not public.game_has_n(q->'only', p_n) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if public.game_has_n(q->'wrong', p_n) then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;
  if coalesce((tm->>'running')::boolean, false) is not true then
    -- нажали до старта таймера — фальстарт (только пока вопрос читают: таймер ещё не запускали)
    if p_secret is not null and coalesce((q->>'shown')::boolean, false) is not true and (tm->>'startedAt') is null then
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
  update public.game_sessions
    set buzz = buzz || jsonb_build_array(jsonb_build_object('n', p_n, 't', now_ms, 's', q->'seq'))
    where code = s.code
    returning jsonb_array_length(buzz) into pos;
  return jsonb_build_object('ok', true, 'pos', pos);
end;
$$;

create or replace function public.game_team_act(p_code text, p_n int, p_secret text, p_kind text, p_value int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c text := upper(btrim(p_code));
  s public.game_sessions;
  q jsonb;
  max_bid int;
begin
  s := public.game_sync_seq(c);
  if s is null then return jsonb_build_object('ok', false, 'reason', 'no_game'); end if;
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

-- Ставки только текущего вопроса
create or replace function public.game_bids_get(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.game_sessions;
begin
  if not public.game_is_host(p_code) then raise exception 'Нет доступа'; end if;
  s := public.game_sync_seq(p_code);
  return coalesce((select jsonb_agg(jsonb_build_object('n', n, 'amount', amount, 't', t) order by amount desc, t asc)
    from public.game_bids where code = p_code), '[]'::jsonb);
end;
$$;

-- Вход: закрытый вход (game_v4) + запрет одинаковых названий
create or replace function public.game_join(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.game_sessions;
  free int;
  nm text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 24);
  sec text := replace(gen_random_uuid()::text, '-', '');
  pn text := lpad(floor(random() * 10000)::int::text, 4, '0');
begin
  select * into s from public.game_sessions where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Игра не найдена'; end if;
  if coalesce((s.board->>'joinClosed')::boolean, false) then
    raise exception 'Ведущий закрыл вход в игру. Если вы уже были в игре, нажмите «Вернуться в игру» и введите код команды.';
  end if;
  select min(g) into free from generate_series(1, 6) g
    where not exists (select 1 from jsonb_array_elements(s.teams) t where (t->>'n')::int = g);
  if free is null then raise exception 'Все 6 мест заняты'; end if;
  if nm = '' then nm := 'Команда ' || free; end if;
  if exists (select 1 from jsonb_array_elements(s.teams) t where lower(t->>'name') = lower(nm)) then
    raise exception 'Команда «%» уже есть. Придумайте другое название или нажмите «Вернуться в игру».', nm;
  end if;
  update public.game_sessions set teams = teams || jsonb_build_array(jsonb_build_object('n', free, 'name', nm)) where code = s.code;
  insert into public.game_secrets (code, n, secret, pin) values (s.code, free, sec, pn)
    on conflict (code, n) do update set secret = excluded.secret, pin = excluded.pin, fails = 0, last_fail = null;
  return jsonb_build_object('n', free, 'secret', sec, 'name', nm, 'pin', pn);
end;
$$;
