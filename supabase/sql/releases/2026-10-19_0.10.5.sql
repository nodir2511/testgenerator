-- Версия 0.10.5. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.10.5',
  'Таджикский язык: часть 3',
  jsonb_build_array(
    jsonb_build_object('kind', 'new', 'min_rank', 2, 'text', 'В предмет «Таджикский язык» добавлена часть 3 (Глава 3): 378 вопросов по 14 темам, с ответами; теперь в предмете 1502 вопроса')
  ),
  '2026-10-20 00:10:00+05'
);
