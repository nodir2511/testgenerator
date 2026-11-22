-- Ускорение сайта (проверка 22 ноября 2026). Права доступа не меняются — меняется только способ их проверки.
--   1. Индексы: связи вопросов (linked_ids, вместе с функцией questions_linking_to), чтение предмета страницами по id,
--      «последнее изменение в предмете».
--   2. Варианты ответов и пары соответствия: видимость проверяется не функцией на каждую строку
--      (can_view_question — до 80 % времени загрузки банка), а самой политикой «Просмотр вопросов».
--   3. Билеты и «Что нового»: is_owner() и my_rank() вычисляются один раз на запрос — (select …).
--      Политики записи «Что нового» разделены по действиям, чтобы не дублировать политику чтения.
--   4. questions_with_issue — вопросы без правильного ответа или не по стандарту (фильтр «проблемы» в банке вопросов).
--   5. unread_site_releases — версии «Что нового», которые пользователь ещё не закрыл (окно при входе).
-- Повторный запуск безопасен. Применяется после deleted_question_options.sql.
-- После повторного запуска question_children_rls_fast.sql, cluster_batches.sql, owner_history.sql,
-- rls_initplan_indexes.sql или site_releases.sql примените этот файл заново.
-- Применить: supabase db query --linked -f supabase/sql/perf_round1.sql

-- ── 1. Индексы ──────────────────────────────────────────────────────────────────────────────
-- «Где ещё используется вопрос»: linked_ids && {…} — раньше полный перебор всех вопросов
create index if not exists idx_questions_linked_ids on public.questions using gin (linked_ids);
-- Сам по себе индекс под RLS не работает: оператор && не помечен leakproof, поэтому при обычном запросе к таблице
-- Postgres обязан сначала проверить права каждой строки (полный перебор). Функция ниже ищет по индексу
-- (security definer) и сама проверяет видимость найденных строк тем же правилом, что и политика: can_view_question.
create or replace function public.questions_linking_to(p_ids uuid[])
returns table (id uuid, type text, num int, linked_ids uuid[])
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.type::text, q.num, q.linked_ids
  from public.questions q
  where q.linked_ids && p_ids
    and q.is_deleted = false
    and public.can_view_question(q.id);
$$;

revoke all on function public.questions_linking_to(uuid[]) from public, anon;
grant execute on function public.questions_linking_to(uuid[]) to authenticated, service_role;

-- Чтение вопросов предмета страницами «после id» (fetchAllPages, loadLightPool)
create index if not exists idx_questions_subject_id on public.questions (subject_id, id);
-- «Когда в предмете последний раз меняли вопросы» (кэш «Качества банка»)
create index if not exists idx_questions_subject_updated on public.questions (subject_id, updated_at desc);

-- ── 2. Варианты ответов и пары соответствия ─────────────────────────────────────────────────
-- Админ видит всё (проверка один раз на запрос). Остальные видят варианты тех вопросов, которые видят сами:
-- вложенный запрос к questions идёт под политикой «Просмотр вопросов» (questions_rls_fast.sql), поэтому
-- удалённые вопросы и чужие предметы отсекаются так же, как раньше в can_view_question.
drop policy if exists "Просмотр вариантов" on public.question_options;
create policy "Просмотр вариантов" on public.question_options for select to authenticated using (
  (select public.auth_role()) = 'admin'
  or exists (select 1 from public.questions q where q.id = question_options.question_id)
);

drop policy if exists "Просмотр элементов соответствия" on public.matching_items;
create policy "Просмотр элементов соответствия" on public.matching_items for select to authenticated using (
  (select public.auth_role()) = 'admin'
  or exists (select 1 from public.questions q where q.id = matching_items.question_id)
);

-- ── 3. Билеты ───────────────────────────────────────────────────────────────────────────────
-- Те же правила, что в cluster_batches.sql: главный админ — всё, остальные — свои и не кластерные.
drop policy if exists "Просмотр партий билетов" on public.ticket_batches;
create policy "Просмотр партий билетов" on public.ticket_batches for select to authenticated using (
  (select public.is_owner())
  or (created_by = (select auth.uid()) and not public.is_cluster_batch(generation_params))
);

drop policy if exists "Просмотр билетов" on public.tickets;
create policy "Просмотр билетов" on public.tickets for select to authenticated using (
  (select public.is_owner())
  or exists (
    select 1 from public.ticket_batches b
    where b.id = tickets.batch_id and b.created_by = (select auth.uid()) and not public.is_cluster_batch(b.generation_params)
  )
);

drop policy if exists "Просмотр вопросов в билетах" on public.ticket_questions;
create policy "Просмотр вопросов в билетах" on public.ticket_questions for select to authenticated using (
  (select public.is_owner())
  or exists (
    select 1 from public.tickets t join public.ticket_batches b on b.id = t.batch_id
    where t.id = ticket_questions.ticket_id and b.created_by = (select auth.uid()) and not public.is_cluster_batch(b.generation_params)
  )
);

-- ── 3а. «Что нового» ────────────────────────────────────────────────────────────────────────
drop policy if exists "Просмотр пунктов обновлений" on public.site_release_items;
create policy "Просмотр пунктов обновлений" on public.site_release_items for select to authenticated using (
  min_rank <= (select public.my_rank())
  and (subject_id is null or (select public.is_owner()) or public.can_view_subject(subject_id))
);

