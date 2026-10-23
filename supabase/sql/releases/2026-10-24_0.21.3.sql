-- Версия 0.21.3. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.21.3',
  'Оптимизация выбора количества вариантов для пользователей',
  jsonb_build_array(
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','Для обычных пользователей быстрый выбор вариантов ограничен значениями 1, 2 и 4 в соответствии с лимитами генерации'),
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','В Telegram Mini App добавлены быстрые чипсы выбора вариантов с тактильным откликом Haptic Feedback')
  ),
  '2026-10-24 02:05:00+05'
);
