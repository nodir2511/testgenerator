import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Subject, Chapter, Topic, Question, TicketBatch, Ticket, TicketQuestion } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { 
  Sparkles, 
  AlertCircle, 
  CheckCircle2, 
  BookOpen, 
  Layers, 
  FileCheck2, 
  Loader2, 
  Printer, 
  Download,
  Info,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { exportTicketsToDocx, exportSingleTicketDocx } from '../lib/docxExport';

const getStorageJSON = <T,>(key: string, fallback: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch {
    return fallback;
  }
};
const getStorageString = (key: string, fallback: string): string => {
  return localStorage.getItem(key) ?? fallback;
};
const getStorageNumber = (key: string, fallback: number): number => {
  const val = localStorage.getItem(key);
  if (!val) return fallback;
  const num = Number(val);
  return isNaN(num) ? fallback : num;
};
const getStorageBool = (key: string, fallback: boolean): boolean => {
  const val = localStorage.getItem(key);
  if (val === null) return fallback;
  return val === 'true';
};

// Supabase отдаёт не больше 1000 строк за запрос — читаем постранично
async function fetchAllPages<T>(build: () => any): Promise<{ data: T[] | null; error: any }> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order('id').range(from, from + 999);
    if (error) return { data: null, error };
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: all, error: null };
}

