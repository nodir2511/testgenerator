import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { notifyError, describeError } from '../lib/errors';
import { Question, QuestionType, Subject, Chapter, Topic, Source } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { QuestionPreview } from './QuestionPreview';
import { QuestionProgress, type ProgressStep } from './QuestionProgress';
import { uploadQuestionImage } from '../lib/imageCompression';
import { fetchPassages, PASSAGE_QUESTIONS } from '../lib/passages';
import { DRAFT_KEY, readDraft, ruOf, emptyOptions, emptySide, type Draft, type TestOptionState, type MatchingItemState } from '../lib/questionDraft';
import { AlertCircle, X } from 'lucide-react';
import { DraftBanner } from './question-form/DraftBanner';
import { TaxonomyFields } from './question-form/TaxonomyFields';
import { TypeAndLangBar } from './question-form/TypeAndLangBar';
import { QuestionTextFields } from './question-form/QuestionTextFields';
import { TestOptionsEditor } from './question-form/TestOptionsEditor';
import { MatchingEditor } from './question-form/MatchingEditor';
import { OpenAnswerEditor } from './question-form/OpenAnswerEditor';
import { openAnswerProblem } from '../lib/openAnswer';
import { FormActions } from './question-form/FormActions';
import { useSaveQuestion } from './question-form/useSaveQuestion';

interface QuestionFormProps {
  initialData?: Question | null;
  onSuccess: () => void;
  onCancel: () => void;
  /** Есть ли несохранённые изменения (App спрашивает перед закрытием формы) */
  onDirtyChange?: (dirty: boolean) => void;
}

