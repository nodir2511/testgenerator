-- Версия 0.56.2. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.56.2',
  'Мини-приложение в стиле сайта',
  jsonb_build_array(
    jsonb_build_object('kind', 'improved', 'min_rank', 1, 'text', 'Мини-приложение в Telegram получило те же шрифт, цвета и карточки, что и сайт, в светлой и тёмной теме')
  ),
  '2026-11-12 03:30:00+05'
);
