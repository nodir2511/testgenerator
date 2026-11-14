-- Картинки цифр из клеток открытых вопросов (14×14, base64) — для подсказок «цифра с первого взгляда».
-- Имён и фото бланков здесь нет: только маленькая картинка одной цифры и её метка. Пишет и читает только tg-app (service role).
create table if not exists public.omr_digit_samples (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  digit smallint not null check (digit between 0 and 9),
  px text not null check (length(px) = 264),
  layout text
);

create index if not exists omr_digit_samples_digit_id_idx on public.omr_digit_samples (digit, id desc);
create index if not exists omr_digit_samples_user_time_idx on public.omr_digit_samples (user_id, created_at desc);

alter table public.omr_digit_samples enable row level security;
revoke all on public.omr_digit_samples from anon, authenticated;