drop policy if exists "Просмотр обновлений" on public.site_releases;
create policy "Просмотр обновлений" on public.site_releases for select to authenticated using (
  (select public.is_owner())
  or exists (
    select 1 from public.site_release_items i
    where i.release_id = site_releases.id and i.min_rank <= (select public.my_rank())
      and (i.subject_id is null or public.can_view_subject(i.subject_id))
  )
);

-- Запись — только главный админ. Раньше одна политика «for all» действовала и на чтение (вторая проверка на каждую строку).
drop policy if exists "Запись обновлений" on public.site_releases;
drop policy if exists "Добавление обновлений" on public.site_releases;
drop policy if exists "Изменение обновлений" on public.site_releases;
drop policy if exists "Удаление обновлений" on public.site_releases;
create policy "Добавление обновлений" on public.site_releases for insert to authenticated with check ((select public.is_owner()));
create policy "Изменение обновлений" on public.site_releases for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "Удаление обновлений" on public.site_releases for delete to authenticated using ((select public.is_owner()));

drop policy if exists "Запись пунктов обновлений" on public.site_release_items;
drop policy if exists "Добавление пунктов обновлений" on public.site_release_items;
drop policy if exists "Изменение пунктов обновлений" on public.site_release_items;
drop policy if exists "Удаление пунктов обновлений" on public.site_release_items;
create policy "Добавление пунктов обновлений" on public.site_release_items for insert to authenticated with check ((select public.is_owner()));
create policy "Изменение пунктов обновлений" on public.site_release_items for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "Удаление пунктов обновлений" on public.site_release_items for delete to authenticated using ((select public.is_owner()));

-- ── 4. Вопросы с проблемами ─────────────────────────────────────────────────────────────────
-- Те же правила, что в src/lib/questionIssues.ts (меняете одно — меняйте и другое):
--   тест — ровно один верный вариант и 4 варианта; соответствие — 4 слева, 5 справа, у каждого левого пункта
--   правильный ответ из правых пунктов этого же вопроса; открытый — задан числовой ответ.
-- p_issue: 'any' — любая проблема, 'no_answer' — нет правильного ответа, 'count' — число вариантов или пунктов не по стандарту.
-- security invoker: видны только вопросы, доступные вызывающему (RLS). Остальные фильтры, сортировку и страницы
-- задаёт сайт поверх результата (PostgREST). Без «set search_path» намеренно: такую функцию Postgres встраивает
-- в запрос, и фильтры сайта срабатывают до проверки вариантов; все имена внутри указаны со схемой.
create or replace function public.questions_with_issue(
  p_issue text,
  p_subject_id uuid default null,
  p_chapter_id uuid default null,
  p_topic_id uuid default null
)
returns setof public.questions
language sql
stable
security invoker
as $$
  select q.*
  from public.questions q
  where q.is_deleted = false
    and (p_subject_id is null or q.subject_id = p_subject_id)
    and (p_chapter_id is null or q.chapter_id = p_chapter_id)
    and (p_topic_id is null or q.topic_id = p_topic_id)
    and case q.type::text
      when 'test' then (
        select case p_issue
          when 'no_answer' then count(*) filter (where o.is_correct) = 0
          when 'count' then count(*) <> 4
          else count(*) filter (where o.is_correct) <> 1 or count(*) <> 4
        end
        from public.question_options o
        where o.question_id = q.id
      )
      when 'matching' then (
        select case p_issue
          when 'no_answer' then m.l = 0 or m.unlinked > 0
          when 'count' then m.l <> 4 or m.r <> 5
          else m.unlinked > 0 or m.l <> 4 or m.r <> 5
        end
        from (
          select
            count(*) filter (where i.side = 'left') as l,
            count(*) filter (where i.side = 'right') as r,
            count(*) filter (where i.side = 'left' and (i.correct_match_id is null or not exists (
              select 1 from public.matching_items x
              where x.id = i.correct_match_id and x.question_id = i.question_id and x.side = 'right'))) as unlinked
          from public.matching_items i
          where i.question_id = q.id
        ) m
      )
      when 'open' then p_issue is distinct from 'count' and q.correct_numeric_answer is null
      else false
    end;
$$;

revoke all on function public.questions_with_issue(text, uuid, uuid, uuid) from public, anon;
grant execute on function public.questions_with_issue(text, uuid, uuid, uuid) to authenticated, service_role;

-- ── 5. Непрочитанные версии ─────────────────────────────────────────────────────────────────
-- Версии, которые пользователь ещё не закрыл и в которых есть пункты не из раздела «Игры».
-- Видимость версий и пунктов по роли и предметам — как обычно, через RLS.
create or replace function public.unread_site_releases()
returns setof public.site_releases
language sql
stable
security invoker
set search_path = public
as $$
  select r.*
  from public.site_releases r
  where not exists (
      select 1 from public.site_release_reads x
      where x.release_id = r.id and x.user_id = (select auth.uid()))
    and exists (
      select 1 from public.site_release_items i
      where i.release_id = r.id and i.scope <> 'game');
$$;

revoke all on function public.unread_site_releases() from public, anon;
grant execute on function public.unread_site_releases() to authenticated, service_role;
