-- Версия 0.10.7. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.10.7',
  'Таджикский язык: часть 5',
  jsonb_build_array(
    jsonb_build_object('kind', 'new', 'min_rank', 2, 'text', 'В предмет «Таджикский язык» добавлена часть 5 (Глава 5): 507 вопросов по 12 темам, с ответами; теперь в предмете 2422 вопроса')
  ),
  '2026-10-20 01:00:00+05'
);
