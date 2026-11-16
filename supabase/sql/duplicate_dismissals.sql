-- Одобренные пары в разделе «Качество банка»: проверяющий отметил, что два похожих вопроса — не дубль
-- (или расхождение ответов задумано). Такая пара больше не показывается в списках; её можно вернуть.
-- Пара хранится как два id вопросов в порядке a < b. Видеть и менять могут админы и главный админ,
-- а админ по предметам — только пары вопросов своих предметов (public.can_manage_question).
-- Применить: supabase db query --linked -f supabase/sql/duplicate_dismissals.sql
create table if not exists public.duplicate_dismissals (
  a uuid not null references public.questions(id) on delete cascade,
  b uuid not null references public.questions(id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
create index if not exists duplicate_dismissals_b_idx on public.duplicate_dismissals (b);

alter table public.duplicate_dismissals enable row level security;

drop policy if exists "Одобренные пары: просмотр главным админом" on public.duplicate_dismissals;
drop policy if exists "Одобренные пары: добавление главным админом" on public.duplicate_dismissals;
drop policy if exists "Одобренные пары: удаление главным админом" on public.duplicate_dismissals;
drop policy if exists "Одобренные пары: просмотр" on public.duplicate_dismissals;
create policy "Одобренные пары: просмотр" on public.duplicate_dismissals
  for select to authenticated using ((select public.can_manage_question(a)));
drop policy if exists "Одобренные пары: добавление" on public.duplicate_dismissals;
create policy "Одобренные пары: добавление" on public.duplicate_dismissals
  for insert to authenticated with check ((select public.can_manage_question(a)) and (select public.can_manage_question(b)));
drop policy if exists "Одобренные пары: удаление" on public.duplicate_dismissals;
create policy "Одобренные пары: удаление" on public.duplicate_dismissals
  for delete to authenticated using ((select public.can_manage_question(a)));
