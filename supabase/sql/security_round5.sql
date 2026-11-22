-- Проверка перед версией 1.0.0 (21 ноября 2026): точечные исправления доступа.
-- Применяется после всех остальных файлов; повторный запуск безопасен.
--   npx supabase db query --linked -f supabase/sql/security_round5.sql

-- 1. Замена вопросов в наборе: набор нельзя превратить в партию экзамена-кластера через p_params,
--    снимок обязан быть объектом, а новый вопрос — существовать и быть доступным вызывающему.
create or replace function public.update_batch_questions(p_batch_id uuid, p_changes jsonb, p_params jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.ticket_batches; c jsonb; n int := 0; cnt int; qid uuid;
begin
  select * into b from public.ticket_batches where id = p_batch_id for update;
  if not found then raise exception 'Набор билетов не найден'; end if;
  if b.created_by is distinct from auth.uid() and not public.is_owner() then
    raise exception 'Менять набор может только его автор';
  end if;
  if public.is_cluster_batch(b.generation_params) then
    raise exception 'Партии экзамена-кластера менять нельзя';
  end if;
  -- Набор уже запускали классу (даже закрыто): снимки лежат под теми же id, что в ответах учеников и статистике
  if to_regclass('public.exam_links') is not null and exists (select 1 from public.exam_links where batch_id = p_batch_id) then
    raise exception 'У набора есть запуск классу — менять вопросы нельзя. Сделайте копию набора.';
  end if;
  if p_params is not null and (jsonb_typeof(p_params) <> 'object' or public.is_cluster_batch(p_params)) then
    raise exception 'Неверные параметры набора';
  end if;
  for c in select value from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    qid := nullif(c->>'question_id', '')::uuid;
    if jsonb_typeof(c->'question_snapshot') is distinct from 'object' then
      raise exception 'Неверный снимок вопроса';
    end if;
    if qid is not null and not exists (
      select 1 from public.questions q where q.id = qid and public.can_view_subject(q.subject_id)
    ) then
      raise exception 'Вопрос недоступен';
    end if;
    update public.ticket_questions tq
       set question_id = qid, question_snapshot = c->'question_snapshot'
     where tq.id = (c->>'ticket_question_id')::uuid
       and tq.ticket_id in (select t.id from public.tickets t where t.batch_id = p_batch_id);
    get diagnostics cnt = row_count;
    if cnt = 0 then raise exception 'Вопрос билета не найден в этом наборе'; end if;
    n := n + 1;
  end loop;
  if p_params is not null then
    update public.ticket_batches set generation_params = p_params where id = p_batch_id;
  end if;
  return jsonb_build_object('updated', n);
end;
$$;
revoke all on function public.update_batch_questions(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_batch_questions(uuid, jsonb, jsonb) to authenticated;

-- 2. Безвозвратное удаление (мимо корзины) — только администратор. Сайт вопросы, главы и темы
--    не удаляет физически (только is_deleted), картинки из хранилища не удаляет вовсе.
drop policy if exists "Удаление вопросов только админам" on public.questions;
create policy "Удаление вопросов только админам" on public.questions
  for delete to authenticated using ((select public.is_admin()));
drop policy if exists "Удаление глав только админам" on public.chapters;
create policy "Удаление глав только админам" on public.chapters
  for delete to authenticated using ((select public.is_admin()));
drop policy if exists "Удаление тем только админам" on public.topics;
create policy "Удаление тем только админам" on public.topics
  for delete to authenticated using ((select public.is_admin()));
drop policy if exists "Удаление картинок администратора" on storage.objects;
create policy "Удаление картинок администратора" on storage.objects
  for delete to authenticated using (bucket_id = 'question-images' and (select public.is_admin()));

-- 3. Журнал ошибок интерфейса: лимит на каждого отправителя (а не один общий, который может
--    выбрать посторонний) и общий потолок числа строк.
create or replace function public.report_client_error(p_message text, p_stack text default null, p_url text default null, p_version text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(p_message), '') = '' then return; end if;
  if auth.uid() is null then
    if (select count(*) from public.client_errors where user_id is null and created_at > now() - interval '1 minute') >= 10 then return; end if;
  elsif (select count(*) from public.client_errors where user_id = auth.uid() and created_at > now() - interval '1 minute') >= 10 then
    return;
  end if;
  if (select count(*) from public.client_errors) >= 20000 then return; end if;
  insert into public.client_errors (user_id, message, stack, url, app_version)
  values (auth.uid(), left(p_message, 1000), left(p_stack, 4000), left(p_url, 500), left(p_version, 32));
  -- Хранить не дольше 400 дней: по журналу строится годовая сводка ошибок (error-digest).
  -- Это итоговое определение функции: срок меняйте здесь, а не только в client_errors.sql
  delete from public.client_errors where created_at < now() - interval '400 days';
end;
$$;
revoke all on function public.report_client_error(text, text, text, text) from public;
grant execute on function public.report_client_error(text, text, text, text) to anon, authenticated;
create index if not exists idx_client_errors_user_created on public.client_errors (user_id, created_at desc);

-- 4. «Своя игра»: возврат команды по коду — 5 попыток за 15 минут (было 10 за 5 минут).
create or replace function public.game_rejoin(p_code text, p_n int, p_pin text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := upper(btrim(p_code));
  g public.game_secrets;
  sec text := replace(gen_random_uuid()::text, '-', '');
  nm text;
begin
  select * into g from public.game_secrets where code = c and n = p_n for update;
  if not found then raise exception 'Команда не найдена'; end if;
  if g.fails >= 5 and g.last_fail > now() - interval '15 minutes' then
    raise exception 'Слишком много попыток. Подождите 15 минут или спросите код у ведущего';
  end if;
  if g.pin is distinct from btrim(coalesce(p_pin, '')) then
    update public.game_secrets
      set fails = case when last_fail < now() - interval '15 minutes' then 1 else fails + 1 end, last_fail = now()
      where code = c and n = p_n;
    return jsonb_build_object('ok', false, 'reason', 'bad_pin');
  end if;
  update public.game_secrets set secret = sec, fails = 0, last_fail = null where code = c and n = p_n;
  select t->>'name' into nm from public.game_sessions s, jsonb_array_elements(s.teams) t where s.code = c and (t->>'n')::int = p_n;
  return jsonb_build_object('ok', true, 'n', p_n, 'secret', sec, 'name', nm, 'pin', g.pin);
end;
$$;
revoke all on function public.game_rejoin(text, int, text) from public;
grant execute on function public.game_rejoin(text, int, text) to anon, authenticated;

-- 5. Лимиты генерации: администратор по предметам освобождён и здесь (как в enforce_generation_limits).
create or replace function public.guard_ticket_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.ticket_batches;
  cfg public.generation_settings;
  bid uuid;
  tid uuid;
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;
  if tg_table_name = 'tickets' then
    bid := new.batch_id;
  else
    tid := new.ticket_id;
    select t.batch_id into bid from public.tickets t where t.id = tid;
  end if;
  select * into b from public.ticket_batches where id = bid;
  if not found or b.created_at < now() - interval '2 minutes' then
    raise exception 'Набор уже сохранён — изменить его нельзя';
  end if;
  select * into cfg from public.generation_settings where id;
  if not found then
    cfg.max_tickets := 4; cfg.max_per_ticket := 50;
  end if;
  if tg_table_name = 'tickets' then
    if (select count(*) from public.tickets where batch_id = bid) >= cfg.max_tickets then
      raise exception 'Не больше % билетов за один раз', cfg.max_tickets;
    end if;
  elsif (select count(*) from public.ticket_questions where ticket_id = tid) >= cfg.max_per_ticket then
    raise exception 'Не больше % вопросов в одном билете', cfg.max_per_ticket;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_ticket_insert() from public, anon, authenticated;

-- 6. Привязка Telegram: «Учитель игры» к банку вопросов доступа не имеет, бот ему не нужен.
create or replace function public.create_telegram_link_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c text;
begin
  if auth.uid() is null then
    raise exception 'Требуется вход в систему';
  end if;
  if public.auth_role() = 'game_teacher' then
    raise exception 'Для этой роли привязка Telegram недоступна';
  end if;
  delete from public.telegram_link_codes where user_id = auth.uid() or expires_at < now();
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.telegram_link_codes (code, user_id, expires_at)
  values (c, auth.uid(), now() + interval '10 minutes');
  return c;
end;
$$;
revoke all on function public.create_telegram_link_code() from public, anon;
grant execute on function public.create_telegram_link_code() to authenticated;

-- 7. История импорта (имена файлов и авторы) — только тем, кто импортирует.
drop policy if exists "Просмотр партий импорта" on public.import_batches;
create policy "Просмотр партий импорта" on public.import_batches
  for select to authenticated using ((select public.is_staff()));

-- 8. Триггерные функции напрямую (через /rpc) вызывать незачем.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- 9. Индексы внешних ключей (замечания проверки Supabase).
create index if not exists idx_duplicate_dismissals_created_by on public.duplicate_dismissals (created_by);
create index if not exists idx_passages_chapter on public.passages (chapter_id);
create index if not exists idx_passages_created_by on public.passages (created_by);
create index if not exists idx_passages_source on public.passages (source_id);
