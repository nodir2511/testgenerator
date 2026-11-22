-- Билеты классу в Telegram: запуск набора (exam_links) и попытки учеников (exam_attempts).
-- Преподаватель запускает свой набор билетов -> получает 6-значный код; ученики проходят билет в боте.
-- Запись идёт только через функции exam_link_create / exam_link_close и сервисный ключ (бот);
-- ответы и сдачу попытки tg-exam пишет функциями exam_attempt_save / exam_attempt_close (только service_role);
-- из приложения таблицы можно только читать: свой запуск (created_by = auth.uid()) или всё — главный админ.
-- Ученики попытки через RLS не читают никогда (только сервисный ключ). У anon прав нет.
-- Кластерные наборы (generation_params.source = 'cluster') классу запускать нельзя.
-- Набор с запуском менять нельзя: update_batch_questions отказывает (см. update_batch_questions.sql и security_round5.sql).
-- Сессия: ученики заходят в «зал ожидания», автор нажимает «Начать» (exam_session_start) — у всех общий старт
-- (session_start_at) и общий срок (session_start_at + duration_min). Вариант до старта может сменить автор.
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
  deadline_at timestamptz,
  finished_at timestamptz,
  answers jsonb not null default '{}',
  score int,
  max_score int,
  unique (code, tg_user_id)
);

-- Язык билета выбирает ученик перед началом: ru или tg (на нём вопросы, разбор и сообщения бота)
alter table public.exam_attempts add column if not exists lang text not null default 'ru';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_attempts_lang_check' and conrelid = 'public.exam_attempts'::regclass) then
    alter table public.exam_attempts add constraint exam_attempts_lang_check check (lang in ('ru', 'tg'));
  end if;
end $$;

-- Срок попытки теперь на уровне запуска (session_start_at + duration_min), у попытки он не обязателен
alter table public.exam_attempts alter column deadline_at drop not null;

-- Старт общей сессии: пусто = ожидание («зал ожидания»); длительность 5..45 минут
alter table public.exam_links add column if not exists session_start_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_links_duration_check' and conrelid = 'public.exam_links'::regclass) then
    alter table public.exam_links add constraint exam_links_duration_check check (duration_min between 5 and 45);
  end if;
end $$;

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

-- Сохранить один ответ ученика (вызывает только tg-exam сервисным ключом).
-- Одно атомарное обновление: ответ дописывается к уже сохранённым (два сохранения подряд не теряют друг друга),
-- и только пока попытка идёт: не сдана, сессия запущена и идёт (session_start_at <= now < session_start_at + duration_min),
-- ссылка не закрыта и не истекла. null стирает ответ.
-- Возвращает, записан ли ответ.
create or replace function public.exam_attempt_save(p_attempt_id uuid, p_tq_id text, p_answer jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.exam_attempts a
     set answers = case
       when p_answer is null or p_answer = 'null'::jsonb then a.answers - p_tq_id
       else a.answers || jsonb_build_object(p_tq_id, p_answer)
     end
    from public.exam_links l
   where a.id = p_attempt_id
     and l.code = a.code
     and a.finished_at is null
     and l.session_start_at is not null
     and now() >= l.session_start_at
     and now() < l.session_start_at + make_interval(mins => l.duration_min)
     and l.closed_at is null
     and l.closes_at > now();
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Сдать попытку (вызывает только tg-exam сервисным ключом): finished_at = раньшее из «сейчас», конца сессии
-- (session_start_at + duration_min, если сессия запущена) и закрытия ссылки. После этого exam_attempt_save ответы не меняет, поэтому балл, посчитанный по возвращённым
-- ответам, всегда соответствует сохранённым. Уже сданная попытка не меняется — возвращаются её ответы;
-- нет попытки — null.
create or replace function public.exam_attempt_close(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  update public.exam_attempts a
     set finished_at = least(
           now(),
           coalesce(l.session_start_at + make_interval(mins => l.duration_min), 'infinity'::timestamptz),
           coalesce(l.closed_at, 'infinity'::timestamptz)
         )
    from public.exam_links l
   where a.id = p_attempt_id
     and l.code = a.code
     and a.finished_at is null
  returning a.answers into r;
  if not found then
    select answers into r from public.exam_attempts where id = p_attempt_id;
  end if;
  return r;
end;
$$;

-- Начать сессию: автор запуска или главный админ. Старт через 3 секунды (чтобы у всех экран успел переключиться).
-- Уже начатую сессию не трогает (идемпотентно: возвращает строку как есть).
create or replace function public.exam_session_start(p_code text, p_minutes int)
returns public.exam_links
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.exam_links;
begin
  select * into l from public.exam_links where code = p_code for update;
  if not found then raise exception 'Запуск не найден'; end if;
  if l.created_by is distinct from auth.uid() and not public.is_owner() then
    raise exception 'Начать сессию может только автор запуска';
  end if;
  if l.session_start_at is not null then return l; end if;
  if l.closed_at is not null or l.closes_at <= now() then raise exception 'Запуск закрыт'; end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 45 then raise exception 'Длительность от 5 до 45 минут'; end if;
  if not exists (select 1 from public.exam_attempts where code = p_code) then
    raise exception 'Пока никто не зашёл — начинать некому';
  end if;
  update public.exam_links
     set session_start_at = now() + interval '3 seconds', duration_min = p_minutes
   where code = p_code
  returning * into l;
  return l;
end;
$$;

-- Сменить вариант ученика до начала сессии: автор запуска или главный админ, билет — из набора запуска
create or replace function public.exam_attempt_set_variant(p_attempt_id uuid, p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.exam_attempts;
  l public.exam_links;
begin
  select * into a from public.exam_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Попытка не найдена'; end if;
  select * into l from public.exam_links where code = a.code for share;
  if l.created_by is distinct from auth.uid() and not public.is_owner() then
    raise exception 'Сменить вариант может только автор запуска';
  end if;
  if l.session_start_at is not null or a.finished_at is not null then
    raise exception 'Сменить вариант можно только до начала сессии';
  end if;
  if l.closed_at is not null or l.closes_at <= now() then raise exception 'Запуск закрыт'; end if;
  if not exists (select 1 from public.tickets t where t.id = p_ticket_id and t.batch_id = l.batch_id) then
    raise exception 'Этого билета нет в наборе';
  end if;
  update public.exam_attempts set ticket_id = p_ticket_id where id = p_attempt_id;
end;
$$;

revoke all on function public.exam_attempt_save(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.exam_attempt_save(uuid, text, jsonb) to service_role;
revoke all on function public.exam_attempt_close(uuid) from public, anon, authenticated;
grant execute on function public.exam_attempt_close(uuid) to service_role;

revoke all on function public.exam_link_create(uuid) from public, anon;
grant execute on function public.exam_link_create(uuid) to authenticated;
revoke all on function public.exam_link_close(text) from public, anon;
grant execute on function public.exam_link_close(text) to authenticated;
revoke all on function public.exam_session_start(text, int) from public, anon;
grant execute on function public.exam_session_start(text, int) to authenticated;
revoke all on function public.exam_attempt_set_variant(uuid, uuid) from public, anon;
grant execute on function public.exam_attempt_set_variant(uuid, uuid) to authenticated;
