-- Версия 0.10.4. Требует supabase/sql/site_releases.sql.
-- Формат пунктов: kind = new | fixed | improved, min_rank: 1 все, 2 админы по предметам и выше, 3 админы, 4 главный админ.
select public.add_site_release(
  '0.10.4',
  'Telegram-бот на телефоне',
  jsonb_build_array(
    jsonb_build_object('kind', 'fixed', 'min_rank', 1, 'text', 'На телефоне в шапке сайта появилась кнопка Telegram-бота: через неё можно получить код и привязать аккаунт'),
    jsonb_build_object('kind', 'fixed', 'min_rank', 2, 'text', 'Бот присылает одиночный билет на одном языке архивом вместе с ключом ответов')
  ),
  '2026-10-19 23:59:00+05'
);
