import React, { useState } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { assertRowsChanged } from '../lib/errors';
import { Question, QuestionType, Subject, Chapter, Topic } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { FormattedText } from './FormulaEditor';
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
  RotateCcw
} from 'lucide-react';

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
  const { isAdmin } = useAuth();

  // Фильтры (с сохранением в localStorage)
  const [filterSubjectId, setFilterSubjectId] = useState(() => localStorage.getItem('examiner_ql_subject_id') || '');
  const [filterChapterId, setFilterChapterId] = useState(() => localStorage.getItem('examiner_ql_chapter_id') || '');
  const [filterTopicId, setFilterTopicId] = useState(() => localStorage.getItem('examiner_ql_topic_id') || '');
  const [filterType, setFilterType] = useState<string>(() => localStorage.getItem('examiner_ql_type') || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  // page — первая показанная страница, extra — сколько страниц подгружено ниже кнопкой «Показать ещё»
  const [page, setPage] = useState(0);
  const [extra, setExtra] = useState(0);
  const [jumpTo, setJumpTo] = useState('');
  const [displayLang, setDisplayLang] = useState<'ru' | 'tg' | 'both'>(
    () => (localStorage.getItem('examiner_ql_display_lang') as 'ru' | 'tg' | 'both') || 'ru'
  );
  const [previewImage, setPreviewImage] = useState<string | null>(null);

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
  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Subject[];
    },
  });

  const { data: chapters = [] } = useQuery({
    queryKey: ['chapters', filterSubjectId],
    enabled: Boolean(filterSubjectId),
    queryFn: async () => {
      const { data } = await supabase.from('chapters').select('*').eq('subject_id', filterSubjectId).eq('is_deleted', false).order('order_index');
      return (data || []) as Chapter[];
    },
  });

  const { data: topics = [] } = useQuery({
    queryKey: ['topics', filterChapterId],
    enabled: Boolean(filterChapterId),
    queryFn: async () => {
      const { data } = await supabase.from('topics').select('*').eq('chapter_id', filterChapterId).eq('is_deleted', false).order('order_index');
      return (data || []) as Topic[];
    },
  });

  // Запрос одной страницы вопросов с фильтрацией на сервере
  const fetchPage = async (pageNo: number) => {
      const build = (byNum: boolean) => {
        let query = supabase
          .from('questions')
          .select(`
            *,
            chapter:chapters(name),
            topic:topics(name),
            source:sources(name),
            options:question_options(*),
            matching_items:matching_items(*)
          `, { count: 'exact' })
          .eq('is_deleted', false);
        // В выбранной теме — по номерам вопросов, иначе — новые сверху
        query = byNum
          ? query.order('num', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true })
          : query.order('created_at', { ascending: false });
        query = query.range(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE - 1);

        if (filterSubjectId) query = query.eq('subject_id', filterSubjectId);
        if (filterChapterId) query = query.eq('chapter_id', filterChapterId);
        if (filterTopicId) query = query.eq('topic_id', filterTopicId);
        if (filterType !== 'all') query = query.eq('type', filterType);
        if (searchQuery.trim()) {
          // Значение берём в кавычки и экранируем: запятые, скобки, % и _ в запросе не ломают фильтр
          const like = '%' + searchQuery.trim().replace(/[\\%_]/g, '\\$&') + '%';
          const quoted = '"' + like.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
          query = query.or(`content.ilike.${quoted},content_ru.ilike.${quoted},content_tg.ilike.${quoted}`);
        }
        return query;
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
      queryKey: ['questions', filterSubjectId, filterChapterId, filterTopicId, filterType, searchQuery, p],
      queryFn: () => fetchPage(p),
    })),
  });
  const data = pageResults[0]?.data;
  const isLoading = pageResults[0]?.isLoading ?? true;
  const loadingMore = pageResults.slice(1).some((r) => r.isLoading);

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
    meta: { action: 'Не удалось удалить вопрос', success: 'Вопрос удалён из базы' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
    },
  });

  const questions = pageResults.flatMap((r) => r.data?.questions || []);
  const totalCount = data?.totalCount || 0;
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
    <div className="space-y-6">
      {/* Верхняя панель: Заголовок, поиск и кнопка добавления */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <FileText className="w-5 h-5 mr-2 text-blue-600" />
            Банк вопросов
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Всего в базе: {totalCount} вопросов • Страница {page + 1} из {Math.max(1, totalPages)}
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-3">
            <button
              onClick={onAddQuestion}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm flex items-center space-x-1 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить вопрос</span>
            </button>
          </div>
        )}
      </div>

      {/* Панель фильтров */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center text-xs font-bold text-slate-700 uppercase tracking-wider">
          <Filter className="w-3.5 h-3.5 mr-1 text-slate-400" />
          Фильтры и поиск
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
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
              className="w-full text-xs pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Предмет */}
          <select
            value={filterSubjectId}
            onChange={(e) => {
              setFilterSubjectId(e.target.value);
              setFilterChapterId('');
              setFilterTopicId('');
              setPage(0); setExtra(0);
            }}
            className="text-xs px-2.5 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Все предметы</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {/* Глава */}
          <select
            disabled={!filterSubjectId}
            value={filterChapterId}
            onChange={(e) => {
              setFilterChapterId(e.target.value);
              setFilterTopicId('');
              setPage(0); setExtra(0);
            }}
            className="text-xs px-2.5 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
          >
            <option value="">Все главы</option>
            {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/* Тема */}
          <select
            disabled={!filterChapterId}
            value={filterTopicId}
            onChange={(e) => {
              setFilterTopicId(e.target.value);
              setPage(0); setExtra(0);
            }}
            className="text-xs px-2.5 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
          >
            <option value="">Все темы</option>
            {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          {/* Тип */}
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
              setPage(0); setExtra(0);
            }}
            className="text-xs px-2.5 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Все типы вопросов</option>
            <option value="test">Тестовые</option>
            <option value="matching">На соответствие</option>
            <option value="open">Открытые</option>
          </select>
        </div>

        {/* Выбор языка отображения */}
        <div className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-100 gap-2">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-slate-500">Язык вопросов:</span>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs">
              <button
                type="button"
                onClick={() => setDisplayLang('ru')}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  displayLang === 'ru'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Русский
              </button>
              <button
                type="button"
                onClick={() => setDisplayLang('tg')}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  displayLang === 'tg'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Тоҷикӣ
              </button>
              <button
                type="button"
                onClick={() => setDisplayLang('both')}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  displayLang === 'both'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                RU + TJ (Параллельно)
              </button>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {(filterSubjectId || filterChapterId || filterTopicId || filterType !== 'all' || searchQuery) && (
              <button
                type="button"
                onClick={() => {
                  setFilterSubjectId('');
                  setFilterChapterId('');
                  setFilterTopicId('');
                  setFilterType('all');
                  setSearchQuery('');
                  setPage(0); setExtra(0);
                }}
                className="inline-flex items-center space-x-1.5 text-xs text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded-lg transition font-medium border border-rose-200 shadow-sm"
                title="Сбросить все установленные фильтры и поиск"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Сбросить фильтры</span>
              </button>
            )}
            {data?.totalCount !== undefined && (
              <span className="text-xs text-slate-400">
                Всего в базе: <strong className="text-slate-700">{data.totalCount}</strong>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Список карточек вопросов */}
      {isLoading ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-500 flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
          <p className="text-sm">Загрузка вопросов...</p>
        </div>
      ) : questions.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
          <HelpCircle className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-semibold text-slate-800 text-base">Вопросы не найдены</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchQuery || filterSubjectId || filterType !== 'all'
              ? 'По заданным фильтрам ничего не найдено. Попробуйте сбросить фильтры.'
              : 'В банке еще нет вопросов. Нажмите "Добавить вопрос", чтобы создать первый.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q) => (
            <div
              key={q.id}
              className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition space-y-4"
            >
              {/* Верхняя строка карточки: метки и действия */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md ${
                    q.type === 'test'
                      ? 'bg-blue-100 text-blue-800'
                      : q.type === 'matching'
                      ? 'bg-purple-100 text-purple-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {q.type === 'test' ? 'Тест' : q.type === 'matching' ? 'Соответствие' : 'Открытый'}
                  </span>

                  {q.num != null && (
                    <span className="text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded" title="Номер вопроса в теме">
                      № {q.num}
                    </span>
                  )}

                  {q.chapter && (
                    <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                      Гл: {(q.chapter as any).name}
                    </span>
                  )}
                  {q.topic && (
                    <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                      Тема: {(q.topic as any).name}
                    </span>
                  )}
                  {q.source && (
                    <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      {(q.source as any).name}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400 font-mono">
                    v{q.version}
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  {isAdmin && (
                    <button
                      onClick={() => onEditQuestion(q)}
                      className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                      title="Редактировать"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => {
                        if (confirm('Вы уверены, что хотите удалить этот вопрос?')) {
                          deleteMutation.mutate(q.id);
                        }
                      }}
                      className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Тело вопроса */}
              <div className="space-y-3">
                {displayLang === 'ru' && (
                  <div className="text-sm font-medium text-slate-900 leading-relaxed">
                    <FormattedText text={q.content_ru || q.content} />
                  </div>
                )}
                {displayLang === 'tg' && (
                  <div className="text-sm font-medium text-slate-900 leading-relaxed">
                    <FormattedText text={q.content_tg || q.content} />
                  </div>
                )}
                {displayLang === 'both' && (
                  <div className="space-y-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div>
                      <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider block mb-0.5">Русский:</span>
                      <div className="text-sm font-medium text-slate-900 leading-relaxed">
                        <FormattedText text={q.content_ru || q.content} />
                      </div>
                    </div>
                    {q.content_tg && (
                      <div className="pt-2 border-t border-slate-200">
                        <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block mb-0.5">Тоҷикӣ:</span>
                        <div className="text-sm font-medium text-slate-900 leading-relaxed">
                          <FormattedText text={q.content_tg} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Главное изображение */}
                {q.image_url && (
                  <div className="pt-1">
                    <img
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                    {q.options
                      .sort((a, b) => a.order_index - b.order_index)
                      .map((opt, i) => (
                        <div
                          key={opt.id || i}
                          className={`flex items-start space-x-2 p-2 rounded-lg border text-xs text-slate-700 transition ${
                            opt.is_correct
                              ? 'bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-200'
                              : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <span className={`w-5 h-5 rounded-full font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5 ${
                            opt.is_correct
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'bg-slate-200 text-slate-700'
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
                            <img
                              src={opt.image_url}
                              alt=""
                              onClick={() => setPreviewImage(opt.image_url || null)}
                              className="w-9 h-9 object-cover rounded-lg border border-slate-200 shrink-0 cursor-pointer hover:opacity-90 hover:scale-105 transition shadow-sm bg-white"
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
                      <span className="text-[11px] font-bold uppercase text-slate-500 block mb-1">
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
                                  {m.text_tg && <div className="text-emerald-700 text-[11px] pt-0.5">{m.text_tg}</div>}
                                </>
                              )}
                            </div>
                            {m.image_url && (
                              <img
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
                      <span className="text-[11px] font-bold uppercase text-slate-500 block mb-1">
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
                                  {m.text_tg && <div className="text-emerald-700 text-[11px] pt-0.5">{m.text_tg}</div>}
                                </>
                              )}
                            </div>
                            {m.image_url && (
                              <img
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

      {/* Пагинация */}
      {totalPages > 1 && (
        <div className="space-y-3">
          {lastShown < totalPages - 1 && (
            <button
              onClick={() => setExtra((x) => x + 1)}
              disabled={loadingMore}
              className="w-full bg-white p-3 rounded-2xl border border-slate-200 text-xs font-semibold text-blue-700 hover:bg-blue-50 transition disabled:opacity-60"
            >
              {loadingMore ? 'Загрузка…' : `Показать ещё (следующие ${Math.min(PAGE_SIZE, totalCount - (lastShown + 1) * PAGE_SIZE)} вопросов, страница ${lastShown + 2})`}
            </button>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page === 0}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex items-center space-x-1"
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
                  className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={!jumpTo}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  Перейти
                </button>
              </form>
            </div>

            <button
              onClick={() => goToPage(lastShown + 1)}
              disabled={lastShown >= totalPages - 1}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex items-center space-x-1"
            >
              <span>Вперед</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Модальное окно увеличения изображения (Lightbox) */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm transition-all animate-in fade-in duration-150"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-11 right-0 text-white hover:text-slate-300 p-2 rounded-full bg-black/50 hover:bg-black/75 transition"
              title="Закрыть (Esc)"
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
