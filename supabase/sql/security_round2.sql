-- ==============================================================================
-- ДОПОЛНИТЕЛЬНОЕ УСИЛЕНИЕ (раунд 2). Выполнить целиком в Supabase -> SQL Editor.
-- Можно запускать повторно. Предварительно должен быть выполнен question_order.sql.
-- ==============================================================================

-- 1. Источники можно удалять (раньше не было права на UPDATE, удаление всегда падало)
drop policy if exists "Редактирование источников" on public.sources;
create policy "Редактирование источников" on public.sources
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- 2. Журнал аудита: преподаватель не может писать в него (подделывать записи).
--    Записи делают админ в интерфейсе и Edge Functions (service role, RLS не касается).
drop policy if exists "Запись в журнал аудита" on public.audit_logs;
create policy "Запись в журнал аудита" on public.audit_logs
  for insert to authenticated with check (user_id = auth.uid() and public.is_admin());

-- 3. Гость (anon) не может ничего менять ни в одной таблице, даже если когда-то снимали RLS
revoke insert, update, delete on all tables in schema public from anon;

-- 4. Нумерация вопросов: защита от подделки и дублей
--    * номер при создании назначает только база (присланный клиентом игнорируется);
--    * при редактировании номер не меняется; при переносе в другую тему — следующий в новой;
--    * фиксированный search_path; индекс по (topic_id, num) уникальный.
create or replace function public.questions_assign_num()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.topic_id = old.topic_id then
      if old.num is not null then
        new.num := old.num;   -- номер не меняется при редактировании
      end if;
      return new;
    end if;
  end if;
  -- Новый вопрос (присланный номер игнорируем) или перенос в другую тему: следующий номер в теме
  perform pg_advisory_xact_lock(7001, hashtext(new.topic_id::text));
  select coalesce(max(num), 0) + 1 into new.num
  from public.questions
  where topic_id = new.topic_id;
  return new;
end;
$$;

drop trigger if exists trg_questions_assign_num on public.questions;
create trigger trg_questions_assign_num
before insert or update on public.questions
for each row execute function public.questions_assign_num();

do $$
begin
  if exists (select 1 from public.questions group by topic_id, num having count(*) > 1) then
    raise notice 'В questions есть повторяющиеся номера в теме — уникальный индекс не создан. Пришлите это сообщение разработчику.';
  else
    create unique index if not exists uq_questions_topic_num on public.questions (topic_id, num);
  end if;
end $$;

-- 5. Билеты: создавать партию, билеты и их вопросы можно только в СВОЕЙ партии
--    (раньше политики разрешали писать что угодно, в том числе в чужие билеты).
--    Автор может удалить свою партию (нужно, чтобы недосозданную партию можно было откатить).
drop policy if exists "Создание партий билетов" on public.ticket_batches;
create policy "Создание партий билетов" on public.ticket_batches
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists "Удаление партий билетов только админам" on public.ticket_batches;
drop policy if exists "Удаление партий билетов" on public.ticket_batches;
create policy "Удаление партий билетов" on public.ticket_batches
  for delete to authenticated using (public.is_admin() or created_by = auth.uid());

drop policy if exists "Создание билетов" on public.tickets;
create policy "Создание билетов" on public.tickets
  for insert to authenticated
  with check (exists (select 1 from public.ticket_batches b where b.id = batch_id and b.created_by = auth.uid()));

drop policy if exists "Создание вопросов в билетах" on public.ticket_questions;
create policy "Создание вопросов в билетах" on public.ticket_questions
  for insert to authenticated
  with check (exists (
    select 1 from public.tickets t join public.ticket_batches b on b.id = t.batch_id
    where t.id = ticket_id and b.created_by = auth.uid()
  ));

-- 6. Проверка: во всех таблицах схемы public должен быть включён RLS (relrowsecurity = true).
--    Любая строка с false — таблица открыта (например, после step1_unlock.sql). Тогда выполните
--    alter table public.<имя> enable row level security;
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by c.relrowsecurity, c.relname;
