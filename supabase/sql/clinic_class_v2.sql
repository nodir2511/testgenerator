-- Занятия «Приём пациента», версия 2: ординатор видит своё место среди всех участников занятия.
-- Чужие имена и баллы не отдаются: только место, число участников и свои баллы. Повторный запуск безопасен.
-- Применить: supabase db query --linked --yes -f supabase/sql/clinic_class_v2.sql (до выкладки сайта).

create or replace function public.clinic_standing(p_code text, p_n int, p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c text := upper(btrim(p_code));
  me public.clinic_players;
begin
  select * into me from public.clinic_players where code = c and n = p_n and secret = p_secret;
  if not found then raise exception 'Вход не подтверждён'; end if;
  return jsonb_build_object(
    'place', 1 + (select count(*) from public.clinic_players p where p.code = c and p.score > me.score),
    'total', (select count(*) from public.clinic_players p where p.code = c),
    'score', me.score,
    'status', (select status from public.clinic_sessions where code = c)
  );
end;
$$;

revoke all on function public.clinic_standing(text, int, text) from public;
grant execute on function public.clinic_standing(text, int, text) to anon, authenticated;

-- Режимы игры, доступные на занятии: norm — «Обычный» (с подсказками), hard — «Хардкор».
-- Учитель выбирает их заранее, ординатор выбирает один из доступных (если режим один — он выбран сам).
alter table public.clinic_sessions add column if not exists modes text[] not null default array['norm', 'hard'];
alter table public.clinic_sessions drop constraint if exists clinic_sessions_modes_check;
alter table public.clinic_sessions add constraint clinic_sessions_modes_check
  check (cardinality(modes) between 1 and 2 and modes <@ array['norm', 'hard']);

drop function if exists public.clinic_create(text, text[]);
create or replace function public.clinic_create(p_title text, p_keys text[], p_modes text[] default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  c text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
  md text[] := coalesce(p_modes, array['norm', 'hard']);
begin
  if not public.is_clinic_teacher() then raise exception 'Нет доступа'; end if;
  if p_keys is null or cardinality(p_keys) = 0 then raise exception 'Выберите хотя бы один случай'; end if;
  if cardinality(p_keys) > 40 then raise exception 'Слишком много случаев'; end if;
  if cardinality(md) = 0 or not (md <@ array['norm', 'hard']) then raise exception 'Выберите режим игры'; end if;
  loop
    c := '';
    for i in 1..5 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.clinic_sessions where code = c);
  end loop;
  insert into public.clinic_sessions (code, host_id, title, case_keys, modes)
    values (c, auth.uid(), left(btrim(coalesce(p_title, '')), 80), p_keys, (select array_agg(distinct m order by m) from unnest(md) m));
  return c;
end;
$$;
revoke all on function public.clinic_create(text, text[], text[]) from public, anon;
grant execute on function public.clinic_create(text, text[], text[]) to authenticated;

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
  return jsonb_build_object('n', k, 'secret', sec, 'name', nm, 'keys', to_jsonb(s.case_keys), 'title', s.title, 'modes', to_jsonb(s.modes));
end;
$$;

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
                            'status', s.status, 'results', p.results, 'score', p.score, 'modes', to_jsonb(s.modes));
end;
$$;

-- Удаление занятия вместе со всеми его участниками и результатами (только ведущий)
create or replace function public.clinic_delete(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.clinic_sessions where code = upper(btrim(p_code)) and host_id = auth.uid();
  if not found then raise exception 'Занятие не найдено'; end if;
end;
$$;
revoke all on function public.clinic_delete(text) from public, anon;
grant execute on function public.clinic_delete(text) to authenticated;

-- Экран для проектора: без входа, по коду занятия (как «Своя игра», /clinic/КОД). Видны имена и баллы.
create or replace function public.clinic_screen(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', s.title, 'status', s.status, 'keys', to_jsonb(s.case_keys),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('n', p.n, 'name', p.name, 'score', p.score,
                                          'done', (select count(*) from jsonb_object_keys(p.results)), 'results', p.results)
                       order by p.score desc, p.updated_at asc)
      from public.clinic_players p where p.code = s.code
    ), '[]'::jsonb))
  from public.clinic_sessions s where s.code = upper(btrim(p_code));
$$;
revoke all on function public.clinic_screen(text) from public;
grant execute on function public.clinic_screen(text) to anon, authenticated;
