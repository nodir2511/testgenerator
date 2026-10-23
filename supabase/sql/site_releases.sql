-- Обновления сайта («Что нового») и история версий.
-- Каждый пункт обновления имеет минимальный уровень роли (min_rank) и виден только ему и выше:
--   4 — главный админ, 3 — администратор, 2 — администратор по предметам,
--   1 — преподаватель и преподаватель по предметам (одинаковый уровень).
-- Пункт можно привязать к предмету (subject_id): тогда его видят только те, кому доступен этот предмет
-- (преподаватели и администраторы по предметам — только назначенные предметы; остальные роли и главный админ — любые).
-- Требует subject_roles.sql (функция can_view_subject).
-- Фильтрация делается на сервере (RLS): пункты выше уровня пользователя до браузера не доходят.
-- Писать и править записи может только главный админ (форма на сайте) либо SQL Editor / service role.
-- Скрипт безопасно запускать повторно.

begin;

-- Уровень текущего пользователя (0 — не авторизован)
create or replace function public.my_rank()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when is_owner then 4
      when role = 'admin' then 3
      when role = 'subject_admin' then 2
      else 1
    end
    from public.profiles where id = auth.uid()
  ), 0);
$$;

create table if not exists public.site_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null default '',
  released_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.site_release_items (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.site_releases(id) on delete cascade,
  kind text not null default 'new' check (kind in ('new', 'fixed', 'improved')),
  text text not null check (length(btrim(text)) > 0),
  min_rank smallint not null default 1 check (min_rank between 1 and 4),
  order_index int not null default 0
);
alter table public.site_release_items add column if not exists subject_id uuid references public.subjects(id) on delete cascade;
create index if not exists idx_site_release_items_release on public.site_release_items (release_id, order_index);
create index if not exists idx_site_releases_date on public.site_releases (released_at desc);

-- Какие версии пользователь уже закрыл
create table if not exists public.site_release_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  release_id uuid not null references public.site_releases(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, release_id)
);

alter table public.site_releases enable row level security;
alter table public.site_release_items enable row level security;
alter table public.site_release_reads enable row level security;

-- Пункты: виден тот, у кого уровень не ниже min_rank
drop policy if exists "Просмотр пунктов обновлений" on public.site_release_items;
create policy "Просмотр пунктов обновлений" on public.site_release_items
  for select to authenticated using (
    min_rank <= public.my_rank()
    and (subject_id is null or public.is_owner() or public.can_view_subject(subject_id))
  );

-- Версия видна, если в ней есть хотя бы один доступный пункт (главный админ видит и пустые)
drop policy if exists "Просмотр обновлений" on public.site_releases;
create policy "Просмотр обновлений" on public.site_releases
  for select to authenticated using (
    public.is_owner()
    or exists (
      select 1 from public.site_release_items i
      where i.release_id = site_releases.id and i.min_rank <= public.my_rank()
        and (i.subject_id is null or public.can_view_subject(i.subject_id))
    )
  );

drop policy if exists "Запись обновлений" on public.site_releases;
create policy "Запись обновлений" on public.site_releases
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "Запись пунктов обновлений" on public.site_release_items;
create policy "Запись пунктов обновлений" on public.site_release_items
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists "Свои отметки прочтения" on public.site_release_reads;
create policy "Свои отметки прочтения" on public.site_release_reads
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Отметить прочитанным" on public.site_release_reads;
create policy "Отметить прочитанным" on public.site_release_reads
  for insert to authenticated with check (user_id = auth.uid());

-- Добавление версии одним вызовом (для SQL-файлов в supabase/sql/releases/).
-- p_items: [{"kind":"new|fixed|improved","text":"...","min_rank":1,"subject":"Химия"}, ...]  (subject — название предмета, необязательно)
-- Повторный вызов с той же версией ничего не меняет. Вызывать может главный админ или SQL Editor.
create or replace function public.add_site_release(p_version text, p_title text, p_items jsonb, p_released_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  it jsonb;
  n int := 0;
  sid uuid;
begin
  if auth.uid() is not null and not public.is_owner() then
    raise exception 'Записи об обновлениях добавляет только главный администратор';
  end if;

  insert into public.site_releases (version, title, released_at)
  values (p_version, coalesce(p_title, ''), p_released_at)
  on conflict (version) do nothing
  returning id into rid;

  if rid is null then
    return (select id from public.site_releases where version = p_version);
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    sid := null;
    if it->>'subject' is not null then
      select id into sid from public.subjects where name = it->>'subject' and not is_deleted limit 1;
      if sid is null then raise exception 'Предмет не найден: %', it->>'subject'; end if;
    end if;
    insert into public.site_release_items (release_id, kind, text, min_rank, subject_id, order_index)
    values (rid, coalesce(it->>'kind', 'new'), it->>'text', coalesce((it->>'min_rank')::smallint, 1), sid, n);
    n := n + 1;
  end loop;
  return rid;
end;
$$;

revoke all on function public.add_site_release(text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.add_site_release(text, text, jsonb, timestamptz) to authenticated;

commit;
