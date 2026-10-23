-- Версия 0.20.3. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.20.3',
  'Плашка номера соединена с линией',
  jsonb_build_array(
    jsonb_build_object('kind','fixed','min_rank',1,'text','В файлах Word серая плашка с номером вопроса теперь примыкает к верхней линии, без белого зазора')
  ),
  '2026-10-24 00:38:00+05'
);
