-- Версия 0.7.2. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.7.2',
  'Своя игра: крупная кнопка старта',
  jsonb_build_array(
    jsonb_build_object('kind', 'improved', 'min_rank', 3, 'text', 'В окне вопроса большая зелёная кнопка «Старт» по центру; «Показать ответ» появляется под ней, когда кто-то ответил или время вышло')
  ),
  '2026-10-17 18:00:00+05'
);
