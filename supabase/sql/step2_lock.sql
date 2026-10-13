-- Шаг 2: Включение защиты RLS обратно после загрузки (8 строк)
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_questions ENABLE ROW LEVEL SECURITY;
