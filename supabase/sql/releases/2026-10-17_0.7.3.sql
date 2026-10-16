-- Версия 0.7.3. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.7.3',
  'Своя игра: обновлены вопросы',
  jsonb_build_array(
    jsonb_build_object('kind', 'improved', 'min_rank', 3, 'text', 'В «Своей игре» новые вопросы и ответы: два уровня по шесть тем, на русском и таджикском')
  ),
  '2026-10-17 19:00:00+05'
);
