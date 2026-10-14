-- Экзамены-кластеры хранятся как обычные партии билетов (generation_params.source = 'cluster'),
-- но видеть, создавать и удалять их может только главный админ (public.is_owner()).
-- Применено: supabase db query --linked -f supabase/sql/cluster_batches.sql

create or replace function public.is_cluster_batch(p jsonb)
returns boolean
language sql
immutable
as $$ select coalesce(p->>'source', '') = 'cluster' $$;

-- Просмотр: владелец — все партии, остальные — только свои и не кластерные
drop policy if exists "Просмотр партий билетов" on public.ticket_batches;
create policy "Просмотр партий билетов" on public.ticket_batches
  for select to authenticated
  using (public.is_owner() or (created_by = auth.uid() and not public.is_cluster_batch(generation_params)));

drop policy if exists "Просмотр билетов" on public.tickets;
create policy "Просмотр билетов" on public.tickets
  for select to authenticated
  using (exists (
    select 1 from public.ticket_batches b
    where b.id = batch_id and (public.is_owner() or (b.created_by = auth.uid() and not public.is_cluster_batch(b.generation_params)))
  ));

drop policy if exists "Просмотр вопросов в билетах" on public.ticket_questions;
create policy "Просмотр вопросов в билетах" on public.ticket_questions
  for select to authenticated
  using (exists (
    select 1 from public.tickets t join public.ticket_batches b on b.id = t.batch_id
    where t.id = ticket_id and (public.is_owner() or (b.created_by = auth.uid() and not public.is_cluster_batch(b.generation_params)))
  ));

-- Создание кластерной партии — только главный админ
drop policy if exists "Создание партий билетов" on public.ticket_batches;
create policy "Создание партий билетов" on public.ticket_batches
  for insert to authenticated
  with check (created_by = auth.uid() and (not public.is_cluster_batch(generation_params) or public.is_owner()));

-- Удаление кластерной партии — только главный админ
drop policy if exists "Удаление партий билетов" on public.ticket_batches;
create policy "Удаление партий билетов" on public.ticket_batches
  for delete to authenticated
  using ((public.is_admin() or created_by = auth.uid()) and (not public.is_cluster_batch(generation_params) or public.is_owner()));
