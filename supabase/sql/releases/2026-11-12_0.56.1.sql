-- Версия 0.56.1. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.56.1',
  'Мини-приложение: обновлено оформление',
  jsonb_build_array(
    jsonb_build_object('kind', 'improved', 'min_rank', 1, 'text', 'Мини-приложение в Telegram стало чище и аккуратнее: тонкие рамки, ровные карточки и плавная смена шагов')
  ),
  '2026-11-12 03:00:00+05'
);
