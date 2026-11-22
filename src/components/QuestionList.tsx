import React, { useState } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDialog } from '../hooks/useDialog';
import { supabase } from '../lib/supabase';
import { assertRowsChanged, withUndo } from '../lib/errors';
import { Question, QuestionType, Subject, Chapter, Topic, Passage } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { FormattedText } from './FormulaEditor';
import { questionIssues, ISSUE_LABELS, ISSUE_FILTER_LABELS, IssueFilter } from '../lib/questionIssues';
import { CustomSelect } from './CustomSelect';
import { 
  Search, 
  Filter, 
  Edit3, 
  Trash2, 
  FileText, 
  Layers, 
  HelpCircle, 
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  X,
  RotateCcw,
  SlidersHorizontal,
  Check
} from 'lucide-react';
import { nctTypesFor, nctTypeName } from '../lib/nctTypes';
import { NCT_DIFFICULTIES, nctDifficultyName } from '../lib/nctDifficulty';
import { Badge, Button, Card, EmptyState, Field, IconButton, Skeleton } from './ui';
import { PassageEditor } from './PassageEditor';
import { fetchPassages, fetchPassagesByIds, passageLabel } from '../lib/passages';

interface QuestionListProps {
  onAddQuestion: () => void;
  onEditQuestion: (q: Question) => void;
}

const PAGE_SIZE = 15;

