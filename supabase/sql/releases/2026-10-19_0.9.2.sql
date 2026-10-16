-- Версия 0.9.2. Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.9.2',
  'Меню стало короче',
  jsonb_build_array(
    jsonb_build_object('kind', 'improved', 'min_rank', 1, 'text', 'Раздел «Что нового» убран из вкладок — он открывается по значку колокольчика в шапке'),
    jsonb_build_object('kind', 'improved', 'min_rank', 3, 'text', 'Вкладки «Пользователи и аудит» и «Статистика» объединены в «Администрирование»'),
    jsonb_build_object('kind', 'improved', 'min_rank', 4, 'text', '«Своя игра» теперь доступна только главному админу')
  ),
  '2026-10-19 12:00:00+05'
);
