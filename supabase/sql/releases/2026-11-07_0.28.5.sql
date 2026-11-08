-- Версия 0.28.5. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.28.5',
  'Кнопки «Далее» и «Назад» в Telegram',
  jsonb_build_array(
    jsonb_build_object('kind','fixed','min_rank',1,'text','В конструкторе билетов в Telegram снова работают нижняя кнопка «Далее» и кнопка «Назад»')
  ),
  '2026-11-07 19:00:00+05'
);
