-- Версия 0.26.1. Требует применённого site_releases.sql.
select public.add_site_release(
  '0.26.1',
  'Исправлено окно Telegram на телефоне',
  jsonb_build_array(
    jsonb_build_object('kind','fixed','min_rank',1,'text','Окно «Telegram-бот» на телефоне больше не прячется вверху экрана: оно открывается снизу, и все кнопки в нём нажимаются')
  ),
  '2026-10-26 19:00:00+05'
);
