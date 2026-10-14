-- Версия 0.3.1. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.3.1',
  'Кластер: выбор тем и предметов, быстрее подбор; вопросы в Word',
  jsonb_build_array(
    jsonb_build_object('kind', 'new',      'min_rank', 4, 'text', 'В экзамене-кластере можно выбрать любое число предметов (от 1 до 4) и темы для каждого предмета'),
    jsonb_build_object('kind', 'improved', 'min_rank', 4, 'text', 'Кластер создаётся быстрее, а скачивание архива — отдельной кнопкой после создания'),
    jsonb_build_object('kind', 'improved', 'min_rank', 4, 'text', 'В книжках кластера по химии и физике внизу страниц оставлено свободное место под черновик'),
    jsonb_build_object('kind', 'improved', 'min_rank', 1, 'text', 'В Word-файлах номер вопроса стоит на серой плашке в одну строку, а картинки в вопросах стали крупнее')
  ),
  '2026-10-15 12:00:00+05'
);
