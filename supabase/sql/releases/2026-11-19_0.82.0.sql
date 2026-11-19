-- Версия 0.82.0. Повторный запуск безопасен.
select public.add_site_release('0.82.0','НЦТ: история, право, математика; бланки на 5 клеток',
  jsonb_build_array(
    jsonb_build_object('kind','improved','scope','app','min_rank',1,'text','Бланки ответов по таджикскому и английскому языкам обновлены на 5 клеток.'),
    jsonb_build_object('kind','new','scope','site','min_rank',1,'text','В редакторе вопросов добавлена функция «Цифра над словом» для разметки на сайте и в Word.'),
    jsonb_build_object('kind','new','scope','site','min_rank',1,'text','Математика: добавлены сборники 1–4 (~2200 заданий).'),
    jsonb_build_object('kind','new','scope','site','min_rank',1,'text','Математика: добавлены задания НЦТ 2022–2026 (~750 заданий).'),
    jsonb_build_object('kind','new','scope','site','min_rank',2,'text','История: добавлен сборник ЦВЭ 2026 (506 заданий).'),
    jsonb_build_object('kind','new','scope','site','min_rank',2,'text','История: добавлены экзамены 2022–2026 (74 задания).'),
    jsonb_build_object('kind','new','scope','site','min_rank',2,'text','Право: добавлен сборник ЦВЭ 2026 (310 заданий).'),
    jsonb_build_object('kind','new','scope','site','min_rank',2,'text','Право: добавлены экзамены 2022–2026 (46 заданий).'),
    jsonb_build_object('kind','new','scope','site','min_rank',4,'text','Математика: добавлен режим билетов по формату НЦТ.'),
    jsonb_build_object('kind','new','scope','site','min_rank',4,'text','История: добавлен режим билетов по формату НЦТ.'),
    jsonb_build_object('kind','new','scope','site','min_rank',4,'text','История: добавлена разметка и фильтр по типам заданий НЦТ.'),
    jsonb_build_object('kind','new','scope','site','min_rank',4,'text','Право: добавлен режим билетов по формату НЦТ.'),
    jsonb_build_object('kind','new','scope','site','min_rank',4,'text','Право: добавлена разметка и фильтр по типам заданий НЦТ.'),
    jsonb_build_object('kind','new','scope','site','min_rank',4,'text','Право: добавлены темы глав 6–10 тематического плана.')
  ),
  '2026-11-19 23:55:00+05');
