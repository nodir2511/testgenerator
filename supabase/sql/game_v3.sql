-- «Своя игра» 0.6: разбор игры сохраняется вместе с итогами (для выгрузки в Excel из истории).
-- Применить: supabase db query --linked -f supabase/sql/game_v3.sql. Повторный запуск безопасен.
alter table public.game_results add column if not exists review jsonb;
