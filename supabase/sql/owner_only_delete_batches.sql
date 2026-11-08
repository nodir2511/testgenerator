-- Удалять созданные билеты (наборы) может только главный админ.
drop policy if exists "Удаление партий билетов" on public.ticket_batches;
create policy "Удаление партий билетов" on public.ticket_batches
  for delete to authenticated
  using (public.is_owner());
