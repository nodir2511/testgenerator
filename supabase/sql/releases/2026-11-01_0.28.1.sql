-- Версия 0.28.1. Требует применённых site_releases.sql и security_round3.sql.
select public.add_site_release(
  '0.28.1',
  'Быстрее на телефоне',
  jsonb_build_array(
    jsonb_build_object('kind','improved','min_rank',1,'text','Сайт быстрее открывается на телефоне: шрифты больше не задерживают показ страницы, а картинки в списке вопросов подгружаются по мере прокрутки'),
    jsonb_build_object('kind','improved','min_rank',1,'text','Окна и кнопки закрытия лучше читаются экранными помощниками, а серый текст стал контрастнее')
  ),
  '2026-11-01 15:00:00+05'
);
