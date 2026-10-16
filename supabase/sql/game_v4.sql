-- «Своя игра» 0.8: ведущий может закрыть вход (защита от фальшивых команд). Требует game_v2.sql. Повторный запуск безопасен.
-- Применить: supabase db query --linked -f supabase/sql/game_v4.sql
-- Закрыть вход можно кнопкой на пульте ведущего; вернуться в игру по коду команды при этом по-прежнему можно (game_rejoin).

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
  if coalesce((s.board->>'joinClosed')::boolean, false) then
    raise exception 'Ведущий закрыл вход в игру. Если вы уже были в игре, нажмите «Вернуться в игру» и введите код команды.';
  end if;
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
