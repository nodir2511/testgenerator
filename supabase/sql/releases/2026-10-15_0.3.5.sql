-- Версия 0.3.5. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.3.5',
  'Новые лимиты генерации',
  jsonb_build_array(
    jsonb_build_object('kind', 'improved', 'min_rank', 1, 'text', 'Лимиты генерации для обычных пользователей: до 5 наборов в сутки и не чаще одного раза в минуту'),
    jsonb_build_object('kind', 'improved', 'min_rank', 3, 'text', 'У администраторов ограничений на генерацию по-прежнему нет')
  ),
  '2026-10-15 22:00:00+05'
);
