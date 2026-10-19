-- Версия 0.10.3. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.10.3',
  'Ключи в архиве на одном языке',
  jsonb_build_array(
    jsonb_build_object('kind', 'fixed', 'min_rank', 2, 'text', 'При скачивании билетов только на одном языке ключ ответов теперь тоже кладётся в архив, как и при скачивании на двух языках')
  ),
  '2026-10-19 23:45:00+05'
);
