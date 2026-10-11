import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
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

interface TaxonomyManagerProps {
  onSelectSubject?: (subjectId: string) => void;
  selectedSubjectId?: string;
}

export const TaxonomyManager: React.FC<TaxonomyManagerProps> = ({
  onSelectSubject,
  selectedSubjectId,
}) => {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const [activeSubjectId, setActiveSubjectId] = useState<string>(selectedSubjectId || '');
  const [activeChapterId, setActiveChapterId] = useState<string>('');

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chapters', activeSubjectId] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['topics', activeChapterId] });
      setNewTopicName('');
    },
  });

  const addSourceMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('sources').insert({ name });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      setNewSourceName('');
    },
  });

  // Удаление (мягкое)
  const softDeleteMutation = useMutation({
    mutationFn: async ({ table, id }: { table: string; id: string }) => {
      const { error } = await supabase
        .from(table)
        .update({ is_deleted: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [variables.table] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Селектор предметов */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center">
              <Book className="w-5 h-5 mr-2 text-blue-600" />
              Предметная структура
            </h2>
            <p className="text-xs text-slate-500">
              Выберите предмет для управления его главами и темами
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newSubjectName.trim()) addSubjectMutation.mutate(newSubjectName.trim());
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={newSubjectName}
              onChange={(e) => setNewSubjectName(e.target.value)}
              placeholder="Новый предмет (напр. Химия)"
              className="text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={addSubjectMutation.isPending || !newSubjectName.trim()}
              className="text-xs px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-1 font-medium disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Добавить
            </button>
          </form>
        </div>

        {/* Список вкладок предметов */}
        <div className="flex flex-wrap gap-2 pt-4">
          {loadingSubjects ? (
            <div className="text-xs text-slate-400 flex items-center">
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Загрузка предметов...
            </div>
          ) : subjects.length === 0 ? (
            <div className="text-xs text-slate-500 italic">
              Нет добавленных предметов. Создайте первый предмет выше (например, «Химия»).
            </div>
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
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {sub.name}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Колонки: Главы, Темы и Источники */}
      {activeSubjectId && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* 1. Главы */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[520px]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <h3 className="font-semibold text-slate-900 text-sm flex items-center">
                <Layers className="w-4 h-4 mr-2 text-indigo-600" />
                Главы
              </h3>
              <span className="text-xs text-slate-400">{chapters.length}</span>
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
                className="text-xs flex-1 px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={addChapterMutation.isPending || !newChapterName.trim()}
                className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
              </button>
            </form>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {loadingChapters ? (
                <div className="text-xs text-slate-400 text-center py-4">Загрузка глав...</div>
              ) : chapters.length === 0 ? (
                <div className="text-xs text-slate-400 text-center py-8">
                  В этом предмете пока нет глав. Добавьте первую.
                </div>
              ) : (
                chapters.map((ch, idx) => (
                  <div
                    key={ch.id}
                    onClick={() => setActiveChapterId(ch.id)}
                    className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-xs font-medium transition ${
                      activeChapterId === ch.id
                        ? 'bg-indigo-50 border border-indigo-200 text-indigo-900'
                        : 'hover:bg-slate-50 border border-transparent text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span className="text-slate-400 font-mono text-[10px]">{idx + 1}.</span>
                      <span className="truncate">{ch.name}</span>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0">
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Удалить главу "${ch.name}"?`)) {
                              softDeleteMutation.mutate({ table: 'chapters', id: ch.id });
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <ChevronRight className={`w-3.5 h-3.5 ${activeChapterId === ch.id ? 'text-indigo-600' : 'text-slate-300'}`} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 2. Темы выбранной главы */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[520px]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <h3 className="font-semibold text-slate-900 text-sm flex items-center">
                <Bookmark className="w-4 h-4 mr-2 text-emerald-600" />
                Темы главы
              </h3>
              <span className="text-xs text-slate-400">{topics.length}</span>
            </div>

            {!activeChapterId ? (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-400 text-center p-4">
                Выберите главу слева, чтобы просмотреть и добавить её темы
              </div>
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
                    className="text-xs flex-1 px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={addTopicMutation.isPending || !newTopicName.trim()}
                    className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </form>

                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {loadingTopics ? (
                    <div className="text-xs text-slate-400 text-center py-4">Загрузка тем...</div>
                  ) : topics.length === 0 ? (
                    <div className="text-xs text-slate-400 text-center py-8">
                      В этой главе пока нет тем. Добавьте первую тему.
                    </div>
                  ) : (
                    topics.map((tp, idx) => (
                      <div
                        key={tp.id}
                        className="group flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 border border-slate-100 text-xs text-slate-700 font-medium transition"
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <span className="text-slate-400 font-mono text-[10px]">{idx + 1}.</span>
                          <span className="truncate">{tp.name}</span>
                        </div>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Удалить тему "${tp.name}"?`)) {
                                softDeleteMutation.mutate({ table: 'topics', id: tp.id });
                              }
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* 3. Источники / Сборники */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[520px]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <h3 className="font-semibold text-slate-900 text-sm flex items-center">
                <Library className="w-4 h-4 mr-2 text-amber-600" />
                Источники и сборники
              </h3>
              <span className="text-xs text-slate-400">{sources.length}</span>
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
                className="text-xs flex-1 px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button
                type="submit"
                disabled={addSourceMutation.isPending || !newSourceName.trim()}
                className="p-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
              </button>
            </form>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {sources.length === 0 ? (
                <div className="text-xs text-slate-400 text-center py-8">
                  Источники не добавлены. Источник позволяет отслеживать, из какого сборника взят вопрос.
                </div>
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
                        onClick={() => {
                          if (confirm(`Удалить источник "${src.name}"?`)) {
                            softDeleteMutation.mutate({ table: 'sources', id: src.id });
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
