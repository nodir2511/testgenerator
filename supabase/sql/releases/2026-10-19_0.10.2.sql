-- Версия 0.10.2. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.10.2',
  'Таджикский язык: часть 2',
  jsonb_build_array(
    jsonb_build_object('kind', 'new', 'min_rank', 2, 'text', 'В предмет «Таджикский язык» добавлена часть 2 (Глава 2): 358 вопросов по 11 темам, с ответами; теперь в предмете 1124 вопроса')
  ),
  '2026-10-19 23:30:00+05'
);
