-- Одобренные пары в разделе «Качество банка»: главный админ отметил, что два похожих вопроса — не дубль
-- (или расхождение ответов задумано). Такая пара больше не показывается в списках; её можно вернуть.
-- Пара хранится как два id вопросов в порядке a < b. Видеть и менять может только главный админ (public.is_owner()).
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
create policy "Одобренные пары: просмотр главным админом" on public.duplicate_dismissals
  for select to authenticated using ((select public.is_owner()));
drop policy if exists "Одобренные пары: добавление главным админом" on public.duplicate_dismissals;
create policy "Одобренные пары: добавление главным админом" on public.duplicate_dismissals
  for insert to authenticated with check ((select public.is_owner()));
drop policy if exists "Одобренные пары: удаление главным админом" on public.duplicate_dismissals;
create policy "Одобренные пары: удаление главным админом" on public.duplicate_dismissals
  for delete to authenticated using ((select public.is_owner()));
