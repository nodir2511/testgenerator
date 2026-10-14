-- Версия 0.3.3. Требует supabase/sql/site_releases.sql и supabase/sql/cluster_batches.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.3.3',
  'Кластер: сохранение в архив',
  jsonb_build_array(
    jsonb_build_object('kind', 'new',      'min_rank', 4, 'text', 'Созданный экзамен-кластер сохраняется в «Сохраненных билетах»: его можно скачать повторно (книжки на двух языках и ключи одним архивом)'),
    jsonb_build_object('kind', 'improved', 'min_rank', 4, 'text', 'Сохранённые экзамены-кластеры видит и удаляет только главный админ')
  ),
  '2026-10-15 18:00:00+05'
);
