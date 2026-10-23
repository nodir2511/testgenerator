-- Версия 0.23.3. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.23.3',
  'Улучшение запуска Mini App и меню Telegram-бота',
  jsonb_build_array(
    jsonb_build_object('kind','fixed','min_rank',1,'subject',null,'text','Исправлена ошибка входа в конструктор билетов: приложение теперь мгновенно открывается по синей кнопке меню и из чата на телефонах и компьютерах'),
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','В Telegram-боте закреплена постоянная кнопка «Конструктор» прямо в поле ввода сообщений для быстрого запуска в один клик'),
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','Обновлена клавиатура команд бота с подсказками и понятным экраном перенаправления при прямом открытии ссылки')
  ),
  '2026-10-24 03:06:00+05'
);
