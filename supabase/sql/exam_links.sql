-- Билеты классу в Telegram: запуск набора (exam_links) и попытки учеников (exam_attempts).
-- Преподаватель запускает свой набор билетов -> получает 6-значный код; ученики проходят билет в боте.
-- Запись идёт только через функции exam_link_create / exam_link_close и сервисный ключ (бот);
-- из приложения таблицы можно только читать: свой запуск (created_by = auth.uid()) или всё — главный админ.
-- Ученики попытки через RLS не читают никогда (только сервисный ключ). У anon прав нет.
-- Кластерные наборы (generation_params.source = 'cluster') классу запускать нельзя.
-- Повторный запуск безопасен.
-- Применить: supabase db query --linked -f supabase/sql/exam_links.sql

create table if not exists public.exam_links (
  code text primary key,
  batch_id uuid not null references public.ticket_batches(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  closes_at timestamptz not null,
  closed_at timestamptz,
  duration_min int not null default 30,
  review_sent_at timestamptz
);

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.exam_links(code) on delete cascade,
  tg_user_id bigint not null,
  tg_username text,
  tg_name text,
  student_name text not null,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  finished_at timestamptz,
  answers jsonb not null default '{}',
  score int,
  max_score int,
  unique (code, tg_user_id)
);

create index if not exists exam_links_batch_idx on public.exam_links (batch_id);
create index if not exists exam_links_created_by_idx on public.exam_links (created_by);
create index if not exists exam_attempts_ticket_idx on public.exam_attempts (ticket_id);

alter table public.exam_links enable row level security;
alter table public.exam_attempts enable row level security;

revoke all on public.exam_links from public, anon, authenticated;
revoke all on public.exam_attempts from public, anon, authenticated;
grant select on public.exam_links to authenticated;
grant select on public.exam_attempts to authenticated;

drop policy if exists "Просмотр своих запусков" on public.exam_links;
create policy "Просмотр своих запусков" on public.exam_links
  for select to authenticated
  using (created_by = (select auth.uid()) or (select public.is_owner()));

drop policy if exists "Просмотр попыток своих запусков" on public.exam_attempts;
create policy "Просмотр попыток своих запусков" on public.exam_attempts
  for select to authenticated
  using (exists (
    select 1 from public.exam_links l
    where l.code = exam_attempts.code
      and (l.created_by = (select auth.uid()) or (select public.is_owner()))
  ));

-- Создать запуск набора: автор набора или главный админ, набор не кластерный
create or replace function public.exam_link_create(p_batch_id uuid)
returns public.exam_links
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.ticket_batches;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  r public.exam_links;
  i int;
begin
  select * into b from public.ticket_batches where id = p_batch_id;
  if not found then raise exception 'Набор билетов не найден'; end if;
  if b.created_by is distinct from auth.uid() and not public.is_owner() then
    raise exception 'Запустить набор может только его автор';
  end if;
  if public.is_cluster_batch(b.generation_params) then
    raise exception 'Кластерный набор запустить классу нельзя';
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    begin
      insert into public.exam_links (code, batch_id, created_by, closes_at)
      values (v_code, p_batch_id, auth.uid(), now() + interval '24 hours')
      returning * into r;
      return r;
    exception when unique_violation then
      null; -- такой код уже есть, пробуем другой
    end;
  end loop;
end;
$$;

-- Закрыть запуск: автор запуска или главный админ
create or replace function public.exam_link_close(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.exam_links;
begin
  select * into l from public.exam_links where code = p_code;
  if not found then raise exception 'Запуск не найден'; end if;
  if l.created_by is distinct from auth.uid() and not public.is_owner() then
    raise exception 'Закрыть запуск может только его автор';
  end if;
  update public.exam_links set closed_at = now() where code = p_code and closed_at is null;
end;
$$;

revoke all on function public.exam_link_create(uuid) from public, anon;
grant execute on function public.exam_link_create(uuid) to authenticated;
revoke all on function public.exam_link_close(text) from public, anon;
grant execute on function public.exam_link_close(text) to authenticated;
