-- Версия 0.21.0. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.21.0',
  'Редизайн интерфейса: стиль Modern EdTech / Bento и мобильная версия',
  jsonb_build_array(
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','Сайт полностью адаптирован под смартфоны: добавлена удобная нижняя панель навигации под большой палец и учёт вырезов экрана (Safe Area)'),
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','В банке вопросов на смартфонах фильтры компактно свернуты в удобную всплывающую шторку с быстрым переключением типов вопросов'),
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','В конструкторе билетов добавлены сенсорные кнопки быстрого изменения количества вопросов (+ / −) и готовые пресеты числа вариантов'),
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','Интерфейс переведён на современный минималистичный дизайн в стиле Bento Grid со шрифтом Plus Jakarta Sans и мягкими карточками')
  ),
  '2026-10-24 01:35:00+05'
);
