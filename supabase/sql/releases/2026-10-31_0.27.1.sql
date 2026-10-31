-- Версия 0.27.1. Требует применённых site_releases.sql и security_round3.sql.
select public.add_site_release(
  '0.27.1',
  'Надёжность импорта',
  jsonb_build_array(
    jsonb_build_object('kind','improved','min_rank',2,'text','Загрузка вопросов из Excel и выгрузка шаблона и результатов игры стали безопаснее и работают на обновлённой библиотеке')
  ),
  '2026-10-31 12:00:00+05'
);
