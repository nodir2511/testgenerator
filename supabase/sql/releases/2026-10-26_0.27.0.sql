-- Версия 0.27.0. Требует применённых site_releases.sql и security_round3.sql.
select public.add_site_release(
  '0.27.0',
  'Безопасность аккаунтов',
  jsonb_build_array(
    jsonb_build_object('kind','new','min_rank',1,'text','Если пароль для входа задал администратор, при входе сайт попросит придумать свой: не короче 9 символов, с буквами и цифрами'),
    jsonb_build_object('kind','improved','min_rank',1,'text','Почту и роли других пользователей теперь видят только администраторы'),
    jsonb_build_object('kind','improved','min_rank',1,'text','Сайт защищён от встраивания в чужие страницы и загрузки посторонних скриптов'),
    jsonb_build_object('kind','improved','min_rank',1,'text','Сообщения об ошибках стали понятнее и больше не показывают служебных подробностей'),
    jsonb_build_object('kind','fixed','min_rank',1,'text','Telegram-бот повторяет только ваши собственные наборы билетов'),
    jsonb_build_object('kind','improved','min_rank',3,'text','Назначать и снимать администраторов, менять их данные и пароли может только главный администратор'),
    jsonb_build_object('kind','improved','min_rank',3,'text','Самостоятельная регистрация закрыта: аккаунты создаются только в разделе «Пользователи»'),
    jsonb_build_object('kind','improved','min_rank',3,'text','Смены ролей и предметов записываются в журнал действий автоматически, подделать записи журнала нельзя')
  ),
  '2026-10-26 21:00:00+05'
);
