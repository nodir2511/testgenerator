-- Занятия «Приём пациента», версия 3: учитель закрывает вход, когда все зашли.
-- Новые участники не входят, а уже вошедшие играют дальше; на проекторе остаётся только таблица лидеров.
-- Повторный запуск безопасен. Применить до выкладки сайта.

alter table public.clinic_sessions add column if not exists entry_closed boolean not null default false;

create or replace function public.clinic_lock(p_code text, p_closed boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.clinic_sessions set entry_closed = p_closed
   where code = upper(btrim(p_code)) and host_id = auth.uid();
  if not found then raise exception 'Занятие не найдено'; end if;
end;
$$;
revoke all on function public.clinic_lock(text, boolean) from public, anon;
grant execute on function public.clinic_lock(text, boolean) to authenticated;

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
  if s.entry_closed then raise exception 'Вход закрыт: учитель уже начал занятие'; end if;
  if nm = '' then raise exception 'Введите имя'; end if;
  select coalesce(max(n), 0) + 1 into k from public.clinic_players where code = s.code;
  if k > 80 then raise exception 'В занятии уже 80 участников'; end if;
  insert into public.clinic_players (code, n, name, secret) values (s.code, k, nm, sec);
  return jsonb_build_object('n', k, 'secret', sec, 'name', nm, 'keys', to_jsonb(s.case_keys), 'title', s.title, 'modes', to_jsonb(s.modes));
end;
$$;

create or replace function public.clinic_board(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s public.clinic_sessions;
begin
  select * into s from public.clinic_sessions where code = upper(btrim(p_code)) and host_id = auth.uid();
  if not found then raise exception 'Занятие не найдено'; end if;
  return jsonb_build_object(
    'title', s.title, 'status', s.status, 'entry_closed', s.entry_closed, 'keys', to_jsonb(s.case_keys),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('n', n, 'name', name, 'score', score, 'done', (select count(*) from jsonb_object_keys(results)), 'results', results)
                       order by score desc, updated_at asc)
      from public.clinic_players where code = s.code
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.clinic_screen(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', s.title, 'status', s.status, 'entry_closed', s.entry_closed, 'keys', to_jsonb(s.case_keys),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('n', p.n, 'name', p.name, 'score', p.score,
                                          'done', (select count(*) from jsonb_object_keys(p.results)), 'results', p.results)
                       order by p.score desc, p.updated_at asc)
      from public.clinic_players p where p.code = s.code
    ), '[]'::jsonb))
  from public.clinic_sessions s where s.code = upper(btrim(p_code));
$$;

-- Пункты обновлений раздела «Игры» (scope game) видны только на странице игр
alter table public.site_release_items drop constraint if exists site_release_items_scope_check;
alter table public.site_release_items add constraint site_release_items_scope_check check (scope in ('site', 'bot', 'app', 'game'));
