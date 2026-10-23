-- Скрипт исправления дат и добавления недостающих релизов в Supabase
-- Выполните этот скрипт в Supabase SQL Editor: https://supabase.com/dashboard/project/ovxrgkyexuudgtqglegk/sql

-- 1. Исправляем время для релизов 0.20.0 - 0.20.4 (было ошибочно указано дневное/вечернее время 12:00 - 23:00)
update public.site_releases set released_at = '2026-10-24 00:15:00+05' where version = '0.20.0';
update public.site_releases set released_at = '2026-10-24 00:27:00+05' where version = '0.20.1';
update public.site_releases set released_at = '2026-10-24 00:32:00+05' where version = '0.20.2';
update public.site_releases set released_at = '2026-10-24 00:38:00+05' where version = '0.20.3';
update public.site_releases set released_at = '2026-10-24 00:52:00+05' where version = '0.20.4';

-- 2. Добавляем недостающий релиз 0.21.1
select public.add_site_release(
  '0.21.1',
  'Быстрые стандарты предметов в конструкторе билетов',
  jsonb_build_array(
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','В конструкторе билетов добавлены быстрые пресеты предметов: выбор Физики и Химии автоматически выставляет 18 тестов, 2 соответствия и 7 открытых вопросов'),
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','Выбор Биологии или Государственного экзамена (Таджикский язык) в 1 клик выставляет 20 тестов, 4 соответствия и 2 открытых вопроса')
  ),
  '2026-10-24 01:45:00+05'
);

-- 3. Добавляем недостающий релиз 0.23.1
select public.add_site_release(
  '0.23.1',
  'Исправление генерации в «Экзамене кластера»',
  jsonb_build_array(
    jsonb_build_object('kind','fixed','min_rank',4,'subject',null,'text','Исправлена ошибка блокировки генерации при выборе даты экзамена кластера: дата автоматически подставляется на обложку в формате ДД.ММ'),
    jsonb_build_object('kind','improved','min_rank',4,'subject',null,'text','Добавлена подсветка незаполненных предметов субтестов и подробные понятные сообщения об ошибках с указанием конкретного предмета')
  ),
  '2026-10-24 02:27:00+05'
);

-- 4. Добавляем релиз 0.23.2
select public.add_site_release(
  '0.23.2',
  'Исправление порядка отображения истории обновлений',
  jsonb_build_array(
    jsonb_build_object('kind','fixed','min_rank',1,'subject',null,'text','Исправлен порядок списка обновлений: новые версии всегда отображаются вверху списка по семантической версии (SemVer)'),
    jsonb_build_object('kind','improved','min_rank',1,'subject',null,'text','Синхронизированы даты и время выпуска ночных релизов для корректного отображения на компьютерах и смартфонах')
  ),
  '2026-10-24 02:45:00+05'
);

-- 5. Проверка результата
select version, title, released_at from public.site_releases order by released_at desc limit 15;
