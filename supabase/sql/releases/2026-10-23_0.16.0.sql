-- Версия 0.16.0. Требует применённого site_releases.sql (колонка subject_id).
select public.add_site_release(
  '0.16.0',
  'Обновления по предметам',
  jsonb_build_array(
    jsonb_build_object('kind','improved','min_rank',4,'text','В «Что нового» пункт можно привязать к предмету: его увидят только преподаватели и администраторы этого предмета')
  ),
  '2026-10-23 20:00:00+05'
);
