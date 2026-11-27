-- Версия 1.12.2. Требует supabase/sql/site_releases.sql. Повторный запуск безопасен.
-- Применять после деплоя сайта.
select public.add_site_release('1.12.2','Проверка бледных бланков',
  jsonb_build_array(
    jsonb_build_object('kind','fixed','scope','app','min_rank',1,'text','Проверка работ: бланк с серыми угловыми метками на тёмном столе теперь находится.'),
    jsonb_build_object('kind','fixed','scope','app','min_rank',1,'text','Проверка работ: ответы, отмеченные бледной штриховкой, читаются и помечаются для проверки.')
  ),
  '2026-11-28 12:00:00+05');
