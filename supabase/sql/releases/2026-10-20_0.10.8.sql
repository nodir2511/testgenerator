-- Версия 0.10.8. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.10.8',
  'Ключи ответов всегда рядом с билетами',
  jsonb_build_array(
    jsonb_build_object('kind', 'improved', 'min_rank', 1, 'text', 'Кнопки RU и TJ у отдельного варианта теперь скачивают архив с вариантом и его ключами ответов')
  ),
  '2026-10-20 12:00:00+05'
);
