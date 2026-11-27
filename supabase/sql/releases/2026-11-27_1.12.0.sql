-- Версия 1.12.0. Требует supabase/sql/site_releases.sql. Повторный запуск безопасен.
-- Применять после деплоя сайта.
select public.add_site_release('1.12.0','Чтение рукописных цифр',
  jsonb_build_array(
    jsonb_build_object('kind','improved','scope','app','min_rank',1,'text','Проверка работ: рукописные цифры в открытых ответах читаются заметно точнее.')
  ),
  '2026-11-27 09:30:00+05');
