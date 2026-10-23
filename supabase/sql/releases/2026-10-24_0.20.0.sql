-- Версия 0.20.0. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.20.0',
  'Ещё быстрее',
  jsonb_build_array(
    jsonb_build_object('kind','improved','min_rank',1,'text','Список вопросов, генератор билетов и экспорт открываются и работают заметно быстрее')
  ),
  '2026-10-24 12:00:00+05'
);
