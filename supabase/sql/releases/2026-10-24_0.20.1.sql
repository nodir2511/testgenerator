-- Версия 0.20.1. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.20.1',
  'Меньше пустого места между вопросами',
  jsonb_build_array(
    jsonb_build_object('kind','improved','min_rank',1,'text','В файлах Word между вопросами стало меньше пустого места, на странице помещается больше вопросов')
  ),
  '2026-10-24 15:00:00+05'
);
