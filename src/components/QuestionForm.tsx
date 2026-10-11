import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Question, QuestionType, Subject, Chapter, Topic, Source } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { FormulaEditor } from './FormulaEditor';
import { uploadQuestionImage } from '../lib/imageCompression';
import { 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  Trash2, 
  Image as ImageIcon, 
  Upload, 
  Loader2,
  X
} from 'lucide-react';

interface QuestionFormProps {
  initialData?: Question | null;
  onSuccess: () => void;
  onCancel: () => void;
}

interface TestOptionState {
  id?: string;
  text: string;
  image_url?: string | null;
  is_correct?: boolean;
}

interface MatchingItemState {
  id?: string;
  side: 'left' | 'right';
  text: string;
  image_url?: string | null;
}

export const QuestionForm: React.FC<QuestionFormProps> = ({
  initialData,
  onSuccess,
  onCancel,
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Основные поля
  const [subjectId, setSubjectId] = useState(initialData?.subject_id || '');
  const [chapterId, setChapterId] = useState(initialData?.chapter_id || '');
  const [topicId, setTopicId] = useState(initialData?.topic_id || '');
  const [sourceId, setSourceId] = useState(initialData?.source_id || '');
  const [type, setType] = useState<QuestionType>(initialData?.type || 'test');
  const [content, setContent] = useState(initialData?.content || '');
  const [imageUrl, setImageUrl] = useState<string | null>(initialData?.image_url || null);
  const [correctNumeric, setCorrectNumeric] = useState<string>(
    initialData?.correct_numeric_answer !== undefined && initialData?.correct_numeric_answer !== null
      ? String(initialData.correct_numeric_answer)
      : ''
  );

  // Варианты для тестов
  const [options, setOptions] = useState<TestOptionState[]>(
    initialData?.options && initialData.options.length > 0
      ? initialData.options.map(o => ({ text: o.text, image_url: o.image_url, is_correct: o.is_correct }))
      : [
          { text: '', is_correct: false },
          { text: '', is_correct: false },
          { text: '', is_correct: false },
          { text: '', is_correct: false },
        ]
  );

  // Элементы на соответствие
  const [leftItems, setLeftItems] = useState<MatchingItemState[]>(
    initialData?.matching_items?.filter(m => m.side === 'left') || [
      { side: 'left', text: '' },
      { side: 'left', text: '' },
      { side: 'left', text: '' },
    ]
  );
  const [rightItems, setRightItems] = useState<MatchingItemState[]>(
    initialData?.matching_items?.filter(m => m.side === 'right') || [
      { side: 'right', text: '' },
      { side: 'right', text: '' },
      { side: 'right', text: '' },
      { side: 'right', text: '' },
    ]
  );

  const [uploadingImage, setUploadingImage] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Загрузка списков таксономии
  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Subject[];
    },
  });

  const { data: chapters = [] } = useQuery({
    queryKey: ['chapters', subjectId],
    enabled: Boolean(subjectId),
    queryFn: async () => {
      const { data } = await supabase.from('chapters').select('*').eq('subject_id', subjectId).eq('is_deleted', false).order('order_index');
      return (data || []) as Chapter[];
    },
  });

  const { data: topics = [] } = useQuery({
    queryKey: ['topics', chapterId],
    enabled: Boolean(chapterId),
    queryFn: async () => {
      const { data } = await supabase.from('topics').select('*').eq('chapter_id', chapterId).eq('is_deleted', false).order('order_index');
      return (data || []) as Topic[];
    },
  });

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data } = await supabase.from('sources').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Source[];
    },
  });

  // Загрузка главного изображения вопроса
  const handleMainImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingImage(true);
      setErrorMsg(null);
      const url = await uploadQuestionImage(file);
      setImageUrl(url);
    } catch (err: any) {
      setErrorMsg(err.message || 'Ошибка загрузки файла');
    } finally {
      setUploadingImage(false);
    }
  };

  // Загрузка изображения для варианта теста
  const handleOptionImageUpload = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadQuestionImage(file);
      const updated = [...options];
      updated[index].image_url = url;
      setOptions(updated);
    } catch (err: any) {
      alert('Ошибка загрузки картинки: ' + err.message);
    }
  };

  // Загрузка изображения для элемента соответствия
  const handleMatchingImageUpload = (
    side: 'left' | 'right',
    index: number,
    file: File
  ) => {
    uploadQuestionImage(file).then(url => {
      if (side === 'left') {
        const updated = [...leftItems];
        updated[index].image_url = url;
        setLeftItems(updated);
      } else {
        const updated = [...rightItems];
        updated[index].image_url = url;
        setRightItems(updated);
      }
    }).catch(err => alert(err.message));
  };

  // Сохранение вопроса (Create / Update с оптимистической блокировкой)
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!subjectId || !chapterId || !topicId) {
        throw new Error('Пожалуйста, выберите предмет, главу и тему');
      }
      if (!content.trim()) {
        throw new Error('Пожалуйста, заполните текст вопроса');
      }

      if (type === 'test') {
        const validOptions = options.filter(o => o.text.trim() || o.image_url);
        if (validOptions.length < 2) {
          throw new Error('Тестовый вопрос должен содержать минимум 2 варианта ответа');
        }
      }

      if (type === 'matching') {
        const validLeft = leftItems.filter(l => l.text.trim() || l.image_url);
        const validRight = rightItems.filter(r => r.text.trim() || r.image_url);
        if (validLeft.length === 0 || validRight.length === 0) {
          throw new Error('Заполните элементы в обеих колонках задания на соответствие');
        }
      }

      const numericVal = type === 'open' && correctNumeric.trim() !== '' ? Number(correctNumeric) : null;

      if (initialData?.id) {
        // Оптимистическая блокировка: обновляем только если version совпадает
        const { data: updatedQuestion, error: qErr } = await supabase
          .from('questions')
          .update({
            subject_id: subjectId,
            chapter_id: chapterId,
            topic_id: topicId,
            source_id: sourceId || null,
            type,
            content,
            image_url: imageUrl,
            correct_numeric_answer: numericVal,
            updated_by: user?.id,
            version: initialData.version + 1,
          })
          .eq('id', initialData.id)
          .eq('version', initialData.version)
          .select()
          .single();

        if (qErr || !updatedQuestion) {
          throw new Error(
            'Конфликт одновременного редактирования! Вопрос был изменен другим пользователем. Обновите страницу.'
          );
        }

        // Пересохраняем связанные опции
        if (type === 'test') {
          await supabase.from('question_options').delete().eq('question_id', initialData.id);
          const validOptions = options
            .filter(o => o.text.trim() || o.image_url)
            .map((o, idx) => ({
              question_id: initialData.id,
              text: o.text.trim(),
              image_url: o.image_url,
              is_correct: o.is_correct || false,
              order_index: idx + 1,
            }));
          await supabase.from('question_options').insert(validOptions);
        }

        if (type === 'matching') {
          await supabase.from('matching_items').delete().eq('question_id', initialData.id);
          const allItems = [
            ...leftItems.filter(l => l.text.trim() || l.image_url).map((l, idx) => ({
              question_id: initialData.id,
              side: 'left' as const,
              text: l.text.trim(),
              image_url: l.image_url,
              order_index: idx + 1,
            })),
            ...rightItems.filter(r => r.text.trim() || r.image_url).map((r, idx) => ({
              question_id: initialData.id,
              side: 'right' as const,
              text: r.text.trim(),
              image_url: r.image_url,
              order_index: idx + 1,
            })),
          ];
          await supabase.from('matching_items').insert(allItems);
        }
      } else {
        // Создание нового вопроса
        const { data: newQ, error: qErr } = await supabase
          .from('questions')
          .insert({
            subject_id: subjectId,
            chapter_id: chapterId,
            topic_id: topicId,
            source_id: sourceId || null,
            type,
            content,
            image_url: imageUrl,
            correct_numeric_answer: numericVal,
            created_by: user?.id,
            version: 1,
          })
          .select()
          .single();

        if (qErr || !newQ) throw qErr;

        if (type === 'test') {
          const validOptions = options
            .filter(o => o.text.trim() || o.image_url)
            .map((o, idx) => ({
              question_id: newQ.id,
              text: o.text.trim(),
              image_url: o.image_url,
              is_correct: o.is_correct || false,
              order_index: idx + 1,
            }));
          await supabase.from('question_options').insert(validOptions);
        }

        if (type === 'matching') {
          const allItems = [
            ...leftItems.filter(l => l.text.trim() || l.image_url).map((l, idx) => ({
              question_id: newQ.id,
              side: 'left' as const,
              text: l.text.trim(),
              image_url: l.image_url,
              order_index: idx + 1,
            })),
            ...rightItems.filter(r => r.text.trim() || r.image_url).map((r, idx) => ({
              question_id: newQ.id,
              side: 'right' as const,
              text: r.text.trim(),
              image_url: r.image_url,
              order_index: idx + 1,
            })),
          ];
          await supabase.from('matching_items').insert(allItems);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      onSuccess();
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Ошибка сохранения вопроса');
    },
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden max-w-4xl mx-auto my-6">
      {/* Header */}
      <div className="p-6 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {initialData ? 'Редактирование вопроса' : 'Добавление нового вопроса'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Укажите привязку к теме, тип вопроса и содержание
          </p>
        </div>
        <button
          onClick={onCancel}
          className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-6 space-y-6">
        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-sm text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 1. Таксономия */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Предмет *
            </label>
            <select
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setChapterId('');
                setTopicId('');
              }}
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            >
              <option value="">-- Выберите предмет --</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Глава *
            </label>
            <select
              disabled={!subjectId}
              value={chapterId}
              onChange={(e) => {
                setChapterId(e.target.value);
                setTopicId('');
              }}
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium disabled:bg-slate-100"
            >
              <option value="">-- Выберите главу --</option>
              {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Тема *
            </label>
            <select
              disabled={!chapterId}
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium disabled:bg-slate-100"
            >
              <option value="">-- Выберите тему --</option>
              {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Источник / Сборник
            </label>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            >
              <option value="">-- Без источника --</option>
              {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {/* 2. Переключатель типа вопроса */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
            Тип вопроса *
          </label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: 'test', title: 'Тестовый', desc: 'С вариантами ответа' },
              { id: 'matching', title: 'Соответствие', desc: 'Два списка (левый и правый)' },
              { id: 'open', title: 'Открытый', desc: 'Числовой ответ' },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id as QuestionType)}
                className={`p-3 text-left rounded-xl border transition ${
                  type === t.id
                    ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="font-bold text-sm text-slate-900">{t.title}</div>
                <div className="text-[11px] text-slate-500">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Текст вопроса и картинка к вопросу */}
        <div className="space-y-3">
          <FormulaEditor
            label="Текст вопроса *"
            value={content}
            onChange={setContent}
            placeholder="Например: Укажите формулу серной кислоты или решите уравнение реакции..."
            rows={4}
          />

          {/* Картинка к вопросу */}
          <div className="flex items-center space-x-4 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex-1 flex items-center space-x-3">
              {imageUrl ? (
                <div className="relative group w-16 h-16 rounded-lg overflow-hidden border border-slate-300 bg-white shrink-0">
                  <img src={imageUrl} alt="Вопрос" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImageUrl(null)}
                    className="absolute inset-0 bg-red-600/80 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="w-12 h-12 rounded-lg bg-slate-200 text-slate-400 flex items-center justify-center shrink-0">
                  <ImageIcon className="w-6 h-6" />
                </div>
              )}
              <div className="text-xs">
                <span className="font-medium text-slate-700 block">
                  {imageUrl ? 'Изображение прикреплено' : 'Добавить схему, рисунок или формулу'}
                </span>
                <span className="text-slate-400">
                  Автоматически сжимается в WebP (до 500 КБ) для быстрой работы
                </span>
              </div>
            </div>

            <label className="cursor-pointer px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg border border-slate-300 flex items-center space-x-1 transition shadow-sm">
              {uploadingImage ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : (
                <Upload className="w-3.5 h-3.5 mr-1" />
              )}
              <span>{imageUrl ? 'Заменить' : 'Загрузить файл'}</span>
              <input
                type="file"
                accept="image/*"
                disabled={uploadingImage}
                onChange={handleMainImageUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* 4. Специфичные поля для каждого типа */}

        {/* ТИП: ТЕСТОВЫЙ */}
        {type === 'test' && (
          <div className="space-y-3 pt-3 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Варианты ответа (произвольное количество)
              </label>
              <button
                type="button"
                onClick={() => setOptions([...options, { text: '', is_correct: false }])}
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center space-x-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить вариант</span>
              </button>
            </div>

            <div className="space-y-3">
              {options.map((opt, idx) => (
                <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center space-x-3">
                    <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      value={opt.text}
                      onChange={(e) => {
                        const updated = [...options];
                        updated[idx].text = e.target.value;
                        setOptions(updated);
                      }}
                      placeholder={`Вариант ${idx + 1}`}
                      className="flex-1 text-sm p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                    />

                    {/* Загрузка картинки к варианту */}
                    <label className="cursor-pointer p-2 bg-white hover:bg-slate-100 text-slate-500 rounded-lg border border-slate-300 transition" title="Картинка к варианту">
                      <ImageIcon className="w-4 h-4" />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleOptionImageUpload(idx, e)}
                        className="hidden"
                      />
                    </label>

                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                        className="p-2 text-slate-400 hover:text-red-600 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {opt.image_url && (
                    <div className="flex items-center space-x-2 pl-9">
                      <img src={opt.image_url} alt="Превью" className="w-12 h-12 object-cover rounded border" />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = [...options];
                          updated[idx].image_url = null;
                          setOptions(updated);
                        }}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Удалить картинку варианта
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ТИП: СООТВЕТСТВИЕ */}
        {type === 'matching' && (
          <div className="space-y-4 pt-3 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              Количество элементов слева и справа может отличаться. Буквы (A, B, C, D...) для левой части и цифры (1, 2, 3...) для правой части подставляются автоматически.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Левая колонка */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-700">Левая часть (A, B, C, D...)</span>
                  <button
                    type="button"
                    onClick={() => setLeftItems([...leftItems, { side: 'left', text: '' }])}
                    className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить</span>
                  </button>
                </div>
                {leftItems.map((item, idx) => (
                  <div key={idx} className="flex items-center space-x-2">
                    <span className="font-bold text-xs text-slate-500 w-5">
                      {['A', 'B', 'C', 'D', 'E', 'F'][idx] || String.fromCharCode(65 + idx)}:
                    </span>
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) => {
                        const updated = [...leftItems];
                        updated[idx].text = e.target.value;
                        setLeftItems(updated);
                      }}
                      placeholder="Элемент"
                      className="flex-1 text-xs p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <label className="cursor-pointer p-1.5 bg-white text-slate-400 hover:text-slate-600 rounded border border-slate-300">
                      <ImageIcon className="w-3.5 h-3.5" />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => e.target.files?.[0] && handleMatchingImageUpload('left', idx, e.target.files[0])}
                        className="hidden"
                      />
                    </label>
                    {leftItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLeftItems(leftItems.filter((_, i) => i !== idx))}
                        className="text-slate-400 hover:text-red-500 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Правая колонка */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-700">Правая часть (1, 2, 3...)</span>
                  <button
                    type="button"
                    onClick={() => setRightItems([...rightItems, { side: 'right', text: '' }])}
                    className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить</span>
                  </button>
                </div>
                {rightItems.map((item, idx) => (
                  <div key={idx} className="flex items-center space-x-2">
                    <span className="font-bold text-xs text-slate-500 w-5">{idx + 1}:</span>
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) => {
                        const updated = [...rightItems];
                        updated[idx].text = e.target.value;
                        setRightItems(updated);
                      }}
                      placeholder="Элемент"
                      className="flex-1 text-xs p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <label className="cursor-pointer p-1.5 bg-white text-slate-400 hover:text-slate-600 rounded border border-slate-300">
                      <ImageIcon className="w-3.5 h-3.5" />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => e.target.files?.[0] && handleMatchingImageUpload('right', idx, e.target.files[0])}
                        className="hidden"
                      />
                    </label>
                    {rightItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRightItems(rightItems.filter((_, i) => i !== idx))}
                        className="text-slate-400 hover:text-red-500 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ТИП: ОТКРЫТЫЙ */}
        {type === 'open' && (
          <div className="pt-3 border-t border-slate-200 space-y-2">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Правильный числовой ответ (необязательно для генерации билетов)
            </label>
            <input
              type="number"
              step="any"
              value={correctNumeric}
              onChange={(e) => setCorrectNumeric(e.target.value)}
              placeholder="Например: 42 или -5"
              className="w-full sm:w-64 text-sm p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
          </div>
        )}

        {/* Действия */}
        <div className="flex items-center justify-end space-x-3 pt-6 border-t border-slate-200">
          <button
            type="button"
            onClick={onCancel}
            disabled={saveMutation.isPending}
            className="px-4 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 text-sm font-medium rounded-lg transition"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow transition flex items-center space-x-2 disabled:opacity-50"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>{initialData ? 'Сохранить изменения' : 'Создать вопрос'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
