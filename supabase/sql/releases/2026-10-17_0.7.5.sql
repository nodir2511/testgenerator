-- Версия 0.7.5. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.7.5',
  'Своя игра: новый вид проектора',
  jsonb_build_array(
    jsonb_build_object('kind', 'improved', 'min_rank', 3, 'text', 'Проектор оформлен в стиле телеигры: объёмные плитки, сыгранные клетки гаснут, команды — плашками внизу, чья очередь — золотой меткой'),
    jsonb_build_object('kind', 'improved', 'min_rank', 3, 'text', 'В полноэкранном режиме кнопки проектора скрываются; выйти можно клавишей Esc')
  ),
  '2026-10-17 21:00:00+05'
);
