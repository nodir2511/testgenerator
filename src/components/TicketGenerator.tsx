import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { notifyError, notifyInfo, describeError } from '../lib/errors';
import { fitSettings, pickParallel, separateLinked, chapterTotalsFromCounts, totalsOf,poolStats as calcPoolStats, toSnapshot, checkSettings, LIMITS } from '../../supabase/functions/_shared/ticketing';
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
import { exportTicketsToDocx, exportSingleTicketDocx, buildTicketsFile } from '../lib/exportLazy';
import { exportAnswerKey, hasKeyTemplate, keyArchiveExtras, withSelectionInfo } from '../lib/exportLazy';
import { SendToTelegramButton } from './SendToTelegramButton';
import { fetchAllPages } from '../lib/fetchAllPages';
import { useUserLimits, formatCooldown } from '../lib/generationLimits';

// Администратору на сайте можно до 50 вариантов; обычным пользователям — те же лимиты, что в Telegram (их же проверяет база)
const ADMIN_SITE_LIMITS = { ...LIMITS, tickets: 50 };

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

export const TicketGenerator: React.FC = () => {
  const queryClient = useQueryClient();
  const { user, isAdmin } = useAuth();
  const userLimits = useUserLimits();
  const limits = isAdmin ? ADMIN_SITE_LIMITS : userLimits;
  const generatingRef = React.useRef(false);

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
        try { localStorage.removeItem('examiner_tg_generated_batch'); } catch { /* ignore */ }
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

  const SUBJECT_PRESETS = [
    { label: 'Физика', match: 'физ', test: 18, matching: 2, open: 7 },
    { label: 'Химия', match: 'хим', test: 18, matching: 2, open: 7 },
    { label: 'Биология', match: 'био', test: 20, matching: 4, open: 2 },
    { label: 'Тадж. язык (Гос)', match: 'тадж', test: 20, matching: 4, open: 2 },
  ];

  const applyPresetForSubject = (sId: string) => {
    setSubjectId(sId);
    setSelectedChapterIds([]);
    setSelectedTopicIds([]);
    const s = subjects.find(x => x.id === sId);
    if (!s) return;
    const n = s.name.toLowerCase();
    if (n.includes('хим') || n.includes('физ')) {
      setTestCount(18);
      setMatchingCount(2);
      setOpenCount(7);
    } else if (n.includes('био') || n.includes('тадж') || n.includes('гос')) {
      setTestCount(20);
      setMatchingCount(4);
      setOpenCount(2);
    }
  };

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
    staleTime: 0,
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
    getStorageJSON('examiner_tg_expanded_chapters_v2', {})
  );

  // Новые главы: на узком экране свёрнуты (показываем только заголовки), на широком раскрыты
  React.useEffect(() => {
    if (chapters.length > 0) {
      const expandByDefault = window.innerWidth >= 640;
      setExpandedChapterIds(prev => {
        let changed = false;
        const next = { ...prev };
        chapters.forEach(ch => {
          if (next[ch.id] === undefined) {
            next[ch.id] = expandByDefault;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [chapters]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_expanded_chapters_v2', JSON.stringify(expandedChapterIds));
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

  // 4. Подсчет доступного пула вопросов для проверки дефицита.
  // Счётчики предмета считает база одним запросом; при смене выбора глав и тем запрос не повторяется.
  const { data: poolCounts } = useQuery({
    queryKey: ['question_counts', subjectId],
    staleTime: 0,
    enabled: Boolean(subjectId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('question_counts', { p_subject_id: subjectId });
      if (error) throw error;
      return (data || []) as Array<{ chapter_id: string | null; topic_id: string | null; type: string; cnt: number }>;
    },
  });
  const poolStats = React.useMemo(() => {
    if (!poolCounts) return undefined;
    const topicSet = new Set(selectedTopicIds);
    const chapterSet = new Set(selectedChapterIds);
    const out = { total: 0, test: 0, matching: 0, open: 0 };
    for (const r of poolCounts) {
      if (topicSet.size > 0 ? !(r.topic_id && topicSet.has(r.topic_id)) : chapterSet.size > 0 && !(r.chapter_id && chapterSet.has(r.chapter_id))) continue;
      out.total += r.cnt;
      if (r.type === 'test' || r.type === 'matching' || r.type === 'open') out[r.type] += r.cnt;
    }
    return out;
  }, [poolCounts, selectedTopicIds, selectedChapterIds]);

  // Состав билета с учётом того, что реально есть в выбранных темах
  const fitted = fitSettings(
    { total: poolStats?.total || 0, test: poolStats?.test || 0, matching: poolStats?.matching || 0, open: poolStats?.open || 0 },
    { testCount, matchingCount, openCount, ticketCount, shuffleOptions, shuffleMatching, title: batchTitle }
  );

  // Алгоритм параллельной генерации билетов
  const handleGenerate = async () => {
    if (generatingRef.current) return; // защита от двойного нажатия
    generatingRef.current = true;
    setGenerationError(null);
    setIsGenerating(true);

    try {
      if (!subjectId) throw new Error('Выберите предмет');
      if (testCount + matchingCount + openCount === 0) throw new Error('Задайте хотя бы один вопрос в билете');
      if (ticketCount < 1) throw new Error('Количество билетов должно быть не менее 1');

      const limitErr = checkSettings({ testCount, matchingCount, openCount, ticketCount, shuffleOptions, shuffleMatching, title: batchTitle }, limits);
      if (limitErr) throw new Error(limitErr);

      // 1. Загружаем все доступные вопросы пула с деталями для снимков
      const { data: allQuestionsRaw, error: qErr } = await fetchAllPages<any>(() => {
        let query = supabase
          .from('questions')
          .select(`
            *,
            chapter:chapters(name, order_index),
            topic:topics(name, order_index),
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

      // 2. Если вопросов какого-то вида не хватает, берём сколько есть (считаем по реально загруженным вопросам)
      const fit = fitSettings(
        calcPoolStats(allQuestionsRaw),
        { testCount, matchingCount, openCount, ticketCount, shuffleOptions, shuffleMatching, title: batchTitle }
      );
      if (fit.error) throw new Error(fit.error);
      if (fit.notes.length) notifyInfo(`Вопросов не хватает, билеты составлены из того, что есть. ${fit.notes.join('; ')}`);
      const { testCount: useTest, matchingCount: useMatching, openCount: useOpen } = fit.settings;

      // 3. Формирование параллельных билетов (см. pickParallel): позиция в билете берётся
      // из одной темы во всех билетах, соседними вопросами сборника, темы — поровну,
      // без повторов, пока хватает вопросов
      // Охват глав: сколько вопросов главы выбрано от всех её вопросов (неполный выбор уменьшает долю главы)
      const chapterIds = Array.from(new Set(allQuestionsRaw.map(q => q.chapter_id).filter(Boolean)));
      const { data: countRows, error: totErr } = await supabase.rpc('question_counts', { p_subject_id: subjectId });
      if (totErr) throw totErr;
      const totals = chapterTotalsFromCounts(countRows || [], chapterIds);
      const tests = pickParallel(allQuestionsRaw.filter(q => q.type === 'test'), useTest, ticketCount, Math.random, totalsOf(totals, 'test'));
      const matchings = pickParallel(allQuestionsRaw.filter(q => q.type === 'matching'), useMatching, ticketCount, Math.random, totalsOf(totals, 'matching'));
      const opens = pickParallel(allQuestionsRaw.filter(q => q.type === 'open'), useOpen, ticketCount, Math.random, totalsOf(totals, 'open'));
      separateLinked([tests, matchings, opens], allQuestionsRaw);
      const ticketsData: Array<{ ticketNumber: number; questions: Question[] }> = [];
      for (let k = 0; k < ticketCount; k++) {
        ticketsData.push({ ticketNumber: k + 1, questions: [...tests[k], ...matchings[k], ...opens[k]] });
      }

      // 4. Сохранение одной транзакцией: партия, билеты и вопросы билетов (см. supabase/sql/save_ticket_batch.sql).
      // При любой ошибке база откатывает всё — недосозданных наборов не остаётся.
      const snapOpts = { shuffleOptions, shuffleMatching };
      const ticketsPayload = ticketsData.map(t => ({
        ticket_number: t.ticketNumber,
        questions: t.questions.map((q, idx) => ({
          question_id: q.id,
          order_index: idx + 1,
          question_snapshot: toSnapshot(q, snapOpts),
        })),
      }));
      const { data: saved, error: sErr } = await supabase.rpc('save_ticket_batch', {
        p_batch: {
          title: batchTitle.trim() || 'Экзаменационные билеты',
          subject_id: subjectId,
          generation_params: {
            chapter_ids: selectedChapterIds,
            topic_ids: selectedTopicIds,
            test_count: useTest,
            matching_count: useMatching,
            open_count: useOpen,
            ticket_count: ticketCount,
            shuffle_options: shuffleOptions,
            shuffle_matching: shuffleMatching,
            requested: { test: testCount, matching: matchingCount, open: openCount },
            source: 'site',
          },
        },
        p_tickets: ticketsPayload,
      });
      if (sErr || !saved) throw sErr || new Error('Не удалось сохранить билеты');
      const batch = (saved as any).batch;
      const createdTicketsWithQuestions = ((saved as any).tickets as any[]).map((t, i) => ({
        ...t,
        questions: ticketsPayload[i].questions.map(q => ({ ...q, ticket_id: t.id })),
      }));

      setGeneratedBatch({
        ...batch,
        tickets: await withSelectionInfo(createdTicketsWithQuestions, batch.subject_id, batch.generation_params),
      });

      queryClient.invalidateQueries({ queryKey: ['saved_ticket_batches'] });
      queryClient.invalidateQueries({ queryKey: ['recent_batches'] });
    } catch (err: any) {
      setGenerationError(describeError(err, 'Ошибка генерации билетов'));
    } finally {
      generatingRef.current = false;
      setIsGenerating(false);
    }
  };

  // Последние наборы пользователя — чтобы повторить с теми же настройками
  const { data: recentBatches = [] } = useQuery({
    queryKey: ['recent_batches', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data } = await supabase
        .from('ticket_batches')
        .select('id, title, created_at, subject_id, generation_params, subject:subjects(name)')
        .eq('created_by', user!.id)
        .order('created_at', { ascending: false })
        .limit(12);
      // Партии экзамена-кластера повторять здесь нельзя (у них свой раздел)
      return ((data || []) as any[]).filter((b) => b.generation_params?.source !== 'cluster').slice(0, 4);
    },
  });

  const repeatBatch = (b: any) => {
    const p = b.generation_params || {};
    const r = p.requested ?? { test: p.test_count ?? 0, matching: p.matching_count ?? 0, open: p.open_count ?? 0 };
    setSubjectId(b.subject_id);
    setSelectedChapterIds(p.chapter_ids ?? []);
    setSelectedTopicIds(p.topic_ids ?? []);
    setTestCount(Math.min(limits.perType, r.test));
    setMatchingCount(Math.min(limits.perType, r.matching));
    setOpenCount(Math.min(limits.perType, r.open));
    setTicketCount(Math.min(limits.tickets, Math.max(1, p.ticket_count ?? 1)));
    if (typeof p.shuffle_options === 'boolean') setShuffleOptions(p.shuffle_options);
    if (typeof p.shuffle_matching === 'boolean') setShuffleMatching(p.shuffle_matching);
    setBatchTitle(b.title || 'Экзаменационные билеты');
  };

  // Экспорт созданных билетов в Word на выбранном языке
  const handleExportWord = async (lang: 'ru' | 'tg' | 'both') => {
    if (!generatedBatch || !generatedBatch.tickets) return;
    try {
      const subj = subjects.find(s => s.id === (generatedBatch?.subject_id || subjectId))?.name || 'Химия';
      await exportTicketsToDocx(
        generatedBatch.title,
        generatedBatch.tickets,
        subj,
        lang,
        await keyArchiveExtras(generatedBatch.title, generatedBatch.tickets, subj, { subjectId: generatedBatch.subject_id || subjectId, params: generatedBatch.generation_params }, lang)
      );
    } catch (err: any) {
      notifyError(err, 'Ошибка экспорта в Word');
    }
  };

  // Один вариант вместе с его ключами (ZIP)
  const exportSingleWithKey = async (t: any, lang: 'ru' | 'tg') => {
    if (!generatedBatch) return;
    try {
      const subj = subjects.find(s => s.id === (generatedBatch?.subject_id || subjectId))?.name || 'Химия';
      await exportSingleTicketDocx(
        generatedBatch.title || batchTitle, t, subj, lang,
        await keyArchiveExtras(generatedBatch.title || batchTitle, [t], subj, { subjectId: generatedBatch.subject_id || subjectId, params: generatedBatch.generation_params }, lang)
      );
    } catch (err: any) {
      notifyError(err, 'Ошибка экспорта в Word');
    }
  };

  const generatedSubjectName = subjects.find(s => s.id === (generatedBatch?.subject_id || subjectId))?.name || '';
  const handleExportKey = async () => {
    if (!generatedBatch || !generatedBatch.tickets) return;
    try {
      const stats = await exportAnswerKey(generatedBatch.title, generatedBatch.tickets, generatedSubjectName, {
        subjectId: generatedBatch.subject_id || subjectId, params: generatedBatch.generation_params,
      });
      if (stats.missing) notifyError(new Error(`В базе нет верного ответа у вопросов: ${stats.missing} — клетки в ключе отмечены красным.`), 'Ключи готовы, но не полные');
    } catch (err: any) {
      notifyError(err, 'Ошибка при создании ключей');
    }
  };

  // Тот же файл, но отправляется в Telegram владельца аккаунта
  const telegramButton = generatedBatch?.tickets ? (
    <SendToTelegramButton
      title={generatedBatch.title}
      batchId={generatedBatch.id}
      ticketCount={generatedBatch.tickets.length}
      build={async (lang) => {
        const subj = subjects.find(s => s.id === (generatedBatch?.subject_id || subjectId))?.name || 'Химия';
        return buildTicketsFile(
          generatedBatch.title,
          generatedBatch.tickets,
          subj,
          lang,
          await keyArchiveExtras(generatedBatch.title, generatedBatch.tickets, subj, { subjectId: generatedBatch.subject_id || subjectId, params: generatedBatch.generation_params }, lang)
        );
      }}
    />
  ) : null;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      {/* Шапка генератора в Bento-стиле */}
      <div className="bento-card p-4 sm:p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-tight">
              Конструктор экзаменационных билетов
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Параллельная генерация одинаковых вариантов на русском и таджикском языках
            </p>
          </div>
        </div>

        {generatedBatch && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleExportWord('ru')}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center space-x-1.5 transition active:scale-95"
              title="Скачать варианты на русском языке"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Русский (.docx)</span>
            </button>
            <button
              onClick={() => handleExportWord('tg')}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center space-x-1.5 transition active:scale-95"
              title="Скачать варианты на таджикском языке"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Тоҷикӣ (.docx)</span>
            </button>
            <button
              onClick={() => handleExportWord('both')}
              className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center space-x-1.5 transition active:scale-95"
              title="Скачать двуязычные билеты (RU + TJ)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>RU + TJ</span>
            </button>
            {hasKeyTemplate(generatedSubjectName) && (
              <button
                onClick={handleExportKey}
                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center space-x-1.5 transition active:scale-95"
                title="Ключи ответов по шаблону (Word)"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Ключи (.docx)</span>
              </button>
            )}
            {telegramButton}
          </div>
        )}
      </div>

      {recentBatches.length > 0 && (
        <div className="bento-card px-4 py-3 rounded-2xl flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500">Повторить прошлый набор:</span>
          {recentBatches.map((b) => (
            <button
              key={b.id}
              onClick={() => repeatBatch(b)}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 rounded-xl text-xs font-semibold text-slate-700 transition active:scale-95"
              title={`${b.subject?.name || ''} · ${b.generation_params?.ticket_count ?? '?'} вариантов`}
            >
              {b.title} · {new Date(b.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </button>
          ))}
        </div>
      )}

      {generationError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-3 text-xs text-red-700 shadow-xs animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Генерация остановлена: </span>
            {generationError}
          </div>
        </div>
      )}

      {/* Панель настроек состава билета */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        {/* 1. Выбор предмета, глав и тем */}
        <div className="md:col-span-2 bento-card p-4 sm:p-6 rounded-2xl space-y-4">
          <h3 className="font-bold text-slate-900 text-sm flex items-center">
            <BookOpen className="w-4 h-4 mr-2 text-indigo-600" />
            1. Выбор диапазона глав и тем
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Предмет
              </label>
              <select
                value={subjectId}
                onChange={(e) => applyPresetForSubject(e.target.value)}
                className="w-full text-xs p-2.5 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-900"
              >
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>

              {/* Быстрые кнопки выбора предметов со стандартами */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-0.5">Быстро:</span>
                {SUBJECT_PRESETS.map((p) => {
                  const s = subjects.find(x => x.name.toLowerCase().includes(p.match));
                  const isSelected = s && subjectId === s.id;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        if (s) {
                          setSubjectId(s.id);
                          setSelectedChapterIds([]);
                          setSelectedTopicIds([]);
                        }
                        setTestCount(p.test);
                        setMatchingCount(p.matching);
                        setOpenCount(p.open);
                      }}
                      className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition active:scale-95 border ${
                        isSelected
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-bold shadow-2xs'
                          : 'bg-white border-slate-200/90 text-slate-700 hover:bg-slate-50'
                      }`}
                      title={`${p.label}: ${p.test} тестов, ${p.matching} соотв., ${p.open} откр.`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Название пакета билетов
              </label>
              <input
                type="text"
                value={batchTitle}
                onChange={(e) => setBatchTitle(e.target.value)}
                placeholder="Экзамен по неорганической химии"
                className="w-full text-xs p-2.5 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
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

            {/* Нехватка вопросов в выбранных темах — сразу рядом с выбором */}
            {poolStats && fitted.error && (
              <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 mb-2">⚠ {fitted.error}</p>
            )}
            {poolStats && !fitted.error && fitted.notes.length > 0 && (
              <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-2">
                <span className="block font-semibold">Вопросов в выбранных темах не хватает на заданный состав билета:</span>
                {fitted.notes.map((n) => <span key={n} className="block">• {n}</span>)}
                <span className="block mt-0.5 text-amber-700">Выберите больше тем или уменьшите число вопросов.</span>
              </div>
            )}

            {/* Список глав в виде раскрывающегося аккордеона */}
            <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
              {chapters.map(ch => {
                const chTopics = allTopics.filter(t => t.chapter_id === ch.id);
                const chSelectedTopics = chTopics.filter(t => selectedTopicIds.includes(t.id));
                const isAllSelected = chTopics.length > 0 && chSelectedTopics.length === chTopics.length;
                const isExpanded = expandedChapterIds[ch.id] ?? false;

                return (
                  <div
                    key={ch.id}
                    className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm transition"
                  >
                    {/* Заголовок главы (аккордеон) */}
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 p-2.5 bg-slate-50 hover:bg-slate-100/70 transition select-none">
                      <div className="flex items-start space-x-2 flex-1 min-w-[12rem]">
                        <button
                          type="button"
                          onClick={() => toggleChapterExpanded(ch.id)}
                          className="p-1 text-slate-500 hover:text-slate-800 rounded transition shrink-0"
                          title={isExpanded ? 'Свернуть список тем' : 'Раскрыть список тем'}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-blue-600" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          )}
                        </button>

                        <label className="flex items-start space-x-2 cursor-pointer min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={isAllSelected}
                            onChange={(e) => {
                              if (e.target.checked) handleSelectChapterTopics(ch.id);
                              else handleDeselectChapterTopics(ch.id);
                            }}
                            className="mt-0.5 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 shrink-0"
                          />
                          <span className="font-bold text-xs text-slate-900 break-words leading-snug">
                            {ch.name}
                          </span>
                        </label>

                        <span className="text-[11px] text-slate-400 font-medium shrink-0 mt-0.5">
                          ({chSelectedTopics.length}/{chTopics.length} тем)
                        </span>
                      </div>

                      <div className="flex items-center space-x-1 shrink-0 ml-8 sm:ml-2">
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
                      <div className="p-2.5 bg-white border-t border-slate-100 space-y-1">
                        {chTopics.length === 0 ? (
                          <div className="text-xs text-slate-400 italic p-2">В этой главе пока нет тем</div>
                        ) : (
                          chTopics.map((tp, tpIdx) => {
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
                                <span className="leading-snug">{tpIdx + 1}. {tp.name}</span>
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
        <div className="bento-card p-4 sm:p-6 rounded-2xl flex flex-col justify-between space-y-4">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center mb-3">
              <Layers className="w-4 h-4 mr-2 text-indigo-600" />
              2. Состав каждого билета
            </h3>

            {/* Быстрые шаблоны составов билета под предметы */}
            <div className="bg-slate-100/80 p-2.5 rounded-2xl border border-slate-200/80 mb-3 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">
                <span>Быстрый стандарт:</span>
                <span className="text-slate-400 font-normal">1 клик</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setTestCount(18);
                    setMatchingCount(2);
                    setOpenCount(7);
                  }}
                  className={`p-2 rounded-xl text-left border transition active:scale-95 ${
                    testCount === 18 && matchingCount === 2 && openCount === 7
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                  title="Физика и Химия: 18 тестов, 2 соответствия, 7 открытых (всего 27 вопросов)"
                >
                  <div className="font-bold text-xs truncate">
                    🧪 Физ / Хим
                  </div>
                  <div className={`text-[10px] mt-0.5 ${testCount === 18 && matchingCount === 2 && openCount === 7 ? 'text-indigo-100 font-medium' : 'text-slate-400'}`}>
                    18 + 2 + 7 (27 в.)
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTestCount(20);
                    setMatchingCount(4);
                    setOpenCount(2);
                  }}
                  className={`p-2 rounded-xl text-left border transition active:scale-95 ${
                    testCount === 20 && matchingCount === 4 && openCount === 2
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                  title="Биология и Гос (Таджикский язык): 20 тестов, 4 соответствия, 2 открытых (всего 26 вопросов)"
                >
                  <div className="font-bold text-xs truncate">
                    🧬 Био / Гос
                  </div>
                  <div className={`text-[10px] mt-0.5 ${testCount === 20 && matchingCount === 4 && openCount === 2 ? 'text-indigo-100 font-medium' : 'text-slate-400'}`}>
                    20 + 4 + 2 (26 в.)
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {/* Тестовые вопросы */}
              <div className="bg-slate-50/70 p-3 rounded-2xl border border-slate-200/80">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-bold text-slate-800">Тестовые вопросы:</span>
                  <span className="text-slate-400 font-medium">В пуле: {poolStats?.test || 0}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setTestCount(Math.max(0, testCount - 1))}
                    className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-base active:scale-90 transition hover:bg-slate-50 shadow-2xs"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="0"
                    value={testCount}
                    onChange={(e) => setTestCount(Math.min(limits.perType, Math.max(0, parseInt(e.target.value) || 0)))}
                    className="flex-1 text-center text-sm font-bold p-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setTestCount(Math.min(limits.perType, testCount + 1))}
                    className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-base active:scale-90 transition hover:bg-slate-50 shadow-2xs"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* На соответствие */}
              <div className="bg-slate-50/70 p-3 rounded-2xl border border-slate-200/80">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-bold text-slate-800">На соответствие:</span>
                  <span className="text-slate-400 font-medium">В пуле: {poolStats?.matching || 0}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setMatchingCount(Math.max(0, matchingCount - 1))}
                    className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-base active:scale-90 transition hover:bg-slate-50 shadow-2xs"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="0"
                    value={matchingCount}
                    onChange={(e) => setMatchingCount(Math.min(limits.perType, Math.max(0, parseInt(e.target.value) || 0)))}
                    className="flex-1 text-center text-sm font-bold p-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setMatchingCount(Math.min(limits.perType, matchingCount + 1))}
                    className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-base active:scale-90 transition hover:bg-slate-50 shadow-2xs"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Открытые вопросы */}
              <div className="bg-slate-50/70 p-3 rounded-2xl border border-slate-200/80">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-bold text-slate-800">Открытые вопросы:</span>
                  <span className="text-slate-400 font-medium">В пуле: {poolStats?.open || 0}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setOpenCount(Math.max(0, openCount - 1))}
                    className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-base active:scale-90 transition hover:bg-slate-50 shadow-2xs"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="0"
                    value={openCount}
                    onChange={(e) => setOpenCount(Math.min(limits.perType, Math.max(0, parseInt(e.target.value) || 0)))}
                    className="flex-1 text-center text-sm font-bold p-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setOpenCount(Math.min(limits.perType, openCount + 1))}
                    className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-base active:scale-90 transition hover:bg-slate-50 shadow-2xs"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Количество вариантов с пресетами */}
              <div className="bg-indigo-50/50 p-3.5 rounded-2xl border border-indigo-100">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-bold text-indigo-950">Количество вариантов:</span>
                  <span className="text-indigo-600 font-semibold text-[11px]">макс. {limits.tickets}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setTicketCount(Math.max(1, ticketCount - 1))}
                    className="w-9 h-9 rounded-xl bg-white border border-indigo-200 text-indigo-700 flex items-center justify-center font-bold text-base active:scale-90 transition hover:bg-indigo-50 shadow-2xs"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="1"
                    max={limits.tickets}
                    value={ticketCount}
                    onChange={(e) => setTicketCount(Math.min(limits.tickets, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="flex-1 text-center text-sm font-bold p-1.5 bg-white border border-indigo-200 text-indigo-950 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setTicketCount(Math.min(limits.tickets, ticketCount + 1))}
                    className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-base active:scale-90 transition hover:bg-indigo-700 shadow-xs"
                  >
                    +
                  </button>
                </div>
                {/* Быстрые пресеты количества вариантов */}
                <div className="flex items-center gap-1.5 mt-2.5">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase mr-0.5">Вариантов:</span>
                  {[2, 5, 10, 20, Math.min(50, limits.tickets)].filter((v, idx, arr) => arr.indexOf(v) === idx && v <= limits.tickets).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setTicketCount(n)}
                      className={`px-2 py-0.5 rounded-lg text-xs font-bold transition active:scale-95 ${
                        ticketCount === n
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-white border border-indigo-200/70 text-indigo-700 hover:bg-indigo-50'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>

                {!isAdmin && (
                  <p className="text-[11px] text-slate-400 mt-2">
                    Лимиты: до {limits.tickets} вариантов за раз, до {userLimits.total} вопросов в билете.
                  </p>
                )}
                <p className="text-[11px] text-slate-500 mt-1 font-medium">
                  Будет создано {ticketCount} параллельных билетов по {fitted.settings.testCount + fitted.settings.matchingCount + fitted.settings.openCount} вопросов
                </p>
                {fitted.notes.length > 0 && !fitted.error && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2 mt-2">
                    Вопросов не хватает — билеты составятся из того, что есть:<br />
                    {fitted.notes.map((n) => <span key={n} className="block">• {n}</span>)}
                  </p>
                )}
                {fitted.error && poolStats && (
                  <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-xl p-2 mt-2">{fitted.error}</p>
                )}
              </div>

              {/* Настройки перемешивания (анти-списывание) */}
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Перемешивание (анти-списывание):
                </span>
                <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer select-none hover:text-slate-900 transition">
                  <input
                    type="checkbox"
                    checked={shuffleOptions}
                    onChange={(e) => setShuffleOptions(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <span className="font-medium">Перемешать варианты ответов (A, B, C, D)</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer select-none hover:text-slate-900 transition">
                  <input
                    type="checkbox"
                    checked={shuffleMatching}
                    onChange={(e) => setShuffleMatching(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                  />
                  <span className="font-medium">Перемешать варианты соответствия (1, 2, 3...)</span>
                </label>
              </div>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white rounded-2xl text-xs font-bold shadow-md shadow-indigo-500/25 flex items-center justify-center space-x-2 transition active:scale-[0.98] disabled:opacity-50"
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
        <div className="bento-card p-4 sm:p-6 rounded-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-3">
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
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl flex items-center space-x-1 shadow-xs transition active:scale-95"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Русский (.docx)</span>
              </button>
              <button
                onClick={() => handleExportWord('tg')}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center space-x-1 shadow-xs transition active:scale-95"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Тоҷикӣ (.docx)</span>
              </button>
              <button
                onClick={() => handleExportWord('both')}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl flex items-center space-x-1 shadow-xs transition active:scale-95"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>RU + TJ</span>
              </button>
              {telegramButton}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {generatedBatch.tickets.map((t: any) => (
              <div key={t.id} className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 space-y-2.5">
                <div className="font-bold text-sm text-slate-900 flex items-center justify-between">
                  <span>Вариант {t.ticket_number}</span>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-xs font-normal text-slate-500 mr-1">Вопросов: {t.questions.length}</span>
                    <button
                      onClick={() => exportSingleWithKey(t, 'ru')}
                      className="px-2 py-0.5 text-[11px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg border border-indigo-200/70 transition active:scale-95"
                      title="Скачать Вариант на русском"
                    >
                      RU (.docx)
                    </button>
                    <button
                      onClick={() => exportSingleWithKey(t, 'tg')}
                      className="px-2 py-0.5 text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded-lg border border-emerald-200/70 transition active:scale-95"
                      title="Скачать Вариант на таджикском"
                    >
                      TJ (.docx)
                    </button>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-slate-700 max-h-48 overflow-y-auto pr-1">
                  {t.questions.map((tq: any, i: number) => (
                    <div key={i} className="p-2 bg-white rounded-xl border border-slate-100 truncate shadow-2xs">
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