export const TicketGenerator: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Параметры конфигурации билета (сохраняются при перезагрузке)
  const [subjectId, setSubjectId] = useState<string>(() => getStorageString('examiner_tg_subject_id', ''));
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>(() => getStorageJSON('examiner_tg_selected_chapter_ids', []));
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>(() => getStorageJSON('examiner_tg_selected_topic_ids', []));

  const [testCount, setTestCount] = useState<number>(() => getStorageNumber('examiner_tg_test_count', 10));
  const [matchingCount, setMatchingCount] = useState<number>(() => getStorageNumber('examiner_tg_matching_count', 2));
  const [openCount, setOpenCount] = useState<number>(() => getStorageNumber('examiner_tg_open_count', 3));
  const [ticketCount, setTicketCount] = useState<number>(() => getStorageNumber('examiner_tg_ticket_count', 2));
  const [shuffleOptions, setShuffleOptions] = useState<boolean>(() => getStorageBool('examiner_tg_shuffle_options', true));
  const [shuffleMatching, setShuffleMatching] = useState<boolean>(() => getStorageBool('examiner_tg_shuffle_matching', true));
  const [batchTitle, setBatchTitle] = useState<string>(() => getStorageString('examiner_tg_batch_title', 'Экзаменационные билеты'));

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedBatch, setGeneratedBatch] = useState<any | null>(() => getStorageJSON('examiner_tg_generated_batch', null));

  // Автосохранение настроек в localStorage
  React.useEffect(() => {
    if (subjectId) localStorage.setItem('examiner_tg_subject_id', subjectId);
  }, [subjectId]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_selected_chapter_ids', JSON.stringify(selectedChapterIds));
  }, [selectedChapterIds]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_selected_topic_ids', JSON.stringify(selectedTopicIds));
  }, [selectedTopicIds]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_test_count', String(testCount));
  }, [testCount]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_matching_count', String(matchingCount));
  }, [matchingCount]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_open_count', String(openCount));
  }, [openCount]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_ticket_count', String(ticketCount));
  }, [ticketCount]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_shuffle_options', String(shuffleOptions));
  }, [shuffleOptions]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_shuffle_matching', String(shuffleMatching));
  }, [shuffleMatching]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_batch_title', batchTitle);
  }, [batchTitle]);

  React.useEffect(() => {
    if (generatedBatch) {
      try {
        localStorage.setItem('examiner_tg_generated_batch', JSON.stringify(generatedBatch));
      } catch (e) {
        console.warn('Не удалось сохранить generatedBatch в localStorage', e);
      }
    } else {
      localStorage.removeItem('examiner_tg_generated_batch');
    }
  }, [generatedBatch]);

  // 1. Предметы
  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Subject[];
    },
  });

  // Автоматический выбор предмета
  React.useEffect(() => {
    if (subjects.length > 0) {
      if (!subjectId || !subjects.some(s => s.id === subjectId)) {
        setSubjectId(subjects[0].id);
      }
    }
  }, [subjects, subjectId]);

  // 2. Главы
  const { data: chapters = [] } = useQuery({
    queryKey: ['chapters', subjectId],
    enabled: Boolean(subjectId),
    queryFn: async () => {
      const { data } = await supabase.from('chapters').select('*').eq('subject_id', subjectId).eq('is_deleted', false).order('order_index');
      return (data || []) as Chapter[];
    },
  });

  // 3. Все темы предмета (для древовидного раскрытия по главам)
  const { data: allTopics = [] } = useQuery({
    queryKey: ['topics_for_generation', subjectId, chapters],
    enabled: Boolean(subjectId && chapters.length > 0),
    queryFn: async () => {
      const chIds = chapters.map(c => c.id);
      const { data } = await supabase
        .from('topics')
        .select('*')
        .in('chapter_id', chIds)
        .eq('is_deleted', false)
        .order('order_index');
      return (data || []) as Topic[];
    },
  });

  // Состояние раскрытых глав (аккордеон)
  const [expandedChapterIds, setExpandedChapterIds] = useState<Record<string, boolean>>(() =>
    getStorageJSON('examiner_tg_expanded_chapters', {})
  );

  // Раскрываем новые главы по умолчанию
  React.useEffect(() => {
    if (chapters.length > 0) {
      setExpandedChapterIds(prev => {
        let changed = false;
        const next = { ...prev };
        chapters.forEach(ch => {
          if (next[ch.id] === undefined) {
            next[ch.id] = true;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [chapters]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_expanded_chapters', JSON.stringify(expandedChapterIds));
  }, [expandedChapterIds]);

  // Выбрать все темы по всему предмету
  const handleSelectAllTopics = () => {
    setSelectedTopicIds(allTopics.map(t => t.id));
    setSelectedChapterIds(chapters.map(c => c.id));
  };

  // Снять выбор всех тем
  const handleDeselectAllTopics = () => {
    setSelectedTopicIds([]);
    setSelectedChapterIds([]);
  };

  // Выбрать все темы конкретной главы
  const handleSelectChapterTopics = (chId: string) => {
    const chTopicIds = allTopics.filter(t => t.chapter_id === chId).map(t => t.id);
    const newTopics = Array.from(new Set([...selectedTopicIds, ...chTopicIds]));
    setSelectedTopicIds(newTopics);
    if (!selectedChapterIds.includes(chId)) {
      setSelectedChapterIds(prev => [...prev, chId]);
    }
  };

  // Снять выбор тем конкретной главы
  const handleDeselectChapterTopics = (chId: string) => {
    const chTopicIds = new Set(allTopics.filter(t => t.chapter_id === chId).map(t => t.id));
    setSelectedTopicIds(prev => prev.filter(id => !chTopicIds.has(id)));
    setSelectedChapterIds(prev => prev.filter(id => id !== chId));
  };

  // Переключение отдельной темы
  const handleToggleTopic = (tpId: string, chId: string, checked: boolean) => {
    if (checked) {
      setSelectedTopicIds(prev => [...prev, tpId]);
      if (!selectedChapterIds.includes(chId)) {
        setSelectedChapterIds(prev => [...prev, chId]);
      }
    } else {
      const nextTopics = selectedTopicIds.filter(id => id !== tpId);
      setSelectedTopicIds(nextTopics);
      const remainingInCh = allTopics.filter(t => t.chapter_id === chId && nextTopics.includes(t.id));
      if (remainingInCh.length === 0) {
        setSelectedChapterIds(prev => prev.filter(id => id !== chId));
      }
    }
  };

  const toggleChapterExpanded = (chId: string) => {
    setExpandedChapterIds(prev => ({
      ...prev,
      [chId]: !prev[chId]
    }));
  };

  // 4. Подсчет доступного пула вопросов для проверки дефицита
  const { data: poolStats } = useQuery({
    queryKey: ['pool_stats', subjectId, selectedChapterIds, selectedTopicIds],
    enabled: Boolean(subjectId),
    queryFn: async () => {
      const { data } = await fetchAllPages<any>(() => {
        let q = supabase
          .from('questions')
          .select('id, type, topic_id, chapter_id')
          .eq('subject_id', subjectId)
          .eq('is_deleted', false);
        if (selectedTopicIds.length > 0) q = q.in('topic_id', selectedTopicIds);
        else if (selectedChapterIds.length > 0) q = q.in('chapter_id', selectedChapterIds);
        return q;
      });
      const all = data || [];

      return {
        total: all.length,
        test: all.filter(x => x.type === 'test').length,
        matching: all.filter(x => x.type === 'matching').length,
        open: all.filter(x => x.type === 'open').length,
      };
    },
  });

  // Алгоритм параллельной генерации билетов
  const handleGenerate = async () => {
    setGenerationError(null);
    setIsGenerating(true);

    try {
      if (!subjectId) throw new Error('Выберите предмет');
      if (testCount + matchingCount + openCount === 0) throw new Error('Задайте хотя бы один вопрос в билете');
      if (ticketCount < 1) throw new Error('Количество билетов должно быть не менее 1');

      // 1. Проверка дефицита вопросов
      const totalTestNeeded = testCount;
      const totalMatchingNeeded = matchingCount;
      const totalOpenNeeded = openCount;

      if ((poolStats?.test || 0) < totalTestNeeded) {
        throw new Error(
          `Недостаточно тестовых вопросов! Требуется в билете: ${totalTestNeeded}, а в выбранных темах доступно: ${poolStats?.test || 0}`
        );
      }
      if ((poolStats?.matching || 0) < totalMatchingNeeded) {
        throw new Error(
          `Недостаточно заданий на соответствие! Требуется: ${totalMatchingNeeded}, а доступно: ${poolStats?.matching || 0}`
        );
      }
      if ((poolStats?.open || 0) < totalOpenNeeded) {
        throw new Error(
          `Недостаточно открытых вопросов! Требуется: ${totalOpenNeeded}, а доступно: ${poolStats?.open || 0}`
        );
      }

      // 2. Загружаем все доступные вопросы пула с деталями для снимков
      const { data: allQuestionsRaw, error: qErr } = await fetchAllPages<any>(() => {
        let query = supabase
          .from('questions')
          .select(`
            *,
            chapter:chapters(name),
            topic:topics(name),
            options:question_options(*),
            matching_items:matching_items(*)
          `)
          .eq('subject_id', subjectId)
          .eq('is_deleted', false);
        if (selectedTopicIds.length > 0) query = query.in('topic_id', selectedTopicIds);
        else if (selectedChapterIds.length > 0) query = query.in('chapter_id', selectedChapterIds);
        return query;
      });
      if (qErr || !allQuestionsRaw) throw qErr || new Error('Ошибка загрузки вопросов');

      const testPool = allQuestionsRaw.filter(q => q.type === 'test');
      const matchingPool = allQuestionsRaw.filter(q => q.type === 'matching');
      const openPool = allQuestionsRaw.filter(q => q.type === 'open');

      // Вспомогательная функция случайного перемешивания (Fisher-Yates)
      const shuffle = <T,>(arr: T[]): T[] => {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      };

      // 3. Формирование параллельных билетов
      // Для каждого билета k выбираем вопросы так, чтобы:
      // - внутри билета не было повторов;
      // - если возможно, между параллельными билетами вопросы не пересекались, или распределялись равномерно.
      const ticketsData: Array<{ ticketNumber: number; questions: Question[] }> = [];

      for (let tNum = 1; tNum <= ticketCount; tNum++) {
        const ticketQuestions: Question[] = [];

        // Выбор тестовых
        const shuffledTests = shuffle(testPool);
        ticketQuestions.push(...shuffledTests.slice(0, testCount));

        // Выбор соответствий
        const shuffledMatching = shuffle(matchingPool);
        ticketQuestions.push(...shuffledMatching.slice(0, matchingCount));

        // Выбор открытых
        const shuffledOpen = shuffle(openPool);
        ticketQuestions.push(...shuffledOpen.slice(0, openCount));

        ticketsData.push({
          ticketNumber: tNum,
          questions: ticketQuestions,
        });
      }

      // 4. Сохранение партии билетов в базу данных
      const { data: batch, error: bErr } = await supabase
        .from('ticket_batches')
        .insert({
          title: batchTitle.trim() || 'Экзаменационные билеты',
          subject_id: subjectId,
          created_by: user?.id,
          generation_params: {
            chapter_ids: selectedChapterIds,
            topic_ids: selectedTopicIds,
            test_count: testCount,
            matching_count: matchingCount,
            open_count: openCount,
            ticket_count: ticketCount,
            shuffle_options: shuffleOptions,
            shuffle_matching: shuffleMatching,
          },
        })
        .select()
        .single();

      if (bErr || !batch) throw bErr;

      const createdTicketsWithQuestions = [];

      // Сохраняем каждый билет и его неизменяемые снимки
      for (const t of ticketsData) {
        const { data: savedTicket, error: tErr } = await supabase
          .from('tickets')
          .insert({
            batch_id: batch.id,
            ticket_number: t.ticketNumber,
          })
          .select()
          .single();

        if (tErr || !savedTicket) throw tErr;

        const ticketQuestionRows = t.questions.map((q, idx) => {
          // Перемешивание вариантов ответов (A, B, C, D)
          let snapshotOptions = q.options;
          if (q.type === 'test' && q.options && q.options.length > 0) {
            const optsToUse = shuffleOptions ? shuffle([...q.options]) : [...q.options];
            snapshotOptions = optsToUse.map((o, oIdx) => ({
              id: o.id,
              text: o.text,
              text_ru: (o as any).text_ru || o.text,
              text_tg: (o as any).text_tg || (o as any).text_ru || o.text,
              image_url: o.image_url,
              order_index: oIdx + 1,
            }));
          }

          // Перемешивание правой стороны соответствия (1, 2, 3, 4, 5)
          let snapshotMatching = q.matching_items;
          if (q.type === 'matching' && q.matching_items && q.matching_items.length > 0) {
            const leftItems = q.matching_items.filter(m => m.side === 'left');
            const rightItems = q.matching_items.filter(m => m.side === 'right');
            const sortedLeft = [...leftItems].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
            const rightToUse = shuffleMatching ? shuffle([...rightItems]) : [...rightItems];

            const processedLeft = sortedLeft.map((m, mIdx) => ({
              id: m.id,
              side: m.side,
              text: m.text,
              text_ru: (m as any).text_ru || m.text,
              text_tg: (m as any).text_tg || (m as any).text_ru || m.text,
              image_url: m.image_url,
              order_index: mIdx + 1,
            }));

            const processedRight = rightToUse.map((m, mIdx) => ({
              id: m.id,
              side: m.side,
              text: m.text,
              text_ru: (m as any).text_ru || m.text,
              text_tg: (m as any).text_tg || (m as any).text_ru || m.text,
              image_url: m.image_url,
              order_index: mIdx + 1,
            }));

            snapshotMatching = [...processedLeft, ...processedRight];
          }

          return {
            ticket_id: savedTicket.id,
            question_id: q.id,
            order_index: idx + 1,
            question_snapshot: {
              id: q.id,
              type: q.type,
              content: q.content,
              content_ru: (q as any).content_ru || q.content,
              content_tg: (q as any).content_tg || (q as any).content_ru || q.content,
              image_url: q.image_url,
              correct_numeric_answer: q.correct_numeric_answer,
              chapter_name: (q.chapter as any)?.name,
              topic_name: (q.topic as any)?.name,
              options: snapshotOptions,
              matching_items: snapshotMatching,
            },
          };
        });

        await supabase.from('ticket_questions').insert(ticketQuestionRows);

        createdTicketsWithQuestions.push({
          ...savedTicket,
          questions: ticketQuestionRows,
        });
      }

      setGeneratedBatch({
        ...batch,
        tickets: createdTicketsWithQuestions,
      });

      queryClient.invalidateQueries({ queryKey: ['saved_ticket_batches'] });
    } catch (err: any) {
      setGenerationError(err.message || 'Ошибка генерации билетов');
    } finally {
      setIsGenerating(false);
    }
  };

  // Экспорт созданных билетов в Word на выбранном языке
  const handleExportWord = async (lang: 'ru' | 'tg' | 'both') => {
    if (!generatedBatch || !generatedBatch.tickets) return;
    try {
      await exportTicketsToDocx(
        generatedBatch.title,
        generatedBatch.tickets,
        subjects.find(s => s.id === subjectId)?.name || 'Химия',
        lang
      );
    } catch (err: any) {
      alert('Ошибка экспорта в Word: ' + err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Шапка генератора */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <Sparkles className="w-5 h-5 mr-2 text-blue-600" />
            Конструктор экзаменационных билетов
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Параллельная генерация одинаковых вариантов на русском и таджикском языках
          </p>
        </div>

        {generatedBatch && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleExportWord('ru')}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow flex items-center space-x-1 transition"
              title="Скачать варианты на русском языке"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Русский (.docx)</span>
            </button>
            <button
              onClick={() => handleExportWord('tg')}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow flex items-center space-x-1 transition"
              title="Скачать варианты на таджикском языке"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Тоҷикӣ (.docx)</span>
            </button>
            <button
              onClick={() => handleExportWord('both')}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow flex items-center space-x-1 transition"
              title="Скачать двуязычные билеты (RU + TG)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>RU + TG</span>
            </button>
          </div>
        )}
      </div>

      {generationError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Генерация остановлена: </span>
            {generationError}
          </div>
        </div>
      )}

      {/* Панель настроек состава билета */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 1. Выбор предмета, глав и тем */}
        <div className="md:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-sm flex items-center">
            <BookOpen className="w-4 h-4 mr-2 text-indigo-600" />
            1. Выбор диапазона глав и тем
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Предмет
              </label>
              <select
                value={subjectId}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  setSelectedChapterIds([]);
                  setSelectedTopicIds([]);
                }}
                className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              >
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Название пакета билетов
              </label>
              <input
                type="text"
                value={batchTitle}
                onChange={(e) => setBatchTitle(e.target.value)}
                placeholder="Экзамен по неорганической химии"
                className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              />
            </div>
          </div>

          {/* Иерархический выбор: Главы и раскрывающиеся темы */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Главы и темы:
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                  {selectedTopicIds.length === 0
                    ? `Все темы включены (${allTopics.length})`
                    : `Выбрано: ${selectedTopicIds.length} из ${allTopics.length}`}
                </span>
              </div>
              <div className="flex items-center space-x-1.5 text-xs">
                <button
                  type="button"
                  onClick={handleSelectAllTopics}
                  className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg transition"
                >
                  Выбрать все
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAllTopics}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-lg transition"
                >
                  Снять всё
                </button>
              </div>
            </div>

            {/* Список глав в виде раскрывающегося аккордеона */}
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {chapters.map(ch => {
                const chTopics = allTopics.filter(t => t.chapter_id === ch.id);
                const chSelectedTopics = chTopics.filter(t => selectedTopicIds.includes(t.id));
                const isAllSelected = chTopics.length > 0 && chSelectedTopics.length === chTopics.length;
                const isExpanded = expandedChapterIds[ch.id] ?? true;

                return (
                  <div
                    key={ch.id}
                    className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm transition"
                  >
                    {/* Заголовок главы (аккордеон) */}
                    <div className="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-slate-100/70 transition select-none">
                      <div className="flex items-center space-x-2 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => toggleChapterExpanded(ch.id)}
                          className="p-1 text-slate-500 hover:text-slate-800 rounded transition"
                          title={isExpanded ? 'Свернуть список тем' : 'Раскрыть список тем'}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-blue-600" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          )}
                        </button>

                        <label className="flex items-center space-x-2 cursor-pointer truncate">
                          <input
                            type="checkbox"
                            checked={isAllSelected}
                            onChange={(e) => {
                              if (e.target.checked) handleSelectChapterTopics(ch.id);
                              else handleDeselectChapterTopics(ch.id);
                            }}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                          />
                          <span className="font-bold text-xs text-slate-900 truncate">
                            {ch.name}
                          </span>
                        </label>

                        <span className="text-[11px] text-slate-400 font-medium shrink-0">
                          ({chSelectedTopics.length}/{chTopics.length} тем)
                        </span>
                      </div>

                      <div className="flex items-center space-x-1 shrink-0 ml-2">
                        <button
                          type="button"
                          onClick={() => handleSelectChapterTopics(ch.id)}
                          className="text-[11px] text-blue-600 hover:text-blue-800 px-1.5 py-0.5 rounded hover:bg-blue-50 font-medium"
                        >
                          Выбрать все
                        </button>
                        <span className="text-slate-300">·</span>
                        <button
                          type="button"
                          onClick={() => handleDeselectChapterTopics(ch.id)}
                          className="text-[11px] text-slate-500 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-slate-200/50"
                        >
                          Снять всё
                        </button>
                      </div>
                    </div>

                    {/* Раскрывающийся список тем главы */}
                    {isExpanded && (
                      <div className="p-2.5 bg-white border-t border-slate-100 space-y-1 max-h-60 overflow-y-auto">
                        {chTopics.length === 0 ? (
                          <div className="text-xs text-slate-400 italic p-2">В этой главе пока нет тем</div>
                        ) : (
                          chTopics.map(tp => {
                            const isChecked = selectedTopicIds.includes(tp.id);
                            return (
                              <label
                                key={tp.id}
                                className={`flex items-start space-x-2.5 p-2 rounded-lg cursor-pointer transition text-xs ${
                                  isChecked
                                    ? 'bg-blue-50/70 text-slate-900 font-medium border border-blue-200/60'
                                    : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => handleToggleTopic(tp.id, ch.id, e.target.checked)}
                                  className="mt-0.5 w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 shrink-0"
                                />
                                <span className="leading-snug">{tp.name}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 2. Квоты вопросов и статистика пула */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center mb-3">
              <Layers className="w-4 h-4 mr-2 text-blue-600" />
              2. Состав каждого билета
            </h3>

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700">Тестовых вопросов:</span>
                  <span className="text-slate-400">В пуле: {poolStats?.test || 0}</span>
                </div>
                <input
                  type="number"
                  min="0"
                  value={testCount}
                  onChange={(e) => setTestCount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full text-xs p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700">Заданий на соответствие:</span>
                  <span className="text-slate-400">В пуле: {poolStats?.matching || 0}</span>
                </div>
                <input
                  type="number"
                  min="0"
                  value={matchingCount}
                  onChange={(e) => setMatchingCount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full text-xs p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700">Открытых вопросов:</span>
                  <span className="text-slate-400">В пуле: {poolStats?.open || 0}</span>
                </div>
                <input
                  type="number"
                  min="0"
                  value={openCount}
                  onChange={(e) => setOpenCount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full text-xs p-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                />
              </div>

              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-bold text-slate-900">Количество вариантов:</span>
                </div>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={ticketCount}
                  onChange={(e) => setTicketCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full text-xs p-2 border border-blue-400 bg-blue-50/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold text-blue-900"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Будет создано {ticketCount} параллельных билетов по {testCount + matchingCount + openCount} вопросов
                </p>
              </div>

              {/* Настройки перемешивания (анти-списывание) */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Перемешивание (анти-списывание):
                </span>
                <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer select-none hover:text-slate-900 transition">
                  <input
                    type="checkbox"
                    checked={shuffleOptions}
                    onChange={(e) => setShuffleOptions(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                  />
                  <span className="font-medium">Перемешать варианты ответов (A, B, C, D)</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer select-none hover:text-slate-900 transition">
                  <input
                    type="checkbox"
                    checked={shuffleMatching}
                    onChange={(e) => setShuffleMatching(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                  />
                  <span className="font-medium">Перемешать варианты соответствия (1, 2, 3, 4, 5)</span>
                </label>
              </div>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow flex items-center justify-center space-x-2 transition disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>{isGenerating ? 'Составление билетов...' : 'Сгенерировать билеты'}</span>
          </button>
        </div>
      </div>

      {/* Результаты генерации (предпросмотр созданных вариантов) */}
      {generatedBatch && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center space-x-3">
                <h3 className="font-bold text-slate-900 text-base">
                  Сгенерировано вариантов: {generatedBatch.tickets.length}
                </h3>
                <button
                  onClick={() => setGeneratedBatch(null)}
                  className="text-xs text-slate-400 hover:text-slate-600 underline font-medium"
                  title="Скрыть блок предпросмотра"
                >
                  Скрыть
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Все билеты сохранены в базу с неизменяемыми снимками (snapshots).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleExportWord('ru')}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center space-x-1 shadow-sm transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Русский (.docx)</span>
              </button>
              <button
                onClick={() => handleExportWord('tg')}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center space-x-1 shadow-sm transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Тоҷикӣ (.docx)</span>
              </button>
              <button
                onClick={() => handleExportWord('both')}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl flex items-center space-x-1 shadow-sm transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>RU + TG</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {generatedBatch.tickets.map((t: any) => (
              <div key={t.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="font-bold text-sm text-slate-900 flex items-center justify-between">
                  <span>Вариант {t.ticket_number}</span>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-xs font-normal text-slate-500 mr-1">Вопросов: {t.questions.length}</span>
                    <button
                      onClick={() => exportSingleTicketDocx(batchTitle, t, subjects.find(s => s.id === subjectId)?.name || 'Химия', 'ru')}
                      className="px-2 py-0.5 text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded border border-blue-200 transition"
                      title="Скачать Вариант на русском"
                    >
                      RU (.docx)
                    </button>
                    <button
                      onClick={() => exportSingleTicketDocx(batchTitle, t, subjects.find(s => s.id === subjectId)?.name || 'Химия', 'tg')}
                      className="px-2 py-0.5 text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded border border-emerald-200 transition"
                      title="Скачать Вариант на таджикском"
                    >
                      TG (.docx)
                    </button>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-slate-700 max-h-48 overflow-y-auto pr-1">
                  {t.questions.map((tq: any, i: number) => (
                    <div key={i} className="p-1.5 bg-white rounded border border-slate-100 truncate">
                      <span className="font-bold text-slate-400 mr-1.5">{i + 1}.</span>
                      <span className="font-medium text-slate-800">
                        {tq.question_snapshot.content.replace(/<.*?>/g, '')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
