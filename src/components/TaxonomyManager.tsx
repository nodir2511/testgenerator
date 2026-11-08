import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { assertRowsChanged } from '../lib/errors';
import { Subject, Chapter, Topic, Source } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { 
  FolderPlus, 
  Trash2, 
  ChevronRight, 
  Book, 
  Layers, 
  Bookmark, 
  Plus,
  Loader2,
  Library
} from 'lucide-react';
import { confirmAction } from '../lib/confirm';
import { Button, Card, EmptyState, IconButton, PageHeader, Skeleton } from './ui';

interface TaxonomyManagerProps {
  onSelectSubject?: (subjectId: string) => void;
  selectedSubjectId?: string;
}

export const TaxonomyManager: React.FC<TaxonomyManagerProps> = ({
  onSelectSubject,
  selectedSubjectId,
}) => {
  const queryClient = useQueryClient();
  const { isAdmin, canManage } = useAuth();

  const [activeSubjectId, setActiveSubjectId] = useState<string>(selectedSubjectId || '');
  const [activeChapterId, setActiveChapterId] = useState<string>('');
  const [mobileTab, setMobileTab] = useState<'chapters' | 'topics' | 'sources'>('chapters');

  // Формы добавления
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newChapterName, setNewChapterName] = useState('');
  const [newTopicName, setNewTopicName] = useState('');
  const [newSourceName, setNewSourceName] = useState('');

  // 1. Загрузка предметов
  const { data: subjects = [], isLoading: loadingSubjects } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subjects')
        .select('*')
        .eq('is_deleted', false)
        .order('name');
      if (error) throw error;
      return data as Subject[];
    },
  });

  // Автоматический выбор первого предмета, если ничего не выбрано
  React.useEffect(() => {
    if (!activeSubjectId && subjects.length > 0) {
      const firstId = subjects[0].id;
      setActiveSubjectId(firstId);
      if (onSelectSubject) onSelectSubject(firstId);
    }
  }, [subjects, activeSubjectId, onSelectSubject]);

  // 2. Загрузка глав для выбранного предмета
  const { data: chapters = [], isLoading: loadingChapters } = useQuery({
    queryKey: ['chapters', activeSubjectId],
    enabled: Boolean(activeSubjectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chapters')
        .select('*')
        .eq('subject_id', activeSubjectId)
        .eq('is_deleted', false)
        .order('order_index');
      if (error) throw error;
      return data as Chapter[];
    },
  });

  // 3. Загрузка тем для выбранной главы
  const { data: topics = [], isLoading: loadingTopics } = useQuery({
    queryKey: ['topics', activeChapterId],
    enabled: Boolean(activeChapterId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('topics')
        .select('*')
        .eq('chapter_id', activeChapterId)
        .eq('is_deleted', false)
        .order('order_index');
      if (error) throw error;
      return data as Topic[];
    },
  });

  // 4. Загрузка источников
  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sources')
        .select('*')
        .eq('is_deleted', false)
        .order('name');
      if (error) throw error;
      return data as Source[];
    },
  });

  // Мутации добавления
  const addSubjectMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('subjects').insert({ name });
      if (error) throw error;
    },
    meta: { action: 'Не удалось добавить предмет', success: 'Предмет добавлен в базу' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
      setNewSubjectName('');
    },
  });

  const addChapterMutation = useMutation({
    mutationFn: async ({ subjectId, name }: { subjectId: string; name: string }) => {
      const order = chapters.length + 1;
      const { error } = await supabase
        .from('chapters')
        .insert({ subject_id: subjectId, name, order_index: order });
      if (error) throw error;
    },
    meta: { action: 'Не удалось добавить главу', success: 'Глава добавлена в базу' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chapters', activeSubjectId] });
      queryClient.invalidateQueries({ queryKey: ['topics_for_generation'] });
      setNewChapterName('');
    },
  });

  const addTopicMutation = useMutation({
    mutationFn: async ({ chapterId, name }: { chapterId: string; name: string }) => {
      const order = topics.length + 1;
      const { error } = await supabase
        .from('topics')
        .insert({ chapter_id: chapterId, name, order_index: order });
      if (error) throw error;
    },
    meta: { action: 'Не удалось добавить тему', success: 'Тема добавлена в базу' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topics', activeChapterId] });
      queryClient.invalidateQueries({ queryKey: ['topics_for_generation'] });
      setNewTopicName('');
    },
  });

  const addSourceMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('sources').insert({ name });
      if (error) throw error;
    },
    meta: { action: 'Не удалось добавить источник', success: 'Источник добавлен в базу' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      setNewSourceName('');
    },
  });

  // Сколько живых вопросов будет удалено вместе с темой/главой
  const countActiveQuestions = async (column: 'topic_id' | 'chapter_id', id: string): Promise<number> => {
    const { count } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq(column, id)
      .eq('is_deleted', false);
    return count || 0;
  };

  // Удаление (мягкое). Тема/глава забирает с собой свои вопросы (и темы главы), чтобы они не попадали в билеты
  const softDeleteMutation = useMutation({
    mutationFn: async ({ table, id }: { table: string; id: string }) => {
      const { data, error } = await supabase
        .from(table)
        .update({ is_deleted: true })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      assertRowsChanged(data, 'запись');

      const now = new Date().toISOString();
      const dropQuestions = async (column: 'topic_id' | 'chapter_id') => {
        const { error: qErr } = await supabase
          .from('questions')
          .update({ is_deleted: true, deleted_at: now })
          .eq(column, id)
          .eq('is_deleted', false);
        if (qErr) throw qErr;
      };
      if (table === 'topics') await dropQuestions('topic_id');
      if (table === 'chapters') {
        const { error: tErr } = await supabase.from('topics').update({ is_deleted: true }).eq('chapter_id', id).eq('is_deleted', false);
        if (tErr) throw tErr;
        await dropQuestions('chapter_id');
      }
    },
    meta: { action: 'Не удалось удалить запись', success: 'Запись удалена из базы' },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [variables.table] });
      // Справочники и вопросы, закэшированные в других разделах (генератор, импорт, банк вопросов)
      for (const key of ['questions', 'pool_stats', 'topics_for_generation', 'question_counts', 'chapters', 'topics', 'all_chapters', 'all_topics']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      // Сохранённые в браузере выбор темы/главы мог указывать на удалённую запись
      for (const k of ['examiner_last_new_chapter_id', 'examiner_last_new_topic_id']) {
        try { if (localStorage.getItem(k) === variables.id) localStorage.removeItem(k); } catch { /* ignore */ }
      }
    },
  });

  return (
    <div className="space-y-6">
      {/* Селектор предметов */}
      <Card padding="none" className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <PageHeader
              icon={Book}
              title="Предметы и темы"
              description="Выберите предмет, чтобы управлять его главами, темами и источниками"
              className="px-0"
            />
          </div>

          {isAdmin && <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newSubjectName.trim()) addSubjectMutation.mutate(newSubjectName.trim());
            }}
            className="flex items-center gap-2 w-full sm:w-auto"
          >
            <input
              type="text"
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              placeholder="Новый предмет (напр. Химия)"
              className="min-w-0 flex-1 text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <Button variant="primary" type="submit" disabled={addSubjectMutation.isPending || !newSubjectName.trim()}>
              <Plus className="w-3.5 h-3.5" />
              Добавить
            </Button>
          </form>}
        </div>

        {/* Список вкладок предметов */}
        <div className="flex flex-wrap gap-2 pt-4">
          {loadingSubjects ? (
            <div role="status" aria-label="Загрузка предметов" className="flex gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-24" />)}</div>
          ) : subjects.length === 0 ? (
            <EmptyState icon={Book} title="Предметов пока нет" description="Создайте первый предмет в поле выше, например «Химия»." className="w-full py-6" />
          ) : (
            subjects.map((sub) => (
              <button
                key={sub.id}
                onClick={() => {
                  setActiveSubjectId(sub.id);
                  setActiveChapterId('');
                  if (onSelectSubject) onSelectSubject(sub.id);
                }}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeSubjectId === sub.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                } min-h-[40px]`}
              >
                {sub.name}
              </button>
            ))
          )}
        </div>
      </Card>

      {/* Колонки: Главы, Темы и Источники */}
      {activeSubjectId && (
        <>
          {/* Переключатель вкладок на мобильных устройствах */}
          <div className="md:hidden flex p-1 bg-slate-100 rounded-xl mb-3" role="tablist" aria-label="Разделы структуры">
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === 'chapters'}
              onClick={() => setMobileTab('chapters')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition min-h-[40px] flex items-center justify-center gap-1.5 ${
                mobileTab === 'chapters' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Главы ({chapters.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === 'topics'}
              onClick={() => setMobileTab('topics')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition min-h-[40px] flex items-center justify-center gap-1.5 ${
                mobileTab === 'topics' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Темы ({topics.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === 'sources'}
              onClick={() => setMobileTab('sources')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition min-h-[40px] flex items-center justify-center gap-1.5 ${
                mobileTab === 'sources' ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Library className="w-3.5 h-3.5" />
              <span>Источники ({sources.length})</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 1. Главы */}
            <Card padding="none" className={`p-5 flex flex-col h-[520px] xl:h-[calc(100vh-17rem)] xl:min-h-[520px] ${mobileTab !== 'chapters' ? 'hidden md:flex' : ''}`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <h3 className="font-semibold text-slate-900 text-sm flex items-center">
                <Layers className="w-4 h-4 mr-2 text-indigo-600" />
                Главы
              </h3>
              <span className="text-xs text-slate-500">{chapters.length}</span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newChapterName.trim()) {
                  addChapterMutation.mutate({ subjectId: activeSubjectId, name: newChapterName.trim() });
                }
              }}
              className="flex gap-2 mb-3"
            >
              <input
                type="text"
                value={newChapterName}
                onChange={(e) => setNewChapterName(e.target.value)}
                placeholder="Название главы"
                className="text-sm flex-1 px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <IconButton
                type="submit"
                icon={Plus}
                label="Добавить главу"
                variant="primary"
                loading={addChapterMutation.isPending}
                disabled={!newChapterName.trim()}
                className="w-10 h-10 rounded-lg"
              />
            </form>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {loadingChapters ? (
                <div role="status" aria-label="Загрузка глав" className="space-y-1.5">{[0, 1, 2, 3, 4, 5].slice(0, 4).map((i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : chapters.length === 0 ? (
                <EmptyState icon={Layers} title="Глав пока нет" description="Добавьте первую главу в поле выше." className="py-8" />
              ) : (
                chapters.map((ch, idx) => (
                  <div
                    key={ch.id}
                    onClick={() => { setActiveChapterId(ch.id); setMobileTab('topics'); }}
                    className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-xs font-medium transition ${
                      activeChapterId === ch.id
                        ? 'bg-indigo-50 border border-indigo-200 text-indigo-900'
                        : 'hover:bg-slate-50 border border-transparent text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span className="text-slate-500 font-mono text-xs">{idx + 1}.</span>
                      <span className="truncate">{ch.name}</span>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0">
                      {canManage(activeSubjectId) && (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const n = await countActiveQuestions('chapter_id', ch.id);
                            if (await confirmAction({
                              title: `Удалить главу «${ch.name}»?`,
                              message: n ? 'Вместе с главой уйдут её темы и вопросы.' : undefined,
                              details: n ? [`Вопросов в главе: ${n}`] : undefined,
                              confirmLabel: 'Удалить главу', cancelLabel: 'Оставить', tone: 'danger',
                            })) {
                              softDeleteMutation.mutate({ table: 'chapters', id: ch.id });
                            }
                          }}
                          className="w-9 h-9 -my-1 inline-flex items-center justify-center shrink-0 text-slate-500 hover:text-destructive hover:bg-destructive-soft rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Удалить главу" title="Удалить главу"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <ChevronRight className={`w-3.5 h-3.5 ${activeChapterId === ch.id ? 'text-indigo-600' : 'text-slate-500'}`} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* 2. Темы выбранной главы */}
          <Card padding="none" className={`p-5 flex flex-col h-[520px] xl:h-[calc(100vh-17rem)] xl:min-h-[520px] ${mobileTab !== 'topics' ? 'hidden md:flex' : ''}`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <h3 className="font-semibold text-slate-900 text-sm flex items-center">
                <Bookmark className="w-4 h-4 mr-2 text-emerald-600" />
                Темы главы
              </h3>
              <span className="text-xs text-slate-500">{topics.length}</span>
            </div>

            {!activeChapterId ? (
              <EmptyState icon={Bookmark} title="Выберите главу" description="Темы выбранной главы появятся здесь, и их можно будет добавлять." className="flex-1 justify-center" />
            ) : (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newTopicName.trim()) {
                      addTopicMutation.mutate({ chapterId: activeChapterId, name: newTopicName.trim() });
                    }
                  }}
                  className="flex gap-2 mb-3"
                >
                  <input
                    type="text"
                    value={newTopicName}
                    onChange={(e) => setNewTopicName(e.target.value)}
                    placeholder="Название темы"
                    className="text-sm flex-1 px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <IconButton
                    type="submit"
                    icon={Plus}
                    label="Добавить тему"
                    variant="primary"
                    loading={addTopicMutation.isPending}
                    disabled={!newTopicName.trim()}
                    className="w-10 h-10 rounded-lg"
                  />
                </form>

                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {loadingTopics ? (
                    <div role="status" aria-label="Загрузка тем" className="space-y-1.5">{[0, 1, 2, 3, 4, 5].slice(0, 4).map((i) => <Skeleton key={i} className="h-10" />)}</div>
                  ) : topics.length === 0 ? (
                    <EmptyState icon={Bookmark} title="Тем пока нет" description="Добавьте первую тему в поле выше." className="py-8" />
                  ) : (
                    topics.map((tp, idx) => (
                      <div
                        key={tp.id}
                        className="group flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 border border-slate-100 text-xs text-slate-700 font-medium transition"
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <span className="text-slate-500 font-mono text-xs">{idx + 1}.</span>
                          <span className="truncate">{tp.name}</span>
                        </div>
                        {canManage(activeSubjectId) && (
                          <button
                            type="button"
                            onClick={async () => {
                              const n = await countActiveQuestions('topic_id', tp.id);
                              if (await confirmAction({
                                title: `Удалить тему «${tp.name}»?`,
                                message: n ? 'Вместе с темой уйдут её вопросы.' : undefined,
                                details: n ? [`Вопросов в теме: ${n}`] : undefined,
                                confirmLabel: 'Удалить тему', cancelLabel: 'Оставить', tone: 'danger',
                              })) {
                                softDeleteMutation.mutate({ table: 'topics', id: tp.id });
                              }
                            }}
                            className="w-9 h-9 -my-1 inline-flex items-center justify-center shrink-0 text-slate-500 hover:text-destructive hover:bg-destructive-soft rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Удалить тему" title="Удалить тему"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </Card>

          {/* 3. Источники / Сборники */}
          <Card padding="none" className={`p-5 flex flex-col h-[520px] xl:h-[calc(100vh-17rem)] xl:min-h-[520px] ${mobileTab !== 'sources' ? 'hidden md:flex' : ''}`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <h3 className="font-semibold text-slate-900 text-sm flex items-center">
                <Library className="w-4 h-4 mr-2 text-amber-600" />
                Источники и сборники
              </h3>
              <span className="text-xs text-slate-500">{sources.length}</span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newSourceName.trim()) addSourceMutation.mutate(newSourceName.trim());
              }}
              className="flex gap-2 mb-3"
            >
              <input
                type="text"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                placeholder="Сборник / Автор (напр. ЕГЭ 2025)"
                className="text-sm flex-1 px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <IconButton
                type="submit"
                icon={Plus}
                label="Добавить источник"
                variant="primary"
                loading={addSourceMutation.isPending}
                disabled={!newSourceName.trim()}
                className="w-10 h-10 rounded-lg"
              />
            </form>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {sources.length === 0 ? (
                <EmptyState icon={Library} title="Источников нет" description="Источник позволяет отслеживать, из какого сборника взят вопрос." className="py-8" />
              ) : (
                sources.map((src) => (
                  <div
                    key={src.id}
                    className="group flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 border border-slate-100 text-xs text-slate-700 font-medium transition"
                  >
                    <span className="truncate">{src.name}</span>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (await confirmAction({
                            title: `Удалить источник «${src.name}»?`,
                            confirmLabel: 'Удалить источник', cancelLabel: 'Оставить', tone: 'danger',
                          })) {
                            softDeleteMutation.mutate({ table: 'sources', id: src.id });
                          }
                        }}
                        className="w-9 h-9 -my-1 inline-flex items-center justify-center shrink-0 text-slate-500 hover:text-destructive hover:bg-destructive-soft rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Удалить источник" title="Удалить источник"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
        </>
      )}
    </div>
  );
};
