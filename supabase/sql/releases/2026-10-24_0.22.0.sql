-- Версия 0.22.0. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.22.0',
  'Полное обновление интерфейса Telegram Mini App',
  jsonb_build_array(
    jsonb_build_object('kind','new','min_rank',1,'subject',null,'text','В Telegram Mini App добавлен пошаговый навигатор с прогресс-баром (Шаг 1 из 4)'),
    jsonb_build_object('kind','new','min_rank',1,'subject',null,'text','Добавлены быстрые пресеты стандартов предметов (Физ/Хим 18+2+7, Био/Гос 20+4+2) прямо в Telegram в 1 тап'),
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','Интерфейс переведён на нативный дизайн в стиле iOS и Telegram с эмодзи-иконками предметов и скруглениями карточек'),
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','Добавлен тактильный отклик (Haptic Feedback) на клики по степперам, чекбоксам и пресетам'),
    jsonb_build_object('kind','new','min_rank',1,'subject',null,'text','Индикатор светофора (Traffic Light) теперь работает и в Telegram, показывая запас вопросов до генерации'),
    jsonb_build_object('kind','new','min_rank',1,'subject',null,'text','Создан новый экран успешной отправки с карточкой итогов и кнопкой перехода в чат')
  ),
  '2026-10-24 02:10:00+05'
);
