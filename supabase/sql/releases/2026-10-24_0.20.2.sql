-- Версия 0.20.2. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.20.2',
  'Ровная плашка с номером вопроса',
  jsonb_build_array(
    jsonb_build_object('kind','fixed','min_rank',1,'text','В файлах Word серая плашка с номером вопроса теперь закрашена без белых зазоров')
  ),
  '2026-10-24 17:00:00+05'
);
