-- Версия 0.7.1. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.7.1',
  'Своя игра: случайные особые клетки',
  jsonb_build_array(
    jsonb_build_object('kind', 'improved', 'min_rank', 3, 'text', 'В каждой новой игре «Кот в мешке» и «Аукцион» попадают на случайные вопросы; где они, ведущий видит в «Листе ведущего»')
  ),
  '2026-10-17 17:00:00+05'
);