export const QuestionForm: React.FC<QuestionFormProps> = ({
  initialData,
  onSuccess,
  onCancel,
  onDirtyChange,
}) => {
  const { isOwner } = useAuth();

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
  const [nctType, setNctType] = useState<string>(initialData?.nct_type || '');
  const [nctDifficulty, setNctDifficulty] = useState<string>(initialData?.nct_difficulty ? String(initialData.nct_difficulty) : '');
  // Вопрос к тексту (английский): текст темы и место вопроса в нём (1–8); необязательно
  const [passageId, setPassageId] = useState<string>(initialData?.passage_id || '');
  const [passageOrder, setPassageOrder] = useState<string>(initialData?.passage_order ? String(initialData.passage_order) : '');
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
      : emptyOptions()
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
      : emptySide('left', 4)
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
      : emptySide('right', 5)
  );

  const [uploadingImage, setUploadingImage] = useState(false);
  // Картинки вариантов и пунктов, которые ещё загружаются: сохранять вопрос в это время нельзя
  const [pendingUploads, setPendingUploads] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const topRef = React.useRef<HTMLDivElement>(null);

  // Несохранённые изменения: сравниваем содержимое с тем, что было при открытии формы
  const contentState = { type, contentRu, contentTg, imageUrl, correctNumeric, options, leftItems, rightItems, passageId, passageOrder };
  const contentJson = JSON.stringify(contentState);
  const [baseline, setBaseline] = useState(contentJson);
  const dirty = contentJson !== baseline;
  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty]);
  React.useEffect(() => () => onDirtyChange?.(false), []);

  // Черновик (только для нового вопроса): сохраняем через секунду после последней правки
  const [draft, setDraft] = useState<Draft | null>(() => (initialData ? null : readDraft()));
  React.useEffect(() => {
    if (initialData || !dirty) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...contentState, savedAt: Date.now() })); } catch { /* нет места — без черновика */ }
    }, 1000);
    return () => clearTimeout(t);
  }, [contentJson]);
  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setDraft(null);
  };
  const restoreDraft = (d: Draft) => {
    setType(d.type);
    setContentRu(d.contentRu);
    setContentTg(d.contentTg);
    setImageUrl(d.imageUrl);
    setCorrectNumeric(d.correctNumeric);
    setOptions(d.options);
    setLeftItems(d.leftItems);
    setRightItems(d.rightItems);
    setPassageId(d.passageId || '');
    setPassageOrder(d.passageOrder || '');
    setDraft(null);
  };
  // Очистить содержимое для следующего вопроса (привязка к теме и тип остаются)
  const resetForNext = () => {
    setContentRu('');
    setContentTg('');
    setImageUrl(null);
    setCorrectNumeric('');
    setOptions(emptyOptions());
    setLeftItems(emptySide('left', 4));
    setRightItems(emptySide('right', 5));
    // Текст остаётся выбранным, место переходит на следующее (1–8)
    const nextOrder = passageId && Number(passageOrder) > 0 && Number(passageOrder) < PASSAGE_QUESTIONS ? String(Number(passageOrder) + 1) : '';
    setPassageOrder(nextOrder);
    setBaseline(JSON.stringify({ type, contentRu: '', contentTg: '', imageUrl: null, correctNumeric: '', options: emptyOptions(), leftItems: emptySide('left', 4), rightItems: emptySide('right', 5), passageId, passageOrder: nextOrder }));
    setErrorMsg(null);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Загрузка списков таксономии
  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      if (error) throw error; // ошибку показываем, а не выдаём за пустой список
      return (data || []) as Subject[];
    },
  });

  const { data: chapters = [], isSuccess: chaptersLoaded } = useQuery({
    queryKey: ['chapters', subjectId],
    enabled: Boolean(subjectId),
    queryFn: async () => {
      const { data, error } = await supabase.from('chapters').select('*').eq('subject_id', subjectId).eq('is_deleted', false).order('order_index');
      if (error) throw error; // ошибку показываем, а не выдаём за пустой список
      return (data || []) as Chapter[];
    },
  });

  const { data: topics = [], isSuccess: topicsLoaded } = useQuery({
    queryKey: ['topics', chapterId],
    enabled: Boolean(chapterId),
    queryFn: async () => {
      const { data, error } = await supabase.from('topics').select('*').eq('chapter_id', chapterId).eq('is_deleted', false).order('order_index');
      if (error) throw error; // ошибку показываем, а не выдаём за пустой список
      return (data || []) as Topic[];
    },
  });

  // Запомненные в браузере глава и тема могли быть удалены (в том числе другим пользователем):
  // у нового вопроса сбрасываем их, иначе он сохранился бы в удалённую тему
  React.useEffect(() => {
    if (initialData) return;
    if (chapterId && chaptersLoaded && !chapters.some((c) => c.id === chapterId)) { setChapterId(''); setTopicId(''); }
    else if (topicId && chapterId && topicsLoaded && !topics.some((t) => t.id === topicId)) setTopicId('');
  }, [initialData, chapterId, topicId, chapters, topics, chaptersLoaded, topicsLoaded]);

  // Тексты выбранной темы; без таблицы или без текстов полей «Текст» в форме нет
  const { data: topicPassages = [] } = useQuery({
    queryKey: ['passages', topicId],
    enabled: Boolean(topicId),
    queryFn: () => fetchPassages(topicId),
  });
  const withPassage = type === 'test' && Boolean(passageId);

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sources').select('*').eq('is_deleted', false).order('name');
      if (error) throw error; // ошибку показываем, а не выдаём за пустой список
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
      setPendingUploads((n) => n + 1);
      const url = await uploadQuestionImage(file);
      // Берём список на момент окончания загрузки: за это время варианты могли добавить или убрать
      setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, image_url: url } : o)));
    } catch (err: any) {
      notifyError(err, 'Ошибка загрузки картинки');
    } finally {
      setPendingUploads((n) => n - 1);
    }
  };

  // Загрузка изображения для элемента соответствия
  const handleMatchingImageUpload = (
    side: 'left' | 'right',
    index: number,
    file: File
  ) => {
    setPendingUploads((n) => n + 1);
    uploadQuestionImage(file).then(url => {
      const put = <T extends { image_url?: string | null }>(prev: T[]) => prev.map((it, i) => (i === index ? { ...it, image_url: url } : it));
      if (side === 'left') setLeftItems(put);
      else setRightItems(put);
    }).catch(err => notifyError(err, 'Ошибка вставки картинки'))
      .finally(() => setPendingUploads((n) => n - 1));
  };

  // Сохранение вопроса (Create / Update)
  const subjectName = subjects.find((s) => s.id === subjectId)?.name ?? '';
  const saveMutation = useSaveQuestion({
    initialData, uploadingImage, pendingUploads,
    subjectId, subjectName, chapterId, topicId, sourceId, nctType, nctDifficulty,
    type, withPassage, passageId, passageOrder,
    contentRu, contentTg, imageUrl, correctNumeric,
    options, leftItems, rightItems,
    clearDraft, resetForNext, onSuccess, setErrorMsg,
  });

  // Готовность вопроса — те же правила, что при сохранении, плюс рекомендации
  const isFilled = (o: { text?: string; text_ru?: string; text_tg?: string; image_url?: string | null }) =>
    !!(o.text_ru?.trim() || o.text_tg?.trim() || o.text?.trim() || o.image_url);
  const progressSteps: ProgressStep[] = (() => {
    const steps: ProgressStep[] = [
      { id: 'binding', label: 'Предмет, глава и тема', status: subjectId && chapterId && topicId ? 'done' : 'todo', target: 'qf-taxonomy', required: true },
      { id: 'text', label: 'Текст вопроса', status: contentRu.trim() || contentTg.trim() || withPassage ? 'done' : 'todo', target: 'qf-text', required: true },
    ];
    if (type === 'test') {
      const filled = options.filter(isFilled);
      steps.push({ id: 'options', label: 'Минимум 2 варианта ответа', status: filled.length >= 2 ? 'done' : 'todo', target: 'qf-answers', required: true });
      steps.push({ id: 'correct', label: 'Отмечен верный ответ', status: filled.some((o) => o.is_correct) ? 'done' : 'warn', target: 'qf-answers' });
    } else if (type === 'matching') {
      const left = leftItems.filter(isFilled);
      const rightOk = (k: number | null | undefined) => k != null && !!rightItems[k] && isFilled(rightItems[k]);
      const matches = left.map((l) => l.match);
      const ok = left.length > 0 && rightItems.some(isFilled) && left.every((l) => rightOk(l.match)) && new Set(matches).size === matches.length;
      steps.push({ id: 'pairs', label: 'Пары для соответствия', status: ok ? 'done' : 'todo', target: 'qf-answers', required: true });
    } else if (type === 'open' && correctNumeric.trim() !== '') {
      // Ключ не для клеток бланка (дробь, минус, слишком длинный) сохранение не пропустит
      const fits = !openAnswerProblem(Number(correctNumeric), subjectName);
      steps.push({ id: 'key', label: 'Ответ вписывается в клетки бланка', status: fits ? 'done' : 'todo', target: 'qf-answers', required: true });
    }
    if (formMode === 'both') steps.push({ id: 'tg', label: 'Перевод на таджикский', status: contentTg.trim() ? 'done' : 'optional', target: 'qf-text' });
    return steps;
  })();

  return (
    <div 
      ref={topRef}
      onPaste={handlePaste}
      className="scroll-mt-24 bg-white rounded-2xl border border-slate-200 shadow-xl max-w-4xl xl:max-w-7xl mx-auto my-2 sm:my-6"
    >
      {/* Header */}
      <div className="p-4 sm:p-6 bg-slate-50 border-b border-slate-200 rounded-t-2xl flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">
            {initialData ? 'Редактирование вопроса' : 'Добавление нового вопроса'}
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            {dirty ? 'Есть несохранённые изменения' : 'Привязка к теме, тип, текст и варианты на русском и таджикском'}
          </p>
        </div>
        <button
          onClick={onCancel}
          className="w-11 h-11 shrink-0 flex items-center justify-center text-slate-500 hover:text-slate-700 rounded-xl hover:bg-slate-200 transition"
          aria-label="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        <DraftBanner draft={draft} dirty={dirty} restoreDraft={restoreDraft} clearDraft={clearDraft} />
        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-sm text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="xl:hidden"><QuestionProgress steps={progressSteps} variant="compact" /></div>

        {/* Широкий экран: слева сам вопрос, справа закреплённая колонка — привязка к теме и предпросмотр */}
        <div className="space-y-6 xl:space-y-0 xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8 xl:items-start">
        <aside className="xl:order-2 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto space-y-4">
        {/* 1. Таксономия */}
        <TaxonomyFields
          subjects={subjects} chapters={chapters} topics={topics} sources={sources}
          topicPassages={topicPassages} isOwner={isOwner} type={type}
          subjectId={subjectId} setSubjectId={setSubjectId}
          chapterId={chapterId} setChapterId={setChapterId}
          topicId={topicId} setTopicId={setTopicId}
          sourceId={sourceId} setSourceId={setSourceId}
          nctType={nctType} setNctType={setNctType}
          nctDifficulty={nctDifficulty} setNctDifficulty={setNctDifficulty}
          passageId={passageId} setPassageId={setPassageId}
          passageOrder={passageOrder} setPassageOrder={setPassageOrder}
        />

        <div className="hidden xl:block"><QuestionProgress steps={progressSteps} /></div>

        <div className="hidden xl:block">
          <QuestionPreview
            type={type} contentRu={contentRu} contentTg={contentTg} imageUrl={imageUrl}
            options={options} leftItems={leftItems} rightItems={rightItems}
            correctNumeric={correctNumeric} mode={formMode}
          />
        </div>
        </aside>

        <div className="space-y-6 min-w-0 xl:order-1">
        {/* 2. Переключатель типа вопроса */}
        <TypeAndLangBar type={type} setType={setType} formMode={formMode} setFormMode={setFormMode} />

        {/* 3. Текст вопроса */}
        <QuestionTextFields
          formMode={formMode}
          contentRu={contentRu} setContentRu={setContentRu}
          contentTg={contentTg} setContentTg={setContentTg}
          imageUrl={imageUrl} setImageUrl={setImageUrl}
          uploadingImage={uploadingImage} handleMainImageUpload={handleMainImageUpload}
        />

        {/* 4. ТИП: ТЕСТОВЫЙ С ВАРИАНТАМИ */}
        {type === 'test' && (
          <TestOptionsEditor
            options={options} setOptions={setOptions}
            formMode={formMode} handleOptionImageUpload={handleOptionImageUpload}
          />
        )}

        {/* 5. ТИП: СООТВЕТСТВИЕ С ДВОЙНЫМ РЕДАКТОРОМ */}
        {type === 'matching' && (
          <MatchingEditor
            leftItems={leftItems} setLeftItems={setLeftItems}
            rightItems={rightItems} setRightItems={setRightItems}
            formMode={formMode} handleMatchingImageUpload={handleMatchingImageUpload}
          />
        )}

        {/* 6. ТИП: ОТКРЫТЫЙ */}
        {type === 'open' && (
          <OpenAnswerEditor correctNumeric={correctNumeric} setCorrectNumeric={setCorrectNumeric} subjectName={subjectName} />
        )}

        </div>
        </div>

        {/* Действия: на телефоне закреплены над нижним меню */}
        <FormActions
          initialData={initialData} onCancel={onCancel} saveMutation={saveMutation}
          uploadingImage={uploadingImage} pendingUploads={pendingUploads}
        />
      </div>
    </div>
  );
};
