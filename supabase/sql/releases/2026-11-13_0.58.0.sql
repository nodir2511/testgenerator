-- Версия 0.58.0. Требует supabase/sql/question_usage.sql.
select public.add_site_release(
  '0.58.0',
  'Раздел «Подборы»',
  jsonb_build_array(
    jsonb_build_object('kind', 'new', 'scope', 'site', 'min_rank', 4, 'text', 'Появился раздел «Подборы»: видно, как часто вопросы попадают в билеты, какие темы перегружены, а какие пустуют, и какие вопросы ни разу не использовались')
  ),
  '2026-11-13 06:00:00+05'
);
