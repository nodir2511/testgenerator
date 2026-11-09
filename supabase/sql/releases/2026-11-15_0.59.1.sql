-- Версия 0.59.1. Требует supabase/sql/duplicate_dismissals.sql. Только для главного админа (min_rank 4).
select public.add_site_release(
  '0.59.1',
  'Одобрение пар в «Качестве банка»',
  jsonb_build_array(
    jsonb_build_object('kind', 'new', 'scope', 'site', 'min_rank', 4, 'text', 'В «Качестве банка» похожую пару вопросов можно одобрить кнопкой «Не дубль»: она пропадает из списка, а в разделе «Одобренные» её можно вернуть')
  ),
  '2026-11-15 06:00:00+05'
);
