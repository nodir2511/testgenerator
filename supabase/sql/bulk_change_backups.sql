-- Журнал отката разовых массовых правок банка вопросов (связывание дублей, исправление переводов, правка ключей).
-- Таблица была создана в живой базе вручную 9 ноября 2026 года вместе с первыми такими правками; этот файл
-- описывает её, чтобы схема в репозитории совпадала с базой. Скрипт массовой правки перед изменением
-- кладёт сюда прежние значения: kind — что за правка, payload — данные для отката.
-- С сайта, из бота и мини-приложения таблица недоступна: RLS включён, политик нет, прав у ролей API нет.
-- Пишет и читает только сервисный ключ или SQL Editor. Повторный запуск безопасен.
-- Применить: supabase db query --linked -f supabase/sql/bulk_change_backups.sql

create table if not exists public.bulk_change_backups (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind       text not null,
  payload    jsonb not null
);

alter table public.bulk_change_backups enable row level security;
revoke all on public.bulk_change_backups from anon, authenticated;
