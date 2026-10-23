-- Версия 0.17.0. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.17.0',
  'Быстрее сайт и Telegram',
  jsonb_build_array(
    jsonb_build_object('kind','improved','min_rank',1,'text','Генератор билетов на сайте, Telegram-приложение и бот работают заметно быстрее: пул вопросов, предметы, главы и темы считаются почти мгновенно')
  ),
  '2026-10-23 21:00:00+05'
);
