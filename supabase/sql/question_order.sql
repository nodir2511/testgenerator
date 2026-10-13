-- Номера вопросов внутри темы (как в сборнике). Можно запускать повторно.
--
-- seq — служебный порядок вставки. num — номер вопроса в теме (1, 2, 3 …):
--  * существующим вопросам проставляется один раз по порядку сборника;
--  * новый вопрос получает следующий номер в своей теме;
--  * при редактировании номер НЕ меняется (защищено триггером);
--  * только при переносе вопроса в другую тему он получает следующий номер в новой теме;
--  * удаление вопроса не сдвигает номера остальных.

alter table public.questions add column if not exists seq bigserial;
alter table public.questions add column if not exists num int;

-- Однократная нумерация тех, у кого номера ещё нет (после уже пронумерованных в теме)
update public.questions q
set num = r.base + r.rn
from (
  select id,
         row_number() over (partition by topic_id order by created_at, seq) as rn,
         coalesce((select max(x.num) from public.questions x where x.topic_id is not distinct from q2.topic_id), 0) as base
  from public.questions q2
  where q2.num is null
) r
where q.id = r.id;

create or replace function public.questions_assign_num()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.topic_id is not distinct from old.topic_id then
      if old.num is not null then
        new.num := old.num;   -- номер не меняется при редактировании
      end if;
      return new;
    end if;
  elsif new.num is not null then
    return new;
  end if;
  -- Новый вопрос или перенос в другую тему: следующий номер в теме
  perform pg_advisory_xact_lock(hashtext(coalesce(new.topic_id::text, '')));
  select coalesce(max(num), 0) + 1 into new.num
  from public.questions
  where topic_id is not distinct from new.topic_id;
  return new;
end;
$$;

drop trigger if exists trg_questions_assign_num on public.questions;
create trigger trg_questions_assign_num
before insert or update on public.questions
for each row execute function public.questions_assign_num();

create index if not exists idx_questions_topic_seq on public.questions (topic_id, seq);
create index if not exists idx_questions_topic_num on public.questions (topic_id, num);
