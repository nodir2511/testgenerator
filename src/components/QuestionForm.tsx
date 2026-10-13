import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { notifyError, describeError, must } from '../lib/errors';
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
  X,
  Languages
} from 'lucide-react';

interface QuestionFormProps {
  initialData?: Question | null;
  onSuccess: () => void;
  onCancel: () => void;
}

interface TestOptionState {
  id?: string;
  text: string;
  text_ru?: string;
  text_tg?: string;
  image_url?: string | null;
  is_correct?: boolean;
}

interface MatchingItemState {
  id?: string;
  side: 'left' | 'right';
  text: string;
  text_ru?: string;
  text_tg?: string;
  image_url?: string | null;
  /** Только для левой колонки: индекс подходящего элемента правой колонки (ответ) */
  match?: number | null;
}

// Русское поле: если вопрос только на таджикском, base (= content) совпадает с таджикским текстом — в русское его не копируем
const ruOf = (ru?: string | null, base?: string | null, tg?: string | null): string =>
  ru || (base && base !== tg ? base : '') || '';

export const QuestionForm: React.FC<QuestionFormProps> = ({
  initialData,
  onSuccess,
  onCancel,
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Режим редактора: 'both' (двойной RU + TG), 'ru' (только русский), 'tg' (только таджикский)
  const [formMode, setFormMode] = useState<'both' | 'ru' | 'tg'>('both');

  // Основные поля (сохраняем таксономию в localStorage для быстрого добавления пачки вопросов)
  const [subjectId, setSubjectId] = useState(
    initialData?.subject_id || localStorage.getItem('examiner_last_new_subject_id') || ''
  );
  const [chapterId, setChapterId] = useState(
    initialData?.chapter_id || localStorage.getItem('examiner_last_new_chapter_id') || ''
  );
  const [topicId, setTopicId] = useState(
    initialData?.topic_id || localStorage.getItem('examiner_last_new_topic_id') || ''
  );
  const [sourceId, setSourceId] = useState(
    initialData?.source_id || localStorage.getItem('examiner_last_new_source_id') || ''
  );
  const [type, setType] = useState<QuestionType>(
    initialData?.type || (localStorage.getItem('examiner_last_new_type') as QuestionType) || 'test'
  );

  // Текст вопроса на двух языках
  const [contentRu, setContentRu] = useState(ruOf(initialData?.content_ru, initialData?.content, initialData?.content_tg));
  const [contentTg, setContentTg] = useState(initialData?.content_tg || '');
  const [imageUrl, setImageUrl] = useState<string | null>(initialData?.image_url || null);

  const [correctNumeric, setCorrectNumeric] = useState<string>(
    initialData?.correct_numeric_answer !== undefined && initialData?.correct_numeric_answer !== null
      ? String(initialData.correct_numeric_answer)
      : ''
  );

  // Варианты для тестов с поддержкой RU + TG
  const [options, setOptions] = useState<TestOptionState[]>(
    initialData?.options && initialData.options.length > 0
      ? initialData.options.map(o => ({
          id: o.id,
          text: ruOf(o.text_ru, o.text, o.text_tg),
          text_ru: ruOf(o.text_ru, o.text, o.text_tg),
          text_tg: o.text_tg || '',
          image_url: o.image_url,
          is_correct: o.is_correct || false,
        }))
      : [
          { text: '', text_ru: '', text_tg: '', is_correct: true },
          { text: '', text_ru: '', text_tg: '', is_correct: false },
          { text: '', text_ru: '', text_tg: '', is_correct: false },
          { text: '', text_ru: '', text_tg: '', is_correct: false },
        ]
  );

  // Элементы на соответствие с поддержкой RU + TG
  const [leftItems, setLeftItems] = useState<MatchingItemState[]>(
    initialData?.matching_items && initialData.matching_items.filter(m => m.side === 'left').length > 0
      ? initialData.matching_items.filter(m => m.side === 'left').map(m => ({
          id: m.id,
          side: 'left',
          text: ruOf(m.text_ru, m.text, m.text_tg),
          text_ru: ruOf(m.text_ru, m.text, m.text_tg),
          text_tg: m.text_tg || '',
          image_url: m.image_url,
          match: (() => {
            const k = initialData.matching_items!.filter(x => x.side === 'right').findIndex(x => !!m.correct_match_id && x.id === m.correct_match_id);
            return k >= 0 ? k : null;
          })(),
        }))
      : [
          { side: 'left', text: '', text_ru: '', text_tg: '' },
          { side: 'left', text: '', text_ru: '', text_tg: '' },
          { side: 'left', text: '', text_ru: '', text_tg: '' },
          { side: 'left', text: '', text_ru: '', text_tg: '' },
        ]
  );

  const [rightItems, setRightItems] = useState<MatchingItemState[]>(
    initialData?.matching_items && initialData.matching_items.filter(m => m.side === 'right').length > 0
      ? initialData.matching_items.filter(m => m.side === 'right').map(m => ({
          id: m.id,
          side: 'right',
          text: ruOf(m.text_ru, m.text, m.text_tg),
          text_ru: ruOf(m.text_ru, m.text, m.text_tg),
          text_tg: m.text_tg || '',
          image_url: m.image_url,
        }))
      : [
          { side: 'right', text: '', text_ru: '', text_tg: '' },
          { side: 'right', text: '', text_ru: '', text_tg: '' },
          { side: 'right', text: '', text_ru: '', text_tg: '' },
          { side: 'right', text: '', text_ru: '', text_tg: '' },
          { side: 'right', text: '', text_ru: '', text_tg: '' },
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
      setErrorMsg(describeError(err, 'Ошибка загрузки файла'));
    } finally {
      setUploadingImage(false);
    }
  };

  // Вставка скриншота из буфера обмена (Ctrl + V)
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          try {
            setUploadingImage(true);
            const url = await uploadQuestionImage(file);
            setImageUrl(url);
          } catch (err: any) {
            setErrorMsg(describeError(err, 'Ошибка вставки картинки'));
          } finally {
            setUploadingImage(false);
          }
        }
        break;
      }
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
      notifyError(err, 'Ошибка загрузки картинки');
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
    }).catch(err => notifyError(err, 'Ошибка вставки картинки'));
  };

  // Сохранение вопроса (Create / Update)
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!subjectId || !chapterId || !topicId) {
        throw new Error('Пожалуйста, выберите предмет, главу и тему');
      }
      if (!contentRu.trim() && !contentTg.trim()) {
        throw new Error('Пожалуйста, заполните текст вопроса (хотя бы на одном языке)');
      }

      if (type === 'test') {
        const validOptions = options.filter(
          o => (o.text_ru?.trim() || o.text_tg?.trim() || o.text?.trim() || o.image_url)
        );
        if (validOptions.length < 2) {
          throw new Error('Тестовый вопрос должен содержать минимум 2 варианта ответа');
        }
      }

      if (type === 'matching') {
        const validLeft = leftItems.filter(
          l => (l.text_ru?.trim() || l.text_tg?.trim() || l.text?.trim() || l.image_url)
        );
        const validRight = rightItems.filter(
          r => (r.text_ru?.trim() || r.text_tg?.trim() || r.text?.trim() || r.image_url)
        );
        if (validLeft.length === 0 || validRight.length === 0) {
          throw new Error('Заполните элементы в обеих колонках задания на соответствие');
        }
        const filledRight = (k: number | null | undefined) => k != null && !!rightItems[k] && !!(rightItems[k].text_ru?.trim() || rightItems[k].text_tg?.trim() || rightItems[k].text?.trim() || rightItems[k].image_url);
        if (validLeft.some(l => !filledRight(l.match))) {
          throw new Error('Укажите правильный ответ (номер из правой колонки) для каждого элемента левой колонки');
        }
        if (new Set(validLeft.map(l => l.match)).size !== validLeft.length) {
          throw new Error('Два элемента левой колонки не могут иметь один и тот же ответ');
        }
      }

      const numericVal = type === 'open' && correctNumeric.trim() !== '' ? Number(correctNumeric) : null;
      const primaryContent = contentRu.trim() || contentTg.trim();

      const buildOptionRows = (qid: string) =>
        options
          .filter(o => o.text_ru?.trim() || o.text_tg?.trim() || o.text?.trim() || o.image_url)
          .map((o, idx) => {
            const rText = (o.text_ru || o.text || '').trim();
            const tText = (o.text_tg || '').trim();
            return {
              question_id: qid,
              text: rText || tText,
              text_ru: rText || null,
              text_tg: tText || null,
              image_url: o.image_url,
              is_correct: o.is_correct || false,
              order_index: idx + 1,
            };
          });

      const buildItemRows = (qid: string) => {
        const map = (side: 'left' | 'right') => (x: MatchingItemState, idx: number) => {
          const rText = (x.text_ru || x.text || '').trim();
          const tText = (x.text_tg || '').trim();
          return {
            question_id: qid,
            side,
            text: rText || tText,
            text_ru: rText || null,
            text_tg: tText || null,
            image_url: x.image_url,
            order_index: idx + 1,
          };
        };
        const filled = (x: MatchingItemState) => x.text_ru?.trim() || x.text_tg?.trim() || x.text?.trim() || x.image_url;
        return [...leftItems.filter(filled).map(map('left')), ...rightItems.filter(filled).map(map('right'))];
      };

      // Записывает ответы (correct_match_id) для только что вставленных элементов соответствия
      const applyMatches = async (rows: any[]) => {
        const filled = (x: MatchingItemState) => x.text_ru?.trim() || x.text_tg?.trim() || x.text?.trim() || x.image_url;
        const lefts = leftItems.map((x, i) => ({ x, i })).filter(({ x }) => filled(x));
        const rights = rightItems.map((x, i) => ({ x, i })).filter(({ x }) => filled(x));
        for (let p = 0; p < lefts.length; p++) {
          const k = lefts[p].x.match;
          const rp = rights.findIndex(({ i }) => i === k);
          if (rp < 0) continue;
          const leftRow = rows.find(r => r.side === 'left' && r.order_index === p + 1);
          const rightRow = rows.find(r => r.side === 'right' && r.order_index === rp + 1);
          if (!leftRow || !rightRow) throw new Error('Не удалось сохранить ответы соответствия');
          await must(supabase.from('matching_items').update({ correct_match_id: rightRow.id }).eq('id', leftRow.id));
        }
      };

      const questionFields = {
        subject_id: subjectId,
        chapter_id: chapterId,
        topic_id: topicId,
        source_id: sourceId || null,
        type,
        content: primaryContent,
        content_ru: contentRu.trim() || null,
        content_tg: contentTg.trim() || null,
        image_url: imageUrl,
        correct_numeric_answer: numericVal,
      };

      if (initialData?.id) {
        // Обновление существующего вопроса. Порядок защищает от потери данных при сбое связи:
        // 1) вставляем новые варианты, 2) обновляем вопрос (проверка версии), 3) только потом удаляем старые.
        const oldOptionIds = (initialData.options || []).map(o => o.id);
        const oldItemIds = (initialData.matching_items || []).map(m => m.id);

        const insertRows = async (table: 'question_options' | 'matching_items', rows: any[]): Promise<any[]> => {
          const { data, error } = await supabase.from(table).insert(rows).select('*');
          if (error) throw error;
          return (data || []) as any[];
        };
        const newOptions = type === 'test' ? await insertRows('question_options', buildOptionRows(initialData.id)) : [];
        const newItems = type === 'matching' ? await insertRows('matching_items', buildItemRows(initialData.id)) : [];
        if (type === 'matching') {
          try {
            await applyMatches(newItems);
          } catch (e) {
            await supabase.from('matching_items').delete().in('id', newItems.map(x => x.id));
            throw e;
          }
        }
        const dropNew = async () => {
          const o = newOptions;
          const m = newItems;
          if (o.length) await supabase.from('question_options').delete().in('id', o.map(x => x.id));
          if (m.length) await supabase.from('matching_items').delete().in('id', m.map(x => x.id));
        };

        const { data: updatedQuestion, error: qErr } = await supabase
          .from('questions')
          .update({ ...questionFields, updated_by: user?.id, version: initialData.version + 1 })
          .eq('id', initialData.id)
          .eq('version', initialData.version)
          .select()
          .single();

        if (qErr || !updatedQuestion) {
          await dropNew();
          if (qErr && qErr.code !== 'PGRST116') throw qErr;
          throw new Error(
            'Конфликт одновременного редактирования! Вопрос был изменен другим пользователем. Обновите страницу.'
          );
        }

        // Старые варианты и элементы (и оставшиеся от прежнего типа вопроса) удаляем в последнюю очередь
        try {
          const oldOpts = type === 'test' ? oldOptionIds : null;
          const oldMatch = type === 'matching' ? oldItemIds : null;
          if (type === 'test') {
            if (oldOpts && oldOpts.length) await must(supabase.from('question_options').delete().in('id', oldOpts));
            await must(supabase.from('matching_items').delete().eq('question_id', initialData.id));
          } else if (type === 'matching') {
            if (oldMatch && oldMatch.length) await must(supabase.from('matching_items').delete().in('id', oldMatch));
            await must(supabase.from('question_options').delete().eq('question_id', initialData.id));
          } else {
            await must(supabase.from('question_options').delete().eq('question_id', initialData.id));
            await must(supabase.from('matching_items').delete().eq('question_id', initialData.id));
          }
        } catch (cleanupErr) {
          await dropNew();
          throw new Error('Вопрос сохранён, но варианты не обновились (ошибка связи). Обновите страницу и сохраните ещё раз.');
        }
      } else {
        // Создание нового вопроса
        const { data: newQ, error: qErr } = await supabase
          .from('questions')
          .insert({ ...questionFields, created_by: user?.id, version: 1 })
          .select()
          .single();

        if (qErr || !newQ) throw qErr;

        try {
          if (type === 'test') await must(supabase.from('question_options').insert(buildOptionRows(newQ.id)));
          if (type === 'matching') {
            const { data: created, error: insErr } = await supabase.from('matching_items').insert(buildItemRows(newQ.id)).select('*');
            if (insErr) throw insErr;
            await applyMatches(created || []);
          }
        } catch (childErr) {
          // Не оставляем вопрос без вариантов
          await supabase.from('questions').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', newQ.id);
          throw childErr;
        }

        // Запоминаем таксономию для следующего добавления
        localStorage.setItem('examiner_last_new_subject_id', subjectId);
        localStorage.setItem('examiner_last_new_chapter_id', chapterId);
        localStorage.setItem('examiner_last_new_topic_id', topicId);
        if (sourceId) localStorage.setItem('examiner_last_new_source_id', sourceId);
        localStorage.setItem('examiner_last_new_type', type);
      }
    },
    meta: { success: initialData?.id ? 'Изменения вопроса сохранены в базе' : 'Новый вопрос добавлен в базу' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      onSuccess();
    },
    onError: (err: any) => {
      setErrorMsg(describeError(err, 'Ошибка сохранения вопроса'));
    },
  });

  return (
    <div 
      onPaste={handlePaste}
      className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden max-w-4xl mx-auto my-6"
    >
      {/* Header */}
      <div className="p-6 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {initialData ? 'Редактирование вопроса' : 'Добавление нового вопроса'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Укажите привязку к теме, тип вопроса, текст и варианты на русском и таджикском языках
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

        {/* ПЕРЕКЛЮЧАТЕЛЬ ДВУЯЗЫЧНОГО РЕЖИМА */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3 gap-2">
          <div className="flex items-center space-x-2">
            <Languages className="w-4 h-4 text-purple-600" />
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Языковой режим редактора:
            </span>
          </div>
          <div className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-slate-100 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setFormMode('both')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center space-x-1.5 ${
                formMode === 'both'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🌐 Двойной (RU + TJ)</span>
            </button>
            <button
              type="button"
              onClick={() => setFormMode('ru')}
              className={`px-3 py-1.5 rounded-lg transition ${
                formMode === 'ru'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Русский</span>
            </button>
            <button
              type="button"
              onClick={() => setFormMode('tg')}
              className={`px-3 py-1.5 rounded-lg transition ${
                formMode === 'tg'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Тоҷикӣ</span>
            </button>
          </div>
        </div>

        {/* 3. Текст вопроса */}
        <div className="space-y-4">
          {formMode === 'both' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormulaEditor
                label="Текст вопроса (Русский) *"
                value={contentRu}
                onChange={setContentRu}
                placeholder="Например: Укажите формулу серной кислоты или решите уравнение реакции..."
                rows={4}
              />
              <FormulaEditor
                label="Матни савол (Тоҷикӣ)"
                value={contentTg}
                onChange={setContentTg}
                placeholder="Масалан: Формулаи кислотаи сулфатро муайян намоед..."
                rows={4}
              />
            </div>
          ) : formMode === 'ru' ? (
            <FormulaEditor
              label="Текст вопроса (Русский) *"
              value={contentRu}
              onChange={setContentRu}
              placeholder="Например: Укажите формулу серной кислоты или решите уравнение реакции..."
              rows={4}
            />
          ) : (
            <FormulaEditor
              label="Матни савол (Тоҷикӣ) *"
              value={contentTg}
              onChange={setContentTg}
              placeholder="Масалан: Формулаи кислотаи сулфатро муайян намоед..."
              rows={4}
            />
          )}

          {/* Картинка к вопросу + вставка из буфера (Ctrl+V) */}
          <div className="flex items-center space-x-4 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex-1 flex items-center space-x-3">
              {imageUrl ? (
                <div className="relative group h-20 w-auto min-w-[80px] max-w-[200px] rounded-lg overflow-hidden border border-slate-300 bg-white shrink-0 p-1">
                  <img src={imageUrl} alt="Вопрос" className="h-full w-full object-contain" />
                  <button
                    type="button"
                    onClick={() => setImageUrl(null)}
                    className="absolute inset-0 bg-red-600/80 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition"
                    title="Удалить картинку"
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
                  Можно нажать Ctrl+V для вставки скриншота или загрузить файл (WebP, PNG, JPG)
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

        {/* 4. ТИП: ТЕСТОВЫЙ С ВАРИАНТАМИ */}
        {type === 'test' && (
          <div className="space-y-3 pt-3 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Варианты ответа (A, B, C, D...)
              </label>
              <button
                type="button"
                onClick={() => setOptions([...options, { text: '', text_ru: '', text_tg: '', is_correct: false }])}
                className="text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg font-semibold flex items-center space-x-1 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить вариант</span>
              </button>
            </div>

            <div className="space-y-3">
              {options.map((opt, idx) => {
                const optLetter = ['A', 'B', 'C', 'D', 'E', 'F'][idx] || String.fromCharCode(65 + idx);

                return (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-800 text-xs font-bold flex items-center justify-center shrink-0">
                          {optLetter}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...options];
                            updated[idx].is_correct = !updated[idx].is_correct;
                            setOptions(updated);
                          }}
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold border flex items-center space-x-1 transition ${
                            opt.is_correct
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                              : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <CheckCircle2 className={`w-3.5 h-3.5 ${opt.is_correct ? 'text-emerald-600' : 'text-slate-300'}`} />
                          <span>{opt.is_correct ? 'Верный ответ' : 'Отметить как верный'}</span>
                        </button>
                      </div>

                      <div className="flex items-center space-x-1">
                        <label 
                          className="cursor-pointer p-1.5 bg-white hover:bg-slate-100 text-slate-500 rounded-lg border border-slate-300 transition" 
                          title="Прикрепить изображение формулы к варианту"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
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
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition"
                            title="Удалить вариант"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Поля ввода варианта в зависимости от выбранного режима */}
                    {formMode === 'both' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Русский (RU)</label>
                          <input
                            type="text"
                            value={opt.text_ru ?? opt.text ?? ''}
                            onChange={(e) => {
                              const updated = [...options];
                              updated[idx].text_ru = e.target.value;
                              updated[idx].text = e.target.value;
                              setOptions(updated);
                            }}
                            placeholder={`Вариант ${optLetter} (RU)`}
                            className="w-full text-xs p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-emerald-600 uppercase mb-0.5">Тоҷикӣ (TJ)</label>
                          <input
                            type="text"
                            value={opt.text_tg ?? ''}
                            onChange={(e) => {
                              const updated = [...options];
                              updated[idx].text_tg = e.target.value;
                              setOptions(updated);
                            }}
                            placeholder={`Варианти ${optLetter} (TJ)`}
                            className="w-full text-xs p-2 bg-white border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                          />
                        </div>
                      </div>
                    ) : formMode === 'ru' ? (
                      <div>
                        <input
                          type="text"
                          value={opt.text_ru ?? opt.text ?? ''}
                          onChange={(e) => {
                            const updated = [...options];
                            updated[idx].text_ru = e.target.value;
                            updated[idx].text = e.target.value;
                            setOptions(updated);
                          }}
                          placeholder={`Вариант ${optLetter} (RU)`}
                          className="w-full text-xs p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                        />
                      </div>
                    ) : (
                      <div>
                        <input
                          type="text"
                          value={opt.text_tg ?? ''}
                          onChange={(e) => {
                            const updated = [...options];
                            updated[idx].text_tg = e.target.value;
                            setOptions(updated);
                          }}
                          placeholder={`Варианти ${optLetter} (TJ)`}
                          className="w-full text-xs p-2 bg-white border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                        />
                      </div>
                    )}

                    {/* Превью картинки варианта */}
                    {opt.image_url && (
                      <div className="flex items-center space-x-2 pt-1">
                        <img 
                          src={opt.image_url} 
                          alt="Превью" 
                          className="h-16 w-auto max-w-[150px] object-contain rounded border bg-white p-1" 
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...options];
                            updated[idx].image_url = null;
                            setOptions(updated);
                          }}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Удалить картинку
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 5. ТИП: СООТВЕТСТВИЕ С ДВОЙНЫМ РЕДАКТОРОМ */}
        {type === 'matching' && (
          <div className="space-y-4 pt-3 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              Левая колонка маркируется буквами (A, B, C, D), правая колонка — цифрами (1, 2, 3, 4, 5). В двойном режиме можно заполнять русский и таджикский варианты параллельно.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Левая колонка (A, B, C, D) */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-700">Левая часть (A, B, C, D...)</span>
                  <button
                    type="button"
                    onClick={() => setLeftItems([...leftItems, { side: 'left', text: '', text_ru: '', text_tg: '' }])}
                    className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить</span>
                  </button>
                </div>

                {leftItems.map((item, idx) => {
                  const letter = ['A', 'B', 'C', 'D', 'E', 'F'][idx] || String.fromCharCode(65 + idx);
                  return (
                    <div key={idx} className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                            {letter}
                          </span>
                          <label className="flex items-center gap-1 text-[11px] text-slate-500">
                            <span>ответ →</span>
                            <select
                              value={item.match ?? ''}
                              onChange={(e) => {
                                const updated = [...leftItems];
                                updated[idx] = { ...updated[idx], match: e.target.value === '' ? null : Number(e.target.value) };
                                setLeftItems(updated);
                              }}
                              className={`text-xs font-bold px-1.5 py-0.5 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${item.match == null ? 'border-red-300 bg-red-50 text-red-600' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}`}
                            >
                              <option value="">—</option>
                              {rightItems.map((_, k) => (
                                <option key={k} value={k}>{k + 1}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="flex items-center space-x-1">
                          <label className="cursor-pointer p-1 text-slate-400 hover:text-slate-600 rounded border border-slate-200" title="Картинка">
                            <ImageIcon className="w-3 h-3" />
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
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {formMode === 'both' ? (
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={item.text_ru ?? item.text ?? ''}
                            onChange={(e) => {
                              const updated = [...leftItems];
                              updated[idx].text_ru = e.target.value;
                              updated[idx].text = e.target.value;
                              setLeftItems(updated);
                            }}
                            placeholder={`Элемент ${letter} (RU)`}
                            className="w-full text-xs p-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <input
                            type="text"
                            value={item.text_tg ?? ''}
                            onChange={(e) => {
                              const updated = [...leftItems];
                              updated[idx].text_tg = e.target.value;
                              setLeftItems(updated);
                            }}
                            placeholder={`Элементи ${letter} (TJ)`}
                            className="w-full text-xs p-1.5 border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>
                      ) : formMode === 'ru' ? (
                        <input
                          type="text"
                          value={item.text_ru ?? item.text ?? ''}
                          onChange={(e) => {
                            const updated = [...leftItems];
                            updated[idx].text_ru = e.target.value;
                            updated[idx].text = e.target.value;
                            setLeftItems(updated);
                          }}
                          placeholder={`Элемент ${letter} (RU)`}
                          className="w-full text-xs p-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      ) : (
                        <input
                          type="text"
                          value={item.text_tg ?? ''}
                          onChange={(e) => {
                            const updated = [...leftItems];
                            updated[idx].text_tg = e.target.value;
                            setLeftItems(updated);
                          }}
                          placeholder={`Элементи ${letter} (TJ)`}
                          className="w-full text-xs p-1.5 border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      )}

                      {item.image_url && (
                        <div className="flex items-center space-x-1 pt-1">
                          <img src={item.image_url} alt="" className="h-10 w-auto object-contain rounded border" />
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...leftItems];
                              updated[idx].image_url = null;
                              setLeftItems(updated);
                            }}
                            className="text-[10px] text-red-500 hover:underline"
                          >
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Правая колонка (1, 2, 3, 4, 5) */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-700">Правая часть (1, 2, 3...)</span>
                  <button
                    type="button"
                    onClick={() => setRightItems([...rightItems, { side: 'right', text: '', text_ru: '', text_tg: '' }])}
                    className="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить</span>
                  </button>
                </div>

                {rightItems.map((item, idx) => (
                  <div key={idx} className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                        {idx + 1}
                      </span>
                      <div className="flex items-center space-x-1">
                        <label className="cursor-pointer p-1 text-slate-400 hover:text-slate-600 rounded border border-slate-200" title="Картинка">
                          <ImageIcon className="w-3 h-3" />
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
                            onClick={() => {
                              setRightItems(rightItems.filter((_, i) => i !== idx));
                              setLeftItems(leftItems.map(l => ({ ...l, match: l.match == null ? null : l.match === idx ? null : l.match > idx ? l.match - 1 : l.match })));
                            }}
                            className="text-slate-400 hover:text-red-500 p-1"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {formMode === 'both' ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={item.text_ru ?? item.text ?? ''}
                          onChange={(e) => {
                            const updated = [...rightItems];
                            updated[idx].text_ru = e.target.value;
                            updated[idx].text = e.target.value;
                            setRightItems(updated);
                          }}
                          placeholder={`Элемент ${idx + 1} (RU)`}
                          className="w-full text-xs p-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          value={item.text_tg ?? ''}
                          onChange={(e) => {
                            const updated = [...rightItems];
                            updated[idx].text_tg = e.target.value;
                            setRightItems(updated);
                          }}
                          placeholder={`Элементи ${idx + 1} (TJ)`}
                          className="w-full text-xs p-1.5 border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    ) : formMode === 'ru' ? (
                      <input
                        type="text"
                        value={item.text_ru ?? item.text ?? ''}
                        onChange={(e) => {
                          const updated = [...rightItems];
                          updated[idx].text_ru = e.target.value;
                          updated[idx].text = e.target.value;
                          setRightItems(updated);
                        }}
                        placeholder={`Элемент ${idx + 1} (RU)`}
                        className="w-full text-xs p-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <input
                        type="text"
                        value={item.text_tg ?? ''}
                        onChange={(e) => {
                          const updated = [...rightItems];
                          updated[idx].text_tg = e.target.value;
                          setRightItems(updated);
                        }}
                        placeholder={`Элементи ${idx + 1} (TJ)`}
                        className="w-full text-xs p-1.5 border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    )}

                    {item.image_url && (
                      <div className="flex items-center space-x-1 pt-1">
                        <img src={item.image_url} alt="" className="h-10 w-auto object-contain rounded border" />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...rightItems];
                            updated[idx].image_url = null;
                            setRightItems(updated);
                          }}
                          className="text-[10px] text-red-500 hover:underline"
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 6. ТИП: ОТКРЫТЫЙ */}
        {type === 'open' && (
          <div className="pt-3 border-t border-slate-200 space-y-2">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Правильный числовой ответ (необязательно)
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
