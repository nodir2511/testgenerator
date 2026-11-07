-- Версия 0.36.1. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.36.1',
  'Название экзамена в ключах и кнопка «Генерировать»',
  jsonb_build_array(
    jsonb_build_object('kind','improved','min_rank',1,'text','В шапке ключей ответов теперь стоит название экзамена, которое вы дали набору, а не список тем'),
    jsonb_build_object('kind','improved','min_rank',1,'text','Кнопка создания билетов теперь всегда называется «Генерировать»')
  ),
  '2026-11-07 23:59:00+05'
);