export const QuestionList: React.FC<QuestionListProps> = ({
  onAddQuestion,
  onEditQuestion,
}) => {
  const queryClient = useQueryClient();
  const { isStaff, canManage, isOwner } = useAuth();
  const [filterNct, setFilterNct] = useState<string>('all');
  const [filterDiff, setFilterDiff] = useState<string>('all');
  // Фильтр «Текст» (английский): all — любой, none — вопросы без текста, иначе id текста
  const [filterPassage, setFilterPassage] = useState<string>('all');
  const [editPassage, setEditPassage] = useState<Passage | null>(null);
  const [newPassageOpen, setNewPassageOpen] = useState(false);

  // Фильтры (с сохранением в localStorage)
  const [filterSubjectId, setFilterSubjectId] = useState(() => localStorage.getItem('examiner_ql_subject_id') || '');
  const [filterChapterId, setFilterChapterId] = useState(() => localStorage.getItem('examiner_ql_chapter_id') || '');
  const [filterTopicId, setFilterTopicId] = useState(() => localStorage.getItem('examiner_ql_topic_id') || '');
  const [filterType, setFilterType] = useState<string>(() => localStorage.getItem('examiner_ql_type') || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterIssue, setFilterIssue] = useState<IssueFilter>('all');
  // page — первая показанная страница, extra — сколько страниц подгружено ниже кнопкой «Показать ещё»
  const [page, setPage] = useState(0);
  const [extra, setExtra] = useState(0);
  const [jumpTo, setJumpTo] = useState('');
  const [displayLang, setDisplayLang] = useState<'ru' | 'tg' | 'both'>(
    () => (localStorage.getItem('examiner_ql_display_lang') as 'ru' | 'tg' | 'both') || 'ru'
  );
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const filterSheet = React.useRef<HTMLDivElement>(null);
  useDialog(filterSheet, () => setIsFilterSheetOpen(false), isFilterSheetOpen);

  const activeFiltersCount = 
    (filterSubjectId ? 1 : 0) + 
    (filterChapterId ? 1 : 0) + 
    (filterTopicId ? 1 : 0) + 
    (filterIssue !== 'all' ? 1 : 0);

  React.useEffect(() => {
    localStorage.setItem('examiner_ql_subject_id', filterSubjectId);
  }, [filterSubjectId]);

  React.useEffect(() => {
    localStorage.setItem('examiner_ql_chapter_id', filterChapterId);
  }, [filterChapterId]);

  React.useEffect(() => {
    localStorage.setItem('examiner_ql_topic_id', filterTopicId);
  }, [filterTopicId]);

  React.useEffect(() => {
    localStorage.setItem('examiner_ql_type', filterType);
  }, [filterType]);

  React.useEffect(() => {
    localStorage.setItem('examiner_ql_display_lang', displayLang);
  }, [displayLang]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewImage(null);
    };
    if (previewImage) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [previewImage]);

  // Таксономия для фильтров
  const { data: subjects = [], isSuccess: subjectsLoaded } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      if (error) throw error; // ошибку показываем, а не выдаём за пустой список
      return (data || []) as Subject[];
    },
  });

  const { data: chapters = [], isSuccess: chaptersLoaded } = useQuery({
    queryKey: ['chapters', filterSubjectId],
    enabled: Boolean(filterSubjectId),
    queryFn: async () => {
      const { data, error } = await supabase.from('chapters').select('*').eq('subject_id', filterSubjectId).eq('is_deleted', false).order('order_index');
      if (error) throw error; // ошибку показываем, а не выдаём за пустой список
      return (data || []) as Chapter[];
    },
  });

  const { data: topics = [], isSuccess: topicsLoaded } = useQuery({
    queryKey: ['topics', filterChapterId],
    enabled: Boolean(filterChapterId),
    queryFn: async () => {
      const { data, error } = await supabase.from('topics').select('*').eq('chapter_id', filterChapterId).eq('is_deleted', false).order('order_index');
      if (error) throw error; // ошибку показываем, а не выдаём за пустой список
      return (data || []) as Topic[];
    },
  });

  // Запомненный в браузере фильтр мог указывать на удалённый или недоступный предмет, главу, тему:
  // сбрасываем его, иначе банк открывается пустым с пустым полем выбора
  React.useEffect(() => {
    if (filterSubjectId && subjectsLoaded && !subjects.some((s) => s.id === filterSubjectId)) { setFilterSubjectId(''); setFilterChapterId(''); setFilterTopicId(''); }
    else if (filterChapterId && filterSubjectId && chaptersLoaded && !chapters.some((c) => c.id === filterChapterId)) { setFilterChapterId(''); setFilterTopicId(''); }
    else if (filterTopicId && filterChapterId && topicsLoaded && !topics.some((t) => t.id === filterTopicId)) setFilterTopicId('');
  }, [filterSubjectId, filterChapterId, filterTopicId, subjects, chapters, topics, subjectsLoaded, chaptersLoaded, topicsLoaded]);

  // Тексты выбранной темы (английский); без таблицы или без текстов фильтр «Текст» не показывается
  const { data: topicPassages = [] } = useQuery({
    queryKey: ['passages', filterTopicId],
    enabled: Boolean(filterTopicId),
    queryFn: () => fetchPassages(filterTopicId),
  });
  // Выбранный текст действует, только пока он есть в теме
  const activePassage = filterTopicId && topicPassages.length > 0
    && (filterPassage === 'none' || topicPassages.some((p) => p.id === filterPassage))
    ? filterPassage : 'all';

  // «Добавить текст» — только английский и только когда выбрана тема
  const canAddPassage = isStaff && Boolean(filterSubjectId && filterChapterId && filterTopicId)
    && /англ|инглис|english/i.test((subjects as any[]).find((x: any) => x.id === filterSubjectId)?.name || '');

  const applyFilters = (query: any) => {
    if (filterSubjectId) query = query.eq('subject_id', filterSubjectId);
    if (filterChapterId) query = query.eq('chapter_id', filterChapterId);
    if (filterTopicId) query = query.eq('topic_id', filterTopicId);
    if (filterType !== 'all') query = query.eq('type', filterType);
    if (activePassage === 'none') query = query.is('passage_id', null);
    else if (activePassage !== 'all') query = query.eq('passage_id', activePassage);
    if (isOwner && filterNct === 'none') query = query.is('nct_type', null);
    else if (isOwner && filterNct !== 'all') query = query.eq('nct_type', filterNct);
    if (isOwner && filterDiff === 'none') query = query.is('nct_difficulty', null);
    else if (isOwner && filterDiff !== 'all') query = query.eq('nct_difficulty', Number(filterDiff));
    if (searchQuery.trim()) {
      // Значение берём в кавычки и экранируем: запятые, скобки, % и _ в запросе не ломают фильтр
      const like = '%' + searchQuery.trim().replace(/[\\%_]/g, '\\$&') + '%';
      const quoted = '"' + like.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
      query = query.or(`content.ilike.${quoted},content_ru.ilike.${quoted},content_tg.ilike.${quoted}`);
    }
    return query;
  };

  const FULL_SELECT = `
    *,
    chapter:chapters(name),
    topic:topics(name),
    source:sources(name),
    options:question_options(*),
    matching_items:matching_items(*)
  `;

  // Источник строк: вся таблица вопросов или, при фильтре «проблемы», функция базы questions_with_issue
  // (проверка «число вариантов» и «верный ответ» идёт в базе; раньше для неё скачивались все вопросы под фильтрами).
  // Пустые параметры не передаём: в адресе запроса null стал бы строкой.
  const questionSource = () => {
    if (filterIssue === 'all') return supabase.from('questions').select(FULL_SELECT, { count: 'exact' });
    const args: Record<string, string> = { p_issue: filterIssue };
    if (filterSubjectId) args.p_subject_id = filterSubjectId;
    if (filterChapterId) args.p_chapter_id = filterChapterId;
    if (filterTopicId) args.p_topic_id = filterTopicId;
    return supabase.rpc('questions_with_issue', args, { get: true, count: 'exact' }).select(FULL_SELECT);
  };

  // Запрос одной страницы вопросов с фильтрацией на сервере
  const fetchPage = async (pageNo: number) => {
      const build = (byNum: boolean) => {
        let query: any = questionSource().eq('is_deleted', false);
        // В выбранной теме — по номерам вопросов, иначе — новые сверху
        query = byNum
          ? query.order('num', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true }).order('id')
          : query.order('created_at', { ascending: false }).order('id');
        query = query.range(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE - 1);

        return applyFilters(query);
      };

      let { data, count, error } = await build(Boolean(filterTopicId));
      // Колонки num ещё нет (не выполнен question_order.sql) — сортируем по дате
      if (error && error.code === '42703' && filterTopicId) ({ data, count, error } = await build(false));
      if (error) throw error;
      return {
        questions: (data || []) as Question[],
        totalCount: count || 0,
      };
  };

  const shownPages = Array.from({ length: extra + 1 }, (_, i) => page + i);
  const pageResults = useQueries({
    queries: shownPages.map((p) => ({
      queryKey: ['questions', filterSubjectId, filterChapterId, filterTopicId, filterType, filterNct, filterDiff, activePassage, searchQuery, filterIssue, p],
      queryFn: () => fetchPage(p),
    })),
  });
  const data = pageResults[0]?.data;
  const isLoading = pageResults[0]?.isLoading ?? true;
  const loadingMore = pageResults.slice(1).some((r) => r.isLoading);

  const resetFilters = () => {
    setFilterIssue('all');
    setFilterSubjectId('');
    setFilterChapterId('');
    setFilterTopicId('');
    setFilterType('all');
    setSearchQuery('');
    setPage(0); setExtra(0);
  };

  // Мягкое удаление вопроса
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('questions')
        .update({ is_deleted: true, deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      assertRowsChanged(data, 'вопрос');
    },
    meta: { action: 'Не удалось удалить вопрос' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      queryClient.invalidateQueries({ queryKey: ['question_counts'] });
      queryClient.invalidateQueries({ queryKey: ['passage_counts'] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
    onError: (_e, id) => setHiddenIds((prev) => prev.filter((x) => x !== id)),
  });

  // Удаление с отменой: вопрос сразу скрывается, а в базе удаляется через 5 секунд
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const removeQuestion = (id: string) => {
    setHiddenIds((prev) => [...prev, id]);
    withUndo('Вопрос удалён', () => deleteMutation.mutate(id), () => setHiddenIds((prev) => prev.filter((x) => x !== id)));
  };

  const questions = pageResults.flatMap((r) => r.data?.questions || []).filter((q) => !hiddenIds.includes(q.id));
  const totalCount = data?.totalCount || 0;

  // Подписи текстов у вопросов на странице («Чтение: заголовок · № k»)
  const passageIds = Array.from(new Set(questions.map((q) => q.passage_id).filter(Boolean) as string[]));
  const { data: passageById } = useQuery({
    queryKey: ['passages-by-ids', passageIds.join(',')],
    enabled: passageIds.length > 0,
    queryFn: async () => new Map((await fetchPassagesByIds(passageIds)).map((p) => [p.id, p])),
  });

  // Связи «тест ↔ открытый вопрос / соответствие»: показываем, где ещё используется вопрос
  const shownIds = questions.map((q) => q.id);
  const { data: links } = useQuery({
    queryKey: ['question-links', shownIds.join(',')],
    enabled: shownIds.length > 0,
    queryFn: async () => {
      const out = new Map<string, string[]>();
      const push = (id: string, label: string) => out.set(id, [...(out.get(id) || []), label]);
      const label = (x: any) => (x.type === 'test' ? 'тест' : x.type === 'open' ? 'открытый' : 'соответствие') + (x.num != null ? ` №${x.num}` : '');
      // Кто ссылается на показанные вопросы: функция базы ищет по индексу (прямой запрос к таблице перебирал весь банк)
      let { data: back, error: backError } = await supabase.rpc('questions_linking_to', { p_ids: shownIds });
      if (backError?.code === 'PGRST202') { // функции ещё нет в базе (perf_round1.sql не применён)
        ({ data: back } = await supabase.from('questions').select('id, type, num, linked_ids').eq('is_deleted', false).overlaps('linked_ids', shownIds));
      }
      for (const b of back || []) for (const t of (b.linked_ids || []) as string[]) if (shownIds.includes(t)) push(t, label(b));
      const targets = Array.from(new Set(questions.flatMap((q) => ((q as any).linked_ids || []) as string[])));
      if (targets.length) {
        const { data: tg } = await supabase.from('questions').select('id, type, num').in('id', targets);
        const byId = new Map((tg || []).map((x: any) => [x.id, x]));
        for (const q of questions) for (const t of ((q as any).linked_ids || []) as string[]) if (byId.has(t)) push(q.id, label(byId.get(t)));
      }
      return out;
    },
  });
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // После удаления последнего вопроса на странице возвращаемся на последнюю существующую
  React.useEffect(() => {
    if (data && page > 0 && page >= totalPages) { setPage(Math.max(0, totalPages - 1)); setExtra(0); }
  }, [data, page, totalPages]);

  const lastShown = page + extra;
  const goToPage = (p: number) => {
    setPage(Math.min(Math.max(0, p), Math.max(0, totalPages - 1)));
    setExtra(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const submitJump = () => {
    const n = parseInt(jumpTo, 10);
    if (Number.isFinite(n) && n >= 1) goToPage(n - 1);
    setJumpTo('');
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Верхняя панель в стиле Bento: Заголовок и кнопка добавления */}
      <Card padding="none" className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight tracking-tight">
              Банк вопросов
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Вопросов: <strong className="text-slate-700 font-semibold">{totalCount}</strong> • Стр. {page + 1} из {Math.max(1, totalPages)}
            </p>
          </div>
        </div>

        {isStaff && (
          <div className="flex items-center gap-2">
            <button
              onClick={onAddQuestion}
              className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white rounded-xl text-sm font-bold shadow-md shadow-indigo-500/20 flex items-center justify-center space-x-1.5 active:scale-95 transition-all min-h-[40px]"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить вопрос</span>
            </button>
            {canAddPassage && (
              <button
                onClick={() => setNewPassageOpen(true)}
                className="w-full sm:w-auto px-4 py-2.5 bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 rounded-xl text-sm font-bold flex items-center justify-center space-x-2 transition"
                title="Новый текст для чтения или с пропусками в выбранной теме"
              >
                <Plus className="w-4 h-4" />
                <span>Добавить текст</span>
              </button>
            )}
          </div>
        )}
      </Card>

      {/* Широкий экран: слева панель фильтров (закреплена), справа список. Уже — всё по порядку друг под другом */}
      <div className="flex flex-col gap-4 sm:gap-6 xl:grid xl:grid-cols-[300px_minmax(0,1fr)] xl:items-start xl:gap-x-6 xl:gap-y-4">
      <div className="space-y-4 sm:space-y-6 min-w-0 xl:col-start-2 xl:row-start-1">
      {/* Быстрые фильтры: Горизонтальные свайп-чипсы типов вопросов */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 px-0.5">
        {[
          { id: 'all', label: 'Все вопросы' },
          { id: 'test', label: 'Тестовые' },
          { id: 'matching', label: 'Соответствие' },
          { id: 'open', label: 'Открытые' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { setFilterType(t.id); setPage(0); setExtra(0); }}
            className={`px-3.5 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-150 active:scale-95 ${
              filterType === t.id
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20 font-bold'
                : 'bg-white border border-slate-200/90 text-slate-600 hover:bg-slate-50'
            } min-h-[40px]`}
          >
            {t.label}
          </button>
        ))}

        {filterIssue !== 'all' && (
          <span className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-bold whitespace-nowrap flex items-center space-x-1">
            <span>⚠ {ISSUE_FILTER_LABELS[filterIssue]}</span>
            <button onClick={() => { setFilterIssue('all'); setPage(0); setExtra(0); }} className="p-1.5 -m-1.5 hover:text-amber-950" aria-label="Убрать фильтр по проблемным вопросам" title="Убрать фильтр">
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
      </div>

      {/* Мобильная панель поиска и вызова шторки фильтров */}
      <div className="md:hidden flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0); setExtra(0);
            }}
            placeholder="Поиск вопросов по тексту..."
            aria-label="Поиск вопросов по тексту"
            className="w-full text-sm pl-9 pr-8 py-2.5 bg-white border border-slate-200/90 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-xs"
          />
          {searchQuery && (
            <button 
              onClick={() => { setSearchQuery(''); setPage(0); setExtra(0); }} 
              className="absolute right-0.5 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-slate-500 hover:text-slate-700"
              aria-label="Очистить поиск"
              title="Очистить поиск"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setIsFilterSheetOpen(true)}
          className={`px-3.5 py-2.5 rounded-xl text-sm font-bold flex items-center space-x-1.5 transition active:scale-95 shadow-xs border ${
            activeFiltersCount > 0
              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
              : 'bg-white text-slate-700 border-slate-200/90'
          } min-h-[40px]`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Фильтры</span>
          {activeFiltersCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">
              {activeFiltersCount}
            </span>
          )}
        </button>
      </div>

      {/* Мобильная шторка фильтров (Bottom Sheet) */}
      {isFilterSheetOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div 
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs" 
            onClick={() => setIsFilterSheetOpen(false)} 
          />
          <div ref={filterSheet} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Фильтры" className="relative bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-5 max-h-[85vh] overflow-y-auto pb-[calc(2rem+env(safe-area-inset-bottom))] z-10 space-y-4">
            <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mb-2" />
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <SlidersHorizontal className="w-4 h-4 text-indigo-600" />
                <h3 className="font-bold text-base text-slate-900">Фильтры банка</h3>
              </div>
              <IconButton icon={X} label="Закрыть фильтры" onClick={() => setIsFilterSheetOpen(false)} className="w-10 h-10 bg-slate-100 text-slate-500" />
            </div>

            <div className="space-y-3">
              <Field label="Предмет">
<CustomSelect
                  value={filterSubjectId}
                  onChange={(val) => {
                    setFilterSubjectId(val);
                    setFilterChapterId('');
                    setFilterTopicId('');
                    setPage(0); setExtra(0);
                  }}
                  className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Все предметы</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </CustomSelect>
</Field>

              <Field label="Глава">
<CustomSelect
                  disabled={!filterSubjectId}
                  value={filterChapterId}
                  onChange={(val) => {
                    setFilterChapterId(val);
                    setFilterTopicId('');
                    setPage(0); setExtra(0);
                  }}
                  className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  <option value="">Все главы</option>
                  {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </CustomSelect>
</Field>

              <Field label="Тема">
<CustomSelect
                  disabled={!filterChapterId}
                  value={filterTopicId}
                  onChange={(val) => {
                    setFilterTopicId(val);
                    setPage(0); setExtra(0);
                  }}
                  className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  <option value="">Все темы</option>
                  {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </CustomSelect>
</Field>

              <Field label="Проблемные вопросы">
<CustomSelect
                  value={filterIssue}
                  onChange={(val) => {
                    setFilterIssue(val as IssueFilter);
                    setPage(0); setExtra(0);
                  }}
                  className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
                >
                  {(Object.keys(ISSUE_FILTER_LABELS) as IssueFilter[]).map((k) => (
                    <option key={k} value={k}>{ISSUE_FILTER_LABELS[k]}</option>
                  ))}
                </CustomSelect>
</Field>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Язык отображения</label>
                <div role="radiogroup" aria-label="Язык вопросов" className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setDisplayLang('ru')}
                    role="radio"
                    aria-checked={displayLang === 'ru'}
                    className={`py-2 rounded-lg transition ${displayLang === 'ru' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600'} min-h-[40px]`}
                  >
                    Русский
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisplayLang('tg')}
                    role="radio"
                    aria-checked={displayLang === 'tg'}
                    className={`py-2 rounded-lg transition ${displayLang === 'tg' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600'} min-h-[40px]`}
                  >
                    Тоҷикӣ
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisplayLang('both')}
                    role="radio"
                    aria-checked={displayLang === 'both'}
                    className={`py-2 rounded-lg transition ${displayLang === 'both' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600'} min-h-[40px]`}
                  >
                    RU + TJ
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setFilterIssue('all');
                  setFilterSubjectId('');
                  setFilterChapterId('');
                  setFilterTopicId('');
                  setFilterType('all');
                  setSearchQuery('');
                  setPage(0); setExtra(0);
                }}
                className="py-3 px-4 rounded-xl text-sm font-semibold text-rose-600 bg-rose-50 border border-rose-200 transition active:scale-95 min-h-[40px]"
              >
                Сбросить
              </button>
              <Button variant="primary" className="flex-1" type="button" onClick={() => setIsFilterSheetOpen(false)}>
                Показать вопросы ({totalCount})
              </Button>
            </div>
          </div>
        </div>
      )}

      </div>

      {/* Десктопная панель фильтров (в стиле Bento) */}
      <Card padding="none" className="hidden md:block p-4 space-y-3 xl:col-start-1 xl:row-start-1 xl:row-span-2 xl:self-start xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
        <div className="flex items-center text-xs font-bold text-slate-700 uppercase tracking-wider">
          <Filter className="w-3.5 h-3.5 mr-1.5 text-indigo-500" />
          Фильтры и поиск
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 xl:grid-cols-1 gap-2.5">
          {/* Поиск */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(0); setExtra(0);
              }}
              placeholder="Поиск по тексту..."
              aria-label="Поиск вопросов по тексту"
              className="w-full text-sm pl-9 pr-3 py-2 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Предмет */}
          <CustomSelect
            value={filterSubjectId}
            onChange={(val) => {
              setFilterSubjectId(val);
              setFilterChapterId('');
              setFilterTopicId('');
              setPage(0); setExtra(0);
            }}
            className="text-sm px-2.5 py-2 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Все предметы</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </CustomSelect>

          {/* Глава */}
          <CustomSelect
            disabled={!filterSubjectId}
            value={filterChapterId}
            onChange={(val) => {
              setFilterChapterId(val);
              setFilterTopicId('');
              setPage(0); setExtra(0);
            }}
            className="text-sm px-2.5 py-2 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            <option value="">Все главы</option>
            {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </CustomSelect>

          {/* Тема */}
          <CustomSelect
            disabled={!filterChapterId}
            value={filterTopicId}
            onChange={(val) => {
              setFilterTopicId(val);
              setPage(0); setExtra(0);
            }}
            className="text-sm px-2.5 py-2 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            <option value="">Все темы</option>
            {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </CustomSelect>

          {/* Тип */}
          <CustomSelect
            value={filterType}
            onChange={(val) => {
              setFilterType(val);
              setPage(0); setExtra(0);
            }}
            className="text-sm px-2.5 py-2 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">Все типы вопросов</option>
            <option value="test">Тестовые</option>
            <option value="matching">На соответствие</option>
            <option value="open">Открытые</option>
          </CustomSelect>

          {isOwner && (
            <CustomSelect
              value={filterNct}
              onChange={(val) => { setFilterNct(val); setPage(0); setExtra(0); }}
              className="text-sm px-2.5 py-2 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">Любая метка НЦТ</option>
              <option value="none">Без метки</option>
              {nctTypesFor((subjects as any[]).find((x: any) => x.id === filterSubjectId)?.name).map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
            </CustomSelect>
          )}

          {isOwner && (
            <CustomSelect
              value={filterDiff}
              onChange={(val) => { setFilterDiff(val); setPage(0); setExtra(0); }}
              className="text-sm px-2.5 py-2 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">Любая сложность</option>
              <option value="none">Без сложности</option>
              {NCT_DIFFICULTIES.map(d => <option key={d.value} value={String(d.value)}>{d.name}</option>)}
            </CustomSelect>
          )}

          {/* Текст (английский): только когда в теме есть тексты */}
          {filterTopicId && topicPassages.length > 0 && (
            <CustomSelect
              value={activePassage}
              onChange={(val) => { setFilterPassage(val); setPage(0); setExtra(0); }}
              className="text-sm px-2.5 py-2 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">Любой текст</option>
              <option value="none">Без текста</option>
              {topicPassages.map((p) => <option key={p.id} value={p.id}>{passageLabel(p)}</option>)}
            </CustomSelect>
          )}

          {/* Проблемные вопросы */}
          <CustomSelect
            value={filterIssue}
            onChange={(val) => {
              setFilterIssue(val as IssueFilter);
              setPage(0); setExtra(0);
            }}
            className={`text-sm px-2.5 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 ${filterIssue !== 'all' ? 'border-amber-400 bg-amber-50' : 'bg-slate-50/70 border-slate-200'}`}
          >
            {(Object.keys(ISSUE_FILTER_LABELS) as IssueFilter[]).map((k) => (
              <option key={k} value={k}>{ISSUE_FILTER_LABELS[k]}</option>
            ))}
          </CustomSelect>
        </div>

        {/* Выбор языка отображения */}
        <div className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-100 gap-2 xl:flex-col xl:items-stretch">
          <div className="flex items-center space-x-2 xl:flex-col xl:items-stretch xl:space-x-0 xl:gap-1.5">
            <span className="text-xs font-semibold text-slate-600">Язык вопросов:</span>
            <div role="radiogroup" aria-label="Язык вопросов" className="inline-flex xl:flex rounded-xl border border-slate-200/90 p-0.5 bg-slate-100/70 text-xs [&>button]:whitespace-nowrap xl:[&>button]:flex-1">
              <button
                type="button"
                onClick={() => setDisplayLang('ru')}
                role="radio"
                aria-checked={displayLang === 'ru'}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  displayLang === 'ru'
                    ? 'bg-indigo-600 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                } min-h-[40px]`}
              >
                Русский
              </button>
              <button
                type="button"
                onClick={() => setDisplayLang('tg')}
                role="radio"
                aria-checked={displayLang === 'tg'}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  displayLang === 'tg'
                    ? 'bg-emerald-600 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                } min-h-[40px]`}
              >
                Тоҷикӣ
              </button>
              <button
                type="button"
                onClick={() => setDisplayLang('both')}
                role="radio"
                aria-checked={displayLang === 'both'}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  displayLang === 'both'
                    ? 'bg-purple-600 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                } min-h-[40px]`}
              >
                RU + TJ
              </button>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {(filterSubjectId || filterChapterId || filterTopicId || filterType !== 'all' || filterIssue !== 'all' || searchQuery) && (
              <Button variant="secondary" className="bg-white" type="button" onClick={resetFilters} title="Сбросить все установленные фильтры и поиск">
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Сбросить фильтры</span>
              </Button>
            )}
            {data?.totalCount !== undefined && (
              <span className="text-xs text-slate-500">
                Всего в базе: <strong className="text-slate-700">{data.totalCount}</strong>
              </span>
            )}
          </div>
        </div>
      </Card>

      <div className="space-y-4 sm:space-y-6 min-w-0 xl:col-start-2 xl:row-start-2">
      {/* Список карточек вопросов */}
      {isLoading ? (
        <div role="status" aria-label="Загрузка вопросов" className="space-y-3.5">{[0, 1, 2, 3, 4, 5].slice(0, 3).map((i) => <Skeleton key={i} className="h-44 rounded-card" />)}</div>
      ) : questions.length === 0 ? (
        <Card>
          <EmptyState
            icon={HelpCircle}
            title="Вопросы не найдены"
            description={(searchQuery || filterSubjectId || filterChapterId || filterTopicId || filterType !== 'all' || filterIssue !== 'all') ? 'По заданным фильтрам ничего не найдено.' : 'В банке ещё нет вопросов.'}
            action={(searchQuery || filterSubjectId || filterChapterId || filterTopicId || filterType !== 'all' || filterIssue !== 'all')
              ? <Button variant="secondary" onClick={resetFilters}>Сбросить фильтры</Button>
              : isStaff ? <Button variant="primary" icon={Plus} onClick={onAddQuestion}>Добавить первый вопрос</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-3.5">
          {questions.map((q) => (
            <div
              key={q.id}
              className={`bento-card bento-card-interactive p-4 sm:p-5 rounded-2xl relative overflow-hidden transition-all space-y-3.5 border-l-4 ${
                q.type === 'test'
                  ? 'border-l-indigo-500'
                  : q.type === 'matching'
                  ? 'border-l-purple-500'
                  : 'border-l-emerald-500'
              }`}
            >
              {/* Верхняя строка карточки: метки и действия */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <Badge tone={q.type === 'test' ? 'primary' : q.type === 'matching' ? 'purple' : 'success'} className="font-bold uppercase tracking-wider px-2.5 py-1">
                    {q.type === 'test' ? 'Тест' : q.type === 'matching' ? 'Соответствие' : 'Открытый'}
                  </Badge>

                  {isOwner && q.nct_type && (
                    <Badge tone="neutral" className="font-normal" title={`Тип НЦТ: ${nctTypeName(q.nct_type)}`}>
                      НЦТ: {q.nct_type}
                    </Badge>
                  )}

                  {isOwner && q.nct_difficulty && (
                    <Badge tone="neutral" className="font-normal" title="Сложность для НЦТ">
                      {nctDifficultyName(q.nct_difficulty)}
                    </Badge>
                  )}

                  {q.num != null && (
                    <Badge tone="neutral" className="font-bold text-slate-800" title="Номер вопроса в теме">
                      № {q.num}
                    </Badge>
                  )}

                  {q.passage_id && (
                    <Badge tone="primary" className="font-normal" title="Вопрос к тексту; в билет такие вопросы попадают вместе с текстом">
                      {passageById?.get(q.passage_id) ? passageLabel(passageById.get(q.passage_id), q.passage_order) : `Текст${q.passage_order ? ` · № ${q.passage_order}` : ''}`}
                    </Badge>
                  )}

                  {q.chapter && (
                    <Badge tone="neutral" className="font-normal">
                      Гл: {(q.chapter as any).name}
                    </Badge>
                  )}
                  {q.topic && (
                    <Badge tone="neutral" className="font-normal">
                      Тема: {(q.topic as any).name}
                    </Badge>
                  )}
                  {q.source && (
                    <Badge tone="warning" className="font-normal">
                      {(q.source as any).name}
                    </Badge>
                  )}
                  {questionIssues(q).map((code) => (
                    <Badge tone="danger" key={code}>
                      ⚠ {ISSUE_LABELS[code]}
                    </Badge>
                  ))}
                  {(links?.get(q.id) || []).length > 0 && (
                    <Badge tone="primary" className="font-normal" title="Эти вопросы не попадут в один билет">
                      🔗 Связан: {(links?.get(q.id) || []).join(', ')}
                    </Badge>
                  )}
                  <span className="text-xs text-slate-500 font-mono">
                    v{q.version}
                  </span>
                </div>

                <div className="flex items-center space-x-1">
                  {q.passage_id && canManage(q.subject_id) && passageById?.get(q.passage_id) && (
                    <IconButton
                      icon={FileText}
                      label="Открыть текст"
                      onClick={() => setEditPassage(passageById.get(q.passage_id!)!)}
                      className="w-10 h-10 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
                    />
                  )}
                  {canManage(q.subject_id) && (
                    <IconButton
                      icon={Edit3}
                      label="Редактировать вопрос"
                      onClick={() => onEditQuestion(q)}
                      className="w-10 h-10 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
                    />
                  )}
                  {canManage(q.subject_id) && (
                    <IconButton
                      icon={Trash2}
                      label="Удалить вопрос"
                      onClick={() => removeQuestion(q.id)}
                      className="w-10 h-10 text-slate-500 hover:text-red-600 hover:bg-red-50"
                    />
                  )}
                </div>
              </div>

              {/* Тело вопроса */}
              <div className="space-y-3">
                {displayLang === 'ru' && (
                  <div className="text-[15px] sm:text-base font-medium text-slate-900 leading-relaxed">
                    <FormattedText text={q.content_ru || q.content} />
                  </div>
                )}
                {displayLang === 'tg' && (
                  <div className="text-[15px] sm:text-base font-medium text-slate-900 leading-relaxed">
                    <FormattedText text={q.content_tg || q.content} />
                  </div>
                )}
                {displayLang === 'both' && (
                  <div className="space-y-2 p-3 sm:p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                    <div>
                      <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider block mb-0.5">Русский:</span>
                      <div className="text-[15px] sm:text-base font-medium text-slate-900 leading-relaxed">
                        <FormattedText text={q.content_ru || q.content} />
                      </div>
                    </div>
                    {q.content_tg && (
                      <div className="pt-2 border-t border-slate-200">
                        <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider block mb-0.5">Тоҷикӣ:</span>
                        <div className="text-[15px] sm:text-base font-medium text-slate-900 leading-relaxed">
                          <FormattedText text={q.content_tg} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Главное изображение */}
                {q.image_url && (
                  <div className="pt-1">
                    <img loading="lazy" decoding="async"
                      src={q.image_url}
                      alt="Изображение вопроса"
                      onClick={() => setPreviewImage(q.image_url || null)}
                      className="max-h-48 rounded-xl border border-slate-200 object-contain bg-slate-50 p-1 cursor-pointer hover:opacity-90 hover:shadow-md transition"
                      title="Нажмите для увеличения"
                    />
                  </div>
                )}

                {/* Варианты для тестового вопроса */}
                {q.type === 'test' && q.options && q.options.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {q.options
                      .sort((a, b) => a.order_index - b.order_index)
                      .map((opt, i) => (
                        <div
                          key={opt.id || i}
                          className={`flex items-start space-x-2.5 p-2.5 rounded-xl border text-xs text-slate-700 transition ${
                            opt.is_correct
                              ? 'bg-emerald-50/80 border-emerald-300 ring-1 ring-emerald-200/60 text-emerald-950 font-medium'
                              : 'bg-slate-50/70 border-slate-200/70'
                          }`}
                        >
                          <span className={`w-5 h-5 rounded-lg font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 ${
                            opt.is_correct
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'bg-slate-200/80 text-slate-700'
                          }`}>
                            {['A', 'B', 'C', 'D', 'E', 'F'][i] || String.fromCharCode(65 + i)}
                          </span>
                          <div className="flex-1 space-y-0.5">
                            {displayLang === 'ru' && (
                              <FormattedText text={opt.text_ru || opt.text} />
                            )}
                            {displayLang === 'tg' && (
                              <FormattedText text={opt.text_tg || opt.text} />
                            )}
                            {displayLang === 'both' && (
                              <>
                                <div><FormattedText text={opt.text_ru || opt.text} /></div>
                                {opt.text_tg && (
                                  <div className="text-emerald-700 pt-1 border-t border-slate-200 mt-1">
                                    <FormattedText text={opt.text_tg} />
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          {opt.image_url && (
                            <img loading="lazy" decoding="async"
                              src={opt.image_url}
                              alt=""
                              onClick={() => setPreviewImage(opt.image_url || null)}
                              className="w-10 h-10 object-cover rounded-lg border border-slate-200 shrink-0 cursor-pointer hover:opacity-90 hover:scale-105 transition shadow-xs bg-white"
                              title="Нажмите для увеличения"
                            />
                          )}
                        </div>
                      ))}
                  </div>
                )}

                {/* Списки для задания на соответствие */}
                {q.type === 'matching' && q.matching_items && q.matching_items.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    {/* Левая часть */}
                    <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-xs font-bold uppercase text-slate-500 block mb-1">
                        Левая колонка:
                      </span>
                      {q.matching_items
                        .filter(m => m.side === 'left')
                        .sort((a, b) => a.order_index - b.order_index)
                        .map((m, idx) => (
                          <div key={m.id || idx} className="text-xs text-slate-800 flex items-start space-x-1.5">
                            <span className="font-bold text-slate-600 shrink-0 mt-0.5">{['A', 'B', 'C', 'D', 'E', 'F'][idx] || String.fromCharCode(65 + idx)})</span>
                            <div className="flex-1">
                              {displayLang === 'ru' && <FormattedText text={m.text_ru || m.text} />}
                              {displayLang === 'tg' && <FormattedText text={m.text_tg || m.text} />}
                              {displayLang === 'both' && (
                                <>
                                  <div><FormattedText text={m.text_ru || m.text} /></div>
                                  {m.text_tg && <div className="text-emerald-700 text-xs pt-0.5">{m.text_tg}</div>}
                                </>
                              )}
                            </div>
                            {(() => {
                              const rights = q.matching_items!.filter(r => r.side === 'right').sort((x, y) => x.order_index - y.order_index);
                              const k = rights.findIndex(r => !!m.correct_match_id && r.id === m.correct_match_id);
                              return k >= 0 ? (
                                <span className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-600 text-white font-bold text-xs shadow-sm" title="Правильный ответ">→ {k + 1}</span>
                              ) : (
                                <Badge tone="danger" className="shrink-0 px-1.5" title="Ответ не задан">нет ответа</Badge>
                              );
                            })()}
                            {m.image_url && (
                              <img loading="lazy" decoding="async"
                                src={m.image_url}
                                alt=""
                                onClick={() => setPreviewImage(m.image_url || null)}
                                className="w-7 h-7 object-cover rounded border border-slate-200 ml-auto shrink-0 cursor-pointer hover:opacity-90 hover:scale-110 transition shadow-sm bg-white"
                                title="Нажмите для увеличения"
                              />
                            )}
                          </div>
                        ))}
                    </div>

                    {/* Правая часть */}
                    <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-xs font-bold uppercase text-slate-500 block mb-1">
                        Правая колонка:
                      </span>
                      {q.matching_items
                        .filter(m => m.side === 'right')
                        .sort((a, b) => a.order_index - b.order_index)
                        .map((m, idx) => (
                          <div key={m.id || idx} className="text-xs text-slate-800 flex items-start space-x-1.5">
                            <span className="font-bold text-slate-600 shrink-0 mt-0.5">{m.order_index || (idx + 1)})</span>
                            <div className="flex-1">
                              {displayLang === 'ru' && <FormattedText text={m.text_ru || m.text} />}
                              {displayLang === 'tg' && <FormattedText text={m.text_tg || m.text} />}
                              {displayLang === 'both' && (
                                <>
                                  <div><FormattedText text={m.text_ru || m.text} /></div>
                                  {m.text_tg && <div className="text-emerald-700 text-xs pt-0.5">{m.text_tg}</div>}
                                </>
                              )}
                            </div>
                            {m.image_url && (
                              <img loading="lazy" decoding="async"
                                src={m.image_url}
                                alt=""
                                onClick={() => setPreviewImage(m.image_url || null)}
                                className="w-7 h-7 object-cover rounded border border-slate-200 ml-auto shrink-0 cursor-pointer hover:opacity-90 hover:scale-110 transition shadow-sm bg-white"
                                title="Нажмите для увеличения"
                              />
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Открытый вопрос */}
                {q.type === 'open' && q.correct_numeric_answer !== null && q.correct_numeric_answer !== undefined && (
                  <div className="text-xs text-slate-500 pt-1">
                    Ответ: <span className="font-bold text-slate-700">{q.correct_numeric_answer}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Пагинация в Bento-стиле */}
      {totalPages > 1 && (
        <div className="space-y-3">
          {lastShown < totalPages - 1 && (
            <button
              onClick={() => setExtra((x) => x + 1)}
              disabled={loadingMore}
              className="w-full bento-card p-3.5 rounded-2xl text-sm font-bold text-indigo-700 hover:bg-indigo-50/70 border-indigo-200/80 active:scale-98 transition shadow-xs disabled:opacity-60 min-h-[40px]"
            >
              {loadingMore ? 'Загрузка…' : `Показать ещё (вопросов: ${Math.min(PAGE_SIZE, totalCount - (lastShown + 1) * PAGE_SIZE)}, страница ${lastShown + 2})`}
            </button>
          )}

          <Card padding="none" className="flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page === 0}
              className="px-3.5 py-2 border border-slate-200/90 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center space-x-1 active:scale-95 transition min-h-[40px]"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Назад</span>
            </button>

            <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-slate-500">
              <span>
                Страница <span className="font-bold text-slate-800">{extra > 0 ? `${page + 1}–${lastShown + 1}` : page + 1}</span> из {totalPages}
              </span>
              <form
                className="flex items-center gap-1.5"
                onSubmit={(ev) => { ev.preventDefault(); submitJump(); }}
              >
                <label htmlFor="ql-jump" className="sr-only">Перейти на страницу</label>
                <input
                  id="ql-jump"
                  type="number"
                  min={1}
                  max={totalPages}
                  value={jumpTo}
                  onChange={(ev) => setJumpTo(ev.target.value)}
                  placeholder="№ стр."
                  className="w-18 px-2.5 py-1.5 border border-slate-200/90 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/80"
                />
                <button
                  type="submit"
                  disabled={!jumpTo}
                  className="px-3 py-1.5 border border-slate-200/90 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 active:scale-95 transition min-h-[40px]"
                >
                  Перейти
                </button>
              </form>
            </div>

            <button
              onClick={() => goToPage(lastShown + 1)}
              disabled={lastShown >= totalPages - 1}
              className="px-3.5 py-2 border border-slate-200/90 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center space-x-1 active:scale-95 transition min-h-[40px]"
            >
              <span>Вперед</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </Card>
        </div>
      )}

      </div>
      </div>

      {editPassage && <PassageEditor passage={editPassage} onClose={() => setEditPassage(null)} />}
      {newPassageOpen && canAddPassage && (
        <PassageEditor
          topic={{ subject_id: filterSubjectId, chapter_id: filterChapterId, topic_id: filterTopicId }}
          onClose={() => setNewPassageOpen(false)}
        />
      )}

      {/* Модальное окно увеличения изображения (Lightbox) */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm transition-all duration-150"
          onClick={() => setPreviewImage(null)}
          role="dialog" aria-modal="true" aria-label="Увеличенное изображение"
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-11 right-0 text-white hover:text-slate-300 p-2 rounded-full bg-black/50 hover:bg-black/75 transition"
              title="Закрыть (Esc)" aria-label="Закрыть"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={previewImage}
              alt="Увеличенное изображение"
              className="max-h-[85vh] max-w-full rounded-2xl shadow-2xl object-contain border border-white/20 bg-white p-2"
            />
          </div>
        </div>
      )}
    </div>
  );
};
