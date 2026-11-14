-- Версия 0.71.0. Применять после деплоя tg-app.
select public.add_site_release('0.71.0','Шаблоны бланков присылает бот',
  jsonb_build_array(
    jsonb_build_object('kind','improved','scope','app','min_rank',1,'text','В «Взять шаблоны» нажатие на бланк отправляет его PDF прямо в чат с ботом')),
  '2026-11-30 12:00:00+05');
