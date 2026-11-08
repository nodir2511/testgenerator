-- Версия 0.55.1. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.55.1',
  'Генератор: удалена панель повтора наборов',
  jsonb_build_array(
    jsonb_build_object('kind', 'improved', 'min_rank', 1, 'text', 'Убрана панель «Собрать заново в одно нажатие» из генератора билетов')
  ),
  '2026-11-11 20:45:00+05'
);
