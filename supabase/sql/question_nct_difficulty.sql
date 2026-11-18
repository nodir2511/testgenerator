-- Сложность вопроса для экзамена НЦТ: 1 — лёгкий, 2 — средний, 3 — сложный. Необязательная; пока ставится у химии. Повторный запуск безопасен.
alter table public.questions add column if not exists nct_difficulty smallint;
do $$ begin
  alter table public.questions add constraint questions_nct_difficulty_chk check (nct_difficulty is null or nct_difficulty between 1 and 3);
exception when duplicate_object then null; end $$;
create index if not exists questions_nct_difficulty_idx on public.questions (subject_id, nct_difficulty) where nct_difficulty is not null;
