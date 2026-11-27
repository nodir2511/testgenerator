-- Версия 1.12.1. Требует supabase/sql/site_releases.sql. Повторный запуск безопасен.
-- Применять после деплоя сайта.
select public.add_site_release('1.12.1','Проверка согнутых бланков',
  jsonb_build_array(
    jsonb_build_object('kind','fixed','scope','app','min_rank',1,'text','Проверка работ: бланк, согнутый посередине, теперь принимается и читается без сдвига.')
  ),
  '2026-11-27 19:10:00+05');
