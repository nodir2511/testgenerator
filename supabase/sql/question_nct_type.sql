-- Метка типа задания НЦТ у вопроса (список кодов — src/lib/nctTypes.ts). Необязательная; повторный запуск безопасен.
alter table public.questions add column if not exists nct_type text;
create index if not exists questions_nct_type_idx on public.questions (subject_id, nct_type) where nct_type is not null;
