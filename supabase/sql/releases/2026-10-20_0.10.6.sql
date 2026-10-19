-- Версия 0.10.6. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.10.6',
  'Таджикский язык: часть 4',
  jsonb_build_array(
    jsonb_build_object('kind', 'new', 'min_rank', 2, 'text', 'В предмет «Таджикский язык» добавлена часть 4 (Глава 4): 413 вопросов по 10 темам, с ответами; теперь в предмете 1915 вопросов')
  ),
  '2026-10-20 00:30:00+05'
);
