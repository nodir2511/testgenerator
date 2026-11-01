-- Корзина вопросов: автоматически записывает, кто и когда удалил вопрос (мягкое удаление).
create or replace function public.questions_track_delete()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.is_deleted and not coalesce(old.is_deleted, false) then
    new.deleted_at := coalesce(new.deleted_at, now());
    new.deleted_by := coalesce(auth.uid(), new.deleted_by);
  elsif not new.is_deleted and coalesce(old.is_deleted, false) then
    new.deleted_at := null;
    new.deleted_by := null;
  end if;
  return new;
end $$;

drop trigger if exists questions_track_delete on public.questions;
create trigger questions_track_delete
  before update of is_deleted on public.questions
  for each row execute function public.questions_track_delete();
