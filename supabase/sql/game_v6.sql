-- «Своя игра» 0.10: честный порядок нажатий. Требует game_v5.sql. Повторный запуск безопасен.
-- Применить: supabase db query --linked -f supabase/sql/game_v6.sql
--  * телефон присылает момент нажатия по серверным часам (p_t); очередь строится по нему, а не по порядку прихода пакетов;
--  * время принимается только в окне 2 с до прихода и не раньше начала приёма; иначе берётся время прихода;
--  * нажатие до «СТАРТ» (в том числе во время отсчёта) — фальстарт, даже если пакет дошёл уже после старта;
--  * нажатие на прошлый вопрос (p_seq), пришедшее после открытия нового, отклоняется;
--  * game_net: задержка и погрешность часов каждого телефона — видит только ведущий.

-- Старая сигнатура мешает PostgREST выбрать функцию, поэтому удаляем её
drop function if exists public.game_buzz(text, int, text);

create or replace function public.game_buzz(
  p_code text, p_n int, p_secret text,
  p_t bigint default null, p_seq bigint default null, p_err int default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c text := upper(btrim(p_code));
  s public.game_sessions;
  now_ms bigint := public.game_now_ms();
  t bigint := now_ms;      -- момент нажатия по серверным часам
  tm jsonb;
  q jsonb;
  started bigint;
  old_t bigint;
  entry jsonb;
  nb jsonb;
  pos int;
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
  -- нажатие относилось к прошлому вопросу
  if p_secret is not null and p_seq is not null and (q->>'seq') is not null and (q->>'seq')::bigint <> p_seq then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  -- время нажатия, присланное телефоном: верим только в окне 2 с до прихода; иначе — время прихода
  if p_secret is not null and p_t is not null and p_t <= now_ms and p_t >= now_ms - 2000 then
    t := p_t;
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
  started := coalesce((tm->>'startedAt')::bigint, 0);
  -- приём закончился до момента нажатия (по времени нажатия, а не прихода)
  if t > coalesce((tm->>'endsAt')::bigint, 0) + 400 then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  -- нажали раньше начала приёма (отсчёт «3-2-1» или до старта), даже если пакет дошёл позже. 100 мс — запас на погрешность часов
  if p_secret is not null and t < started - 100 then
    if not public.game_has_n(s.input->'fs', p_n) then
      update public.game_sessions
        set input = jsonb_set(input, '{fs}', coalesce(input->'fs', '[]'::jsonb) || to_jsonb(p_n))
        where code = s.code;
    end if;
    return jsonb_build_object('ok', false, 'reason', 'false_start');
  end if;
  if t < started then t := started; end if;
  if p_secret is not null and public.game_has_n(s.input->'fs', p_n) and t < started + 1500 then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'wait_ms', started + 1500 - t);
  end if;

  -- уже нажимали: оставляем более раннее время (первое нажатие могло дойти позже повторного)
  select (v->>'t')::bigint into old_t from jsonb_array_elements(s.buzz) as e(v) where (v->>'n')::int = p_n limit 1;
  if old_t is not null and old_t <= t then
    select ord into pos from jsonb_array_elements(s.buzz) with ordinality as b(v, ord) where (v->>'n')::int = p_n;
    return jsonb_build_object('ok', true, 'pos', pos);
  end if;

  -- t — время нажатия, a — когда оно дошло до сервера, e — погрешность часов телефона (мс)
  entry := jsonb_build_object('n', p_n, 't', t, 'a', now_ms, 's', q->'seq');
  if p_err is not null then entry := entry || jsonb_build_object('e', least(greatest(p_err, 0), 5000)); end if;
  -- очередь упорядочена по времени нажатия; при равенстве — по приходу
  select coalesce(jsonb_agg(y.v order by (y.v->>'t')::bigint, y.ord), '[]'::jsonb) into nb
  from (
    select x.v, x.ord from jsonb_array_elements(coalesce(s.buzz, '[]'::jsonb)) with ordinality as x(v, ord) where (x.v->>'n')::int <> p_n
    union all
    select entry, 1000000::bigint
  ) y;
  update public.game_sessions set buzz = nb where code = s.code;
  select ord into pos from jsonb_array_elements(nb) with ordinality as b(v, ord) where (v->>'n')::int = p_n;
  return jsonb_build_object('ok', true, 'pos', pos);
end;
$$;

grant execute on function public.game_buzz(text, int, text, bigint, bigint, int) to anon, authenticated;

-- Связь команд: задержка и погрешность часов каждого телефона (для ведущего)
create table if not exists public.game_net (
  code text not null references public.game_sessions(code) on delete cascade,
  n int not null,
  rtt int not null,                  -- задержка лучшей пробы, мс
  err int not null,                  -- погрешность часов, мс
  updated_at timestamptz not null default now(),
  primary key (code, n)
);
alter table public.game_net enable row level security;
revoke all on public.game_net from anon, authenticated;

create or replace function public.game_net_report(p_code text, p_n int, p_secret text, p_rtt int, p_err int) returns void
language plpgsql security definer set search_path = public as $$
declare c text := upper(btrim(p_code));
begin
  if not exists (select 1 from public.game_secrets where code = c and n = p_n and secret = p_secret) then return; end if;
  insert into public.game_net (code, n, rtt, err, updated_at)
  values (c, p_n, least(greatest(coalesce(p_rtt, 0), 0), 60000), least(greatest(coalesce(p_err, 0), 0), 60000), now())
  on conflict (code, n) do update set rtt = excluded.rtt, err = excluded.err, updated_at = now();
end;
$$;

create or replace function public.game_net_get(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c text := upper(btrim(p_code));
begin
  if not public.game_is_host(c) then return '{}'::jsonb; end if;
  return coalesce((
    select jsonb_object_agg(n::text, jsonb_build_object('rtt', rtt, 'err', err, 'age', floor(extract(epoch from (now() - updated_at)))::int))
    from public.game_net where code = c
  ), '{}'::jsonb);
end;
$$;

revoke all on function public.game_net_report(text, int, text, int, int) from public;
revoke all on function public.game_net_get(text) from public;
grant execute on function public.game_net_report(text, int, text, int, int) to anon, authenticated;
grant execute on function public.game_net_get(text) to authenticated;
