-- Версия 1.11.1. Требует supabase/sql/site_releases.sql. Повторный запуск безопасен.
-- Применять после деплоя сайта.
select public.add_site_release('1.11.1','Проверка изогнутых бланков',
  jsonb_build_array(
    jsonb_build_object('kind','fixed','scope','app','min_rank',1,'text','Проверка работ: на прогнутом бланке соответствия больше не читаются со сдвигом.')
  ),
  '2026-11-26 19:30:00+05');
