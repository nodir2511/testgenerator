-- Версия 0.28.0. Требует применённых site_releases.sql, security_round3.sql и trash.sql.
select public.add_site_release(
  '0.28.0',
  'Корзина и запас вопросов',
  jsonb_build_array(
    jsonb_build_object('kind','new','min_rank',3,'text','В разделе «Администрирование» появилась «Корзина»: видно, кто и когда удалил вопрос, и его можно вернуть'),
    jsonb_build_object('kind','improved','min_rank',1,'text','Генератор предупреждает, если вопросов в выбранных темах не хватает на все варианты и часть повторится'),
    jsonb_build_object('kind','improved','min_rank',1,'text','Страницу на телефоне теперь можно увеличивать щипком')
  ),
  '2026-11-01 12:00:00+05'
);
