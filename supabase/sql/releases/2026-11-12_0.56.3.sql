-- Версия 0.56.3. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.56.3',
  'Бот: выбор глав и тем сообщением',
  jsonb_build_array(
    jsonb_build_object('kind', 'improved', 'min_rank', 1, 'text', 'В чат-боте главы и темы выбираются сообщением с номерами, например 1-4 или 1,2,3,4, без кнопок-номеров')
  ),
  '2026-11-12 04:00:00+05'
);
