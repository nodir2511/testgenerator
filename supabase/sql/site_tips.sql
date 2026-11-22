-- Подсказки «А вы знали?»: маленькое окошко про функцию сайта, которое подсвечивает её место на экране и указывает на него стрелкой.
-- Каждая подсказка показывается пользователю один раз (site_tip_seen), видимость — как у пунктов «Что нового»:
-- по уровню роли (min_rank, my_rank()) и предмету (subject_id, can_view_subject).
-- target — ключ якоря в интерфейсе (атрибут data-tip="…" на элементе), tab — раздел сайта, где якорь живёт
-- (кнопка «Показать» переводит туда). Список ключей — docs/ARCHITECTURE.md, раздел «Подсказки».
-- Подсказки добавляет только главный админ (add_site_tip) или SQL Editor / service role; прямой записи в таблицу нет.
-- Применяется после site_releases.sql и telegram_release_notify.sql (нужны site_releases, site_release_items.scope).
-- Повторный запуск безопасен.
-- Применить: supabase db query --linked -f supabase/sql/site_tips.sql

begin;

create table if not exists public.site_tips (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  text text not null check (length(btrim(text)) > 0),
  target text not null check (length(btrim(target)) > 0),
  tab text,
  min_rank smallint not null default 1 check (min_rank between 1 and 4),
  subject_id uuid references public.subjects(id) on delete cascade,
  released_at timestamptz not null default now(),
  unique (version, text)
);
create index if not exists idx_site_tips_released on public.site_tips (released_at desc);
create index if not exists idx_site_tips_subject on public.site_tips (subject_id) where subject_id is not null;

-- Какие подсказки пользователю уже показаны (отметка ставится в момент показа)
create table if not exists public.site_tip_seen (
  user_id uuid not null references public.profiles(id) on delete cascade,
  tip_id uuid not null references public.site_tips(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, tip_id)
);
create index if not exists idx_site_tip_seen_tip on public.site_tip_seen (tip_id);

alter table public.site_tips enable row level security;
alter table public.site_tip_seen enable row level security;

-- Подсказки: только чтение; запись — функцией add_site_tip
revoke insert, update, delete, truncate on public.site_tips from anon, authenticated;
revoke all on public.site_tips from anon;
drop policy if exists "Просмотр подсказок" on public.site_tips;
create policy "Просмотр подсказок" on public.site_tips for select to authenticated using (
  min_rank <= (select public.my_rank())
  and (subject_id is null or (select public.is_owner()) or public.can_view_subject(subject_id))
);

-- Отметки «показано»: только свои, только чтение и добавление
revoke update, delete, truncate on public.site_tip_seen from anon, authenticated;
revoke all on public.site_tip_seen from anon;
drop policy if exists "Свои показанные подсказки" on public.site_tip_seen;
create policy "Свои показанные подсказки" on public.site_tip_seen for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Отметить подсказку показанной" on public.site_tip_seen;
create policy "Отметить подсказку показанной" on public.site_tip_seen for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Добавление подсказки (для файлов supabase/sql/releases/*). Повторный вызов с той же парой (версия, текст) ничего не меняет.
create or replace function public.add_site_tip(
  p_version text,
  p_text text,
  p_target text,
  p_tab text default null,
  p_min_rank smallint default 1,
  p_released_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid;
begin
  if auth.uid() is not null and not public.is_owner() then
    raise exception 'Подсказки добавляет только главный администратор';
  end if;
  insert into public.site_tips (version, text, target, tab, min_rank, released_at)
  values (p_version, p_text, p_target, p_tab, coalesce(p_min_rank, 1), coalesce(p_released_at, now()))
  on conflict (version, text) do nothing
  returning id into tid;
  if tid is null then
    select id into tid from public.site_tips where version = p_version and text = p_text;
  end if;
  return tid;
end;
$$;

revoke all on function public.add_site_tip(text, text, text, text, smallint, timestamptz) from public, anon;
grant execute on function public.add_site_tip(text, text, text, text, smallint, timestamptz) to authenticated, service_role;

-- Подсказки, которые можно показать вызывающему: ещё не показанные, по его уровню и предметам, от новых к старым.
-- Подсказки версии, чьё окно «Что нового» он ещё не закрыл (в версии есть видимые ему пункты не из «Игр»,
-- а отметки site_release_reads нет), ждут: иначе подсказка повторила бы окно в тот же заход.
-- Какую из них показать, решает сайт: первую, чей якорь сейчас виден на экране (src/lib/tips.ts, pickTip).
create or replace function public.next_site_tips()
returns setof public.site_tips
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid, public.my_rank() as rnk, public.is_owner() as own)
  select t.*
  from public.site_tips t, me
  where me.uid is not null
    and t.min_rank <= me.rnk
    and (t.subject_id is null or me.own or public.can_view_subject(t.subject_id))
    and not exists (select 1 from public.site_tip_seen s where s.user_id = me.uid and s.tip_id = t.id)
    and not exists (
      select 1 from public.site_releases r
      where r.version = t.version
        and not exists (select 1 from public.site_release_reads x where x.release_id = r.id and x.user_id = me.uid)
        and exists (
          select 1 from public.site_release_items i
          where i.release_id = r.id and i.scope <> 'game' and i.min_rank <= me.rnk
            and (i.subject_id is null or me.own or public.can_view_subject(i.subject_id))
        )
    )
  order by t.released_at desc, t.id
  limit 50;
$$;

revoke all on function public.next_site_tips() from public, anon;
grant execute on function public.next_site_tips() to authenticated, service_role;

-- ── Подсказки к функциям 0.97 и новее ───────────────────────────────────────────────────────
-- Дата — дата версии: новые подсказки показываются раньше старых.
select public.add_site_tip('1.3.0',
  'Сохранённый набор можно запустить для всего класса: ученики заходят по ссылке, ждут в зале ожидания и начинают одновременно по вашей команде.',
  'nav-exams', 'exams', 1::smallint, '2026-11-23 10:00:00+05');
select public.add_site_tip('1.2.0',
  'Откройте варианты набора и нажмите на билет: в предпросмотре можно заменить вопрос или целую тему, а нажав на вопрос — поправить его текст только в этом наборе.',
  'archive-variants', 'saved_tickets', 1::smallint, '2026-11-22 19:32:00+05');
select public.add_site_tip('1.1.0',
  'Откройте варианты набора и нажмите на билет, а в предпросмотре включите «Как в Word» — билет будет выглядеть точно как в скачанном файле.',
  'archive-variants', 'saved_tickets', 1::smallint, '2026-11-22 19:30:00+05');
select public.add_site_tip('1.0.1',
  'Чат-бот пришлёт подробное описание изменений сайта: напишите ему, например, /release 1.0.0.',
  'telegram-link', null, 1::smallint, '2026-11-22 05:00:00+05');
select public.add_site_tip('0.99.0',
  'В «Истории» собраны все созданные книжки: любую можно скачать снова или удалить — на отмену есть 5 секунд.',
  'cluster-history', 'cluster', 4::smallint, '2026-11-21 23:50:00+05');
select public.add_site_tip('0.98.0',
  'Откройте варианты набора и нажмите на любой билет: предпросмотр можно растянуть мышью, листать стрелками, переключать русский и таджикский и показывать ответы.',
  'archive-variants', 'saved_tickets', 1::smallint, '2026-11-21 21:00:00+05');
select public.add_site_tip('0.98.0',
  'Сюда можно перетащить сразу все ZIP-архивы предметов — сайт сам поймёт, какой архив к какому предмету.',
  'cluster-zip-drop', 'cluster', 4::smallint, '2026-11-21 21:00:00+05');

commit;
