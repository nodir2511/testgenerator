import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { notifyError, notifyInfo } from '../lib/errors';
import { fitSettings, pickParallel, separateLinked, chapterTotalsFromCounts, totalsOf, poolStats as calcPoolStats, toSnapshot, checkSettings, LIMITS } from '../../supabase/functions/_shared/ticketing';
import { Subject, Chapter, Topic, Question } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import {
  Sparkles,
  CheckCircle2,
  Loader2,
  Download,
  ChevronDown,
  ChevronRight,
  Share2,
  SlidersHorizontal,
  X,
  History,
  RotateCcw,
} from 'lucide-react';
import { exportTicketsToDocx, exportSingleTicketDocx, buildTicketsFile } from '../lib/exportLazy';
import { exportAnswerKey, hasKeyTemplate, keyArchiveExtras, withSelectionInfo } from '../lib/exportLazy';
import { SendToTelegramButton } from './SendToTelegramButton';
import { fetchAllPages } from '../lib/fetchAllPages';
import { useUserLimits } from '../lib/generationLimits';
import { autoBatchTitle, DEFAULT_BATCH_TITLE } from '../lib/batchTitle';
import { DownloadButton, useExportLang, type Lang } from './DownloadButton';

// Администратору на сайте можно до 50 вариантов; обычным пользователям — те же лимиты, что в Telegram (их же проверяет база)
const ADMIN_SITE_LIMITS = { ...LIMITS, tickets: 50 };

type ScopeMode = 'all' | 'pick';

// Стандартный состав билета по предмету: подставляется сам при выборе предмета
const STANDARDS = [
  { match: ['хим', 'физ'], test: 18, matching: 2, open: 7 },
  { match: ['био', 'тадж', 'тоҷик', 'гос'], test: 20, matching: 4, open: 2 },
];
const standardFor = (name?: string) => {
  const n = (name || '').toLowerCase();
  return STANDARDS.find((s) => s.match.some((m) => n.includes(m))) ?? null;
};

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

// Начало суток по Душанбе (UTC+5) — так же считает дневной лимит база
const dushanbeDayStart = () => {
  const off = 5 * 3600_000;
  return Math.floor((Date.now() + off) / 86400_000) * 86400_000 - off;
};
const formatWait = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const fetchChapters = async (subjectId: string) => {
  const { data } = await supabase.from('chapters').select('*').eq('subject_id', subjectId).eq('is_deleted', false).order('order_index');
  return (data || []) as Chapter[];
};

// Всё, что нужно для одной генерации; title === null — название подставится само
interface GenCfg {
  subjectId: string;
  chapterIds: string[];
  topicIds: string[];
  test: number;
  matching: number;
  open: number;
  tickets: number;
  shuffleOptions: boolean;
  shuffleMatching: boolean;
  title: string | null;
}

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

// Галочка с промежуточным состоянием (выбрана часть тем главы)
const TriCheckbox: React.FC<{ checked: boolean; indeterminate: boolean; onChange: (v: boolean) => void; className?: string }> = ({ checked, indeterminate, onChange, className }) => {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={className} />;
};

// Счётчик «− число +» с крупными кнопками под палец
const Stepper: React.FC<{ label: string; hint?: string; value: number; min: number; max: number; onChange: (v: number) => void }> = ({ label, hint, value, min, max, onChange }) => (
  <div className="flex items-center justify-between gap-3 py-2">
    <div className="min-w-0">
      <div className="text-sm font-semibold text-slate-800">{label}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-lg active:scale-90 transition hover:bg-slate-50"
        aria-label={`${label}: меньше`}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.min(max, Math.max(min, parseInt(e.target.value) || min)))}
        className="w-14 h-10 text-center text-base font-bold bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
        aria-label={label}
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-lg active:scale-90 transition hover:bg-slate-50"
        aria-label={`${label}: больше`}
      >
        +
      </button>
    </div>
  </div>
);

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
  // «Весь предмет» или «Выбрать главы»: выбор глав сохраняется, даже когда включён весь предмет
  const [scopeMode, setScopeMode] = useState<ScopeMode>(() => {
    const saved = localStorage.getItem('examiner_tg_scope_mode');
    if (saved === 'all' || saved === 'pick') return saved;
    return getStorageJSON<string[]>('examiner_tg_selected_topic_ids', []).length || getStorageJSON<string[]>('examiner_tg_selected_chapter_ids', []).length ? 'pick' : 'all';
  });

  const [testCount, setTestCount] = useState<number>(() => getStorageNumber('examiner_tg_test_count', 10));
  const [matchingCount, setMatchingCount] = useState<number>(() => getStorageNumber('examiner_tg_matching_count', 2));
  const [openCount, setOpenCount] = useState<number>(() => getStorageNumber('examiner_tg_open_count', 3));
  const [ticketCount, setTicketCount] = useState<number>(() => getStorageNumber('examiner_tg_ticket_count', 2));
  const [shuffleOptions, setShuffleOptions] = useState<boolean>(() => getStorageBool('examiner_tg_shuffle_options', true));
  const [shuffleMatching, setShuffleMatching] = useState<boolean>(() => getStorageBool('examiner_tg_shuffle_matching', true));
  // Своё название набора; пусто — подставляется само («Химия — гл. 1–3 — 26.10»)
  const [customTitle, setCustomTitle] = useState<string>(() => {
    const v = getStorageString('examiner_tg_batch_title', '');
    return v === DEFAULT_BATCH_TITLE ? '' : v;
  });
  const [exportLang, setExportLang] = useExportLang();

  const [editComposition, setEditComposition] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [showVariants, setShowVariants] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ percent: number; stage: string }>({ percent: 0, stage: '' });
  const [isSharing, setIsSharing] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const [generatedBatch, setGeneratedBatch] = useState<any | null>(() => getStorageJSON('examiner_tg_generated_batch', null));
  const resultRef = React.useRef<HTMLDivElement>(null);
  const [scrollToResult, setScrollToResult] = useState(false);

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
    localStorage.setItem('examiner_tg_scope_mode', scopeMode);
  }, [scopeMode]);

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

  // Защита: не даём числу вариантов превышать лимит пользователя (для обычных пользователей — макс. 4)
  React.useEffect(() => {
    if (ticketCount > limits.tickets) {
      setTicketCount(limits.tickets);
    }
  }, [limits.tickets, ticketCount]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_shuffle_options', String(shuffleOptions));
  }, [shuffleOptions]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_shuffle_matching', String(shuffleMatching));
  }, [shuffleMatching]);

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_batch_title', customTitle);
  }, [customTitle]);

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

  // После генерации сразу показываем результат (на телефоне он иначе оказывается далеко внизу)
  React.useEffect(() => {
    if (scrollToResult && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setScrollToResult(false);
    }
  }, [scrollToResult, generatedBatch]);

  // 1. Предметы
  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Subject[];
    },
  });

  const subjectName = subjects.find((s) => s.id === subjectId)?.name || '';
  const standard = standardFor(subjectName);
  const isStandard = !!standard && testCount === standard.test && matchingCount === standard.matching && openCount === standard.open;

  // Смена предмета: выбор глав сбрасывается, состав билета — стандартный для предмета
  const applyPresetForSubject = (sId: string) => {
    setSubjectId(sId);
    setSelectedChapterIds([]);
    setSelectedTopicIds([]);
    setScopeMode('all');
    setCustomTitle('');
    const st = standardFor(subjects.find(x => x.id === sId)?.name);
    if (st) {
      setTestCount(st.test);
      setMatchingCount(st.matching);
      setOpenCount(st.open);
    }
  };

  // Автоматический выбор предмета (вместе с его стандартным составом билета)
  React.useEffect(() => {
    if (subjects.length > 0) {
      if (!subjectId || !subjects.some(s => s.id === subjectId)) {
        applyPresetForSubject(subjects[0].id);
      }
    }
  }, [subjects, subjectId]);

  // 2. Главы
  const { data: chapters = [] } = useQuery({
    queryKey: ['chapters', subjectId],
    enabled: Boolean(subjectId),
    queryFn: () => fetchChapters(subjectId),
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

  // Раскрытые главы (список тем). По умолчанию все свёрнуты: на телефоне так короче
  const [expandedChapterIds, setExpandedChapterIds] = useState<Record<string, boolean>>(() =>
    getStorageJSON('examiner_tg_expanded_chapters_v3', {})
  );

  React.useEffect(() => {
    localStorage.setItem('examiner_tg_expanded_chapters_v3', JSON.stringify(expandedChapterIds));
  }, [expandedChapterIds]);

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

  // Что реально идёт в генерацию: при «Весь предмет» — без фильтра по главам и темам
  const effTopicIds = scopeMode === 'pick' ? selectedTopicIds : [];
  const effChapterIds = scopeMode === 'pick' ? selectedChapterIds : [];
  const pickEmpty = scopeMode === 'pick' && effTopicIds.length === 0 && effChapterIds.length === 0;

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
    const topicSet = new Set(effTopicIds);
    const chapterSet = new Set(effChapterIds);
    const out = { total: 0, test: 0, matching: 0, open: 0 };
    for (const r of poolCounts) {
      if (topicSet.size > 0 ? !(r.topic_id && topicSet.has(r.topic_id)) : chapterSet.size > 0 && !(r.chapter_id && chapterSet.has(r.chapter_id))) continue;
      out.total += r.cnt;
      if (r.type === 'test' || r.type === 'matching' || r.type === 'open') out[r.type] += r.cnt;
    }
    return out;
  }, [poolCounts, effTopicIds.join(','), effChapterIds.join(',')]);

  // Состав билета с учётом того, что реально есть в выбранных темах
  const fitted = fitSettings(
    { total: poolStats?.total || 0, test: poolStats?.test || 0, matching: poolStats?.matching || 0, open: poolStats?.open || 0 },
    { testCount, matchingCount, openCount, ticketCount, shuffleOptions, shuffleMatching, title: '' }
  );
  const fittedTotal = fitted.settings.testCount + fitted.settings.matchingCount + fitted.settings.openCount;

  // Единый индикатор готовности: хватает ли вопросов, и одна кнопка, которая это исправляет
  const health = React.useMemo(() => {
    if (!poolStats || pickEmpty) return null;
    const { testCount: t, matchingCount: m, openCount: o } = fitted.settings;
    const maxBy = (pool: number, n: number) => (n > 0 ? Math.floor(pool / n) : Infinity);
    const safeRaw = Math.min(maxBy(poolStats.test, t), maxBy(poolStats.matching, m), maxBy(poolStats.open, o));
    const safe = safeRaw === Infinity ? 0 : safeRaw;
    if (fitted.error) {
      return { status: 'red' as const, title: 'В выбранных главах нет нужных вопросов', desc: 'Выберите другие главы или возьмите весь предмет.', safe: 0 };
    }
    if (fitted.notes.length > 0) {
      return {
        status: 'amber' as const,
        title: `Вопросов хватит только на билет из ${fittedTotal}`,
        desc: fitted.notes.join('; ') + '.',
        safe,
        fixCounts: true,
      };
    }
    if (safe < ticketCount) {
      return {
        status: 'amber' as const,
        title: `Без повторов хватит на ${safe} ${plural(safe, 'вариант', 'варианта', 'вариантов')}`,
        desc: `При ${ticketCount} вариантах часть вопросов повторится.`,
        safe,
        fixTickets: safe >= 1,
      };
    }
    return { status: 'green' as const, title: `Вопросов хватает: до ${safe} ${plural(safe, 'варианта', 'вариантов', 'вариантов')} без повторов`, desc: '', safe };
  }, [poolStats, pickEmpty, fitted.error, fitted.notes.join('|'), fittedTotal, ticketCount, fitted.settings.testCount, fitted.settings.matchingCount, fitted.settings.openCount]);

  // 5. Лимиты обычного пользователя: сколько генераций осталось сегодня и когда можно следующую
  const { data: usage } = useQuery({
    queryKey: ['generation_usage_today', user?.id, userLimits.cooldownSeconds],
    enabled: Boolean(user?.id) && !isAdmin,
    staleTime: 0,
    queryFn: async () => {
      const dayStart = dushanbeDayStart();
      const since = Math.min(dayStart, Date.now() - userLimits.cooldownSeconds * 1000);
      const { data, error } = await supabase
        .from('generation_usage')
        .select('created_at')
        .eq('user_id', user!.id)
        .gte('created_at', new Date(since).toISOString())
        .order('created_at', { ascending: false });
      if (error) return null;
      const rows = (data || []) as Array<{ created_at: string }>;
      return {
        today: rows.filter((r) => new Date(r.created_at).getTime() >= dayStart).length,
        last: rows[0] ? new Date(rows[0].created_at).getTime() : null,
      };
    },
  });
  const cooldownUntil = !isAdmin && usage?.last ? usage.last + userLimits.cooldownSeconds * 1000 : 0;
  const [nowTick, setNowTick] = useState(() => Date.now());
  React.useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    setNowTick(Date.now());
    const timer = setInterval(() => {
      const n = Date.now();
      setNowTick(n);
      if (n >= cooldownUntil) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);
  const cooldownLeft = cooldownUntil > nowTick ? Math.ceil((cooldownUntil - nowTick) / 1000) : 0;
  const leftToday = !isAdmin && usage ? Math.max(0, userLimits.perDay - usage.today) : null;
  const dayExhausted = leftToday === 0;

  // Номера выбранных глав (по порядку в предмете) — для названия набора
  const chapterNumsOf = (list: Chapter[], ids: string[]) =>
    list.map((ch, i) => (ids.includes(ch.id) ? i + 1 : 0)).filter(Boolean);
  const autoTitle = autoBatchTitle(subjectName, scopeMode === 'pick' ? chapterNumsOf(chapters, selectedChapterIds) : null);

  const currentCfg = (): GenCfg => ({
    subjectId, chapterIds: effChapterIds, topicIds: effTopicIds,
    test: testCount, matching: matchingCount, open: openCount, tickets: ticketCount,
    shuffleOptions, shuffleMatching, title: customTitle.trim() || null,
  });

  // Алгоритм параллельной генерации билетов
  const handleGenerate = async (cfg: GenCfg = currentCfg()) => {
    if (generatingRef.current) return; // защита от двойного нажатия
    generatingRef.current = true;
    setIsGenerating(true);
    setGenProgress({ percent: 15, stage: 'Загрузка вопросов...' });
    const { test: testCount, matching: matchingCount, open: openCount, tickets: ticketCount, shuffleOptions, shuffleMatching } = cfg;
    const subjectId = cfg.subjectId;
    const effTopicIds = cfg.topicIds;
    const effChapterIds = cfg.chapterIds;

    try {
      if (!subjectId) throw new Error('Выберите предмет');
      if (testCount + matchingCount + openCount === 0) throw new Error('Задайте хотя бы один вопрос в билете');
      if (ticketCount < 1) throw new Error('Количество билетов должно быть не менее 1');

      const limitErr = checkSettings({ testCount, matchingCount, openCount, ticketCount, shuffleOptions, shuffleMatching, title: '' }, limits);
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
        if (effTopicIds.length > 0) query = query.in('topic_id', effTopicIds);
        else if (effChapterIds.length > 0) query = query.in('chapter_id', effChapterIds);
        return query;
      });
      if (qErr || !allQuestionsRaw) throw qErr || new Error('Ошибка загрузки вопросов');

      setGenProgress({ percent: 45, stage: 'Подбор вопросов...' });

      // 2. Если вопросов какого-то вида не хватает, берём сколько есть (считаем по реально загруженным вопросам)
      const fit = fitSettings(
        calcPoolStats(allQuestionsRaw),
        { testCount, matchingCount, openCount, ticketCount, shuffleOptions, shuffleMatching, title: '' }
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

      setGenProgress({ percent: 75, stage: 'Сборка вариантов...' });

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

      setGenProgress({ percent: 90, stage: 'Сохранение...' });

      const subjChapters = chapters.length && chapters[0].subject_id === subjectId
        ? chapters
        : await queryClient.fetchQuery({ queryKey: ['chapters', subjectId], queryFn: () => fetchChapters(subjectId) });
      const title = cfg.title?.trim() || autoBatchTitle(
        subjects.find((s) => s.id === subjectId)?.name || '',
        effChapterIds.length ? chapterNumsOf(subjChapters, effChapterIds) : null,
      );

      const { data: saved, error: sErr } = await supabase.rpc('save_ticket_batch', {
        p_batch: {
          title,
          subject_id: subjectId,
          generation_params: {
            chapter_ids: effChapterIds,
            topic_ids: effTopicIds,
            test_count: useTest,
            matching_count: useMatching,
            open_count: useOpen,
            ticket_count: ticketCount,
            shuffle_options: shuffleOptions,
            shuffle_matching: shuffleMatching,
            requested: { test: testCount, matching: matchingCount, open: openCount },
            auto_title: !cfg.title?.trim(),
            source: 'site',
          },
        },
        p_tickets: ticketsPayload,
      });
      if (sErr || !saved) throw sErr || new Error('Не удалось сохранить билеты');

      setGenProgress({ percent: 100, stage: 'Готово!' });

      const batch = (saved as any).batch;
      const createdTicketsWithQuestions = ((saved as any).tickets as any[]).map((t, i) => ({
        ...t,
        questions: ticketsPayload[i].questions.map(q => ({ ...q, ticket_id: t.id })),
      }));

      setGeneratedBatch({
        ...batch,
        tickets: await withSelectionInfo(createdTicketsWithQuestions, batch.subject_id, batch.generation_params),
      });
      setShowVariants(false);
      setScrollToResult(true);

      queryClient.invalidateQueries({ queryKey: ['saved_ticket_batches'] });
      queryClient.invalidateQueries({ queryKey: ['recent_batches'] });
    } catch (err: any) {
      notifyError(err, 'Не удалось сгенерировать билеты');
    } finally {
      // Лимиты могли измениться (в том числе генерацией из Telegram) — перечитываем
      queryClient.invalidateQueries({ queryKey: ['generation_usage_today'] });
      generatingRef.current = false;
      setIsGenerating(false);
      setGenProgress({ percent: 0, stage: '' });
    }
  };

  // Последние наборы пользователя — чтобы повторить с теми же настройками
  const { data: recentBatches = [], isFetched: recentFetched } = useQuery({
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

  // Подсказка «3 шага» — пока пользователь не создал ни одного набора и не закрыл её
  const [introDismissed, setIntroDismissed] = useState(() => getStorageBool('examiner_intro_done', false));
  const dismissIntro = () => {
    setIntroDismissed(true);
    localStorage.setItem('examiner_intro_done', 'true');
  };
  const showIntro = !introDismissed && recentFetched && recentBatches.length === 0 && !generatedBatch;

  // Повторить прошлый набор одним нажатием: те же настройки — и сразу генерация
  const repeatBatch = (b: any) => {
    const p = b.generation_params || {};
    const r = p.requested ?? { test: p.test_count ?? 0, matching: p.matching_count ?? 0, open: p.open_count ?? 0 };
    const keepTitle = !p.auto_title && b.title && b.title !== DEFAULT_BATCH_TITLE;
    const cfg: GenCfg = {
      subjectId: b.subject_id,
      chapterIds: p.chapter_ids ?? [],
      topicIds: p.topic_ids ?? [],
      test: Math.min(limits.perType, r.test ?? 0),
      matching: Math.min(limits.perType, r.matching ?? 0),
      open: Math.min(limits.perType, r.open ?? 0),
      tickets: Math.min(limits.tickets, Math.max(1, p.ticket_count ?? 1)),
      shuffleOptions: typeof p.shuffle_options === 'boolean' ? p.shuffle_options : shuffleOptions,
      shuffleMatching: typeof p.shuffle_matching === 'boolean' ? p.shuffle_matching : shuffleMatching,
      title: keepTitle ? b.title : null,
    };
    // Форма показывает те же настройки, что ушли в генерацию
    setSubjectId(cfg.subjectId);
    setSelectedChapterIds(cfg.chapterIds);
    setSelectedTopicIds(cfg.topicIds);
    setScopeMode(cfg.chapterIds.length || cfg.topicIds.length ? 'pick' : 'all');
    setTestCount(cfg.test);
    setMatchingCount(cfg.matching);
    setOpenCount(cfg.open);
    setTicketCount(cfg.tickets);
    setShuffleOptions(cfg.shuffleOptions);
    setShuffleMatching(cfg.shuffleMatching);
    setCustomTitle(keepTitle ? b.title : '');
    if (dayExhausted) return notifyInfo('Настройки подставлены, но лимит генераций на сегодня исчерпан. Попробуйте завтра.');
    if (cooldownLeft > 0) return notifyInfo(`Настройки подставлены. Сгенерировать можно через ${formatWait(cooldownLeft)}.`);
    handleGenerate(cfg);
  };

  const generatedSubjectName = subjects.find(s => s.id === (generatedBatch?.subject_id || subjectId))?.name || '';
  const generatedHasKey = hasKeyTemplate(generatedSubjectName);
  const selectionOf = () => ({ subjectId: generatedBatch.subject_id || subjectId, params: generatedBatch.generation_params });

  // Экспорт созданных билетов в Word на выбранном языке (ключи ответов кладутся в тот же архив)
  const handleDownload = async (lang: Lang) => {
    if (!generatedBatch || !generatedBatch.tickets || isDownloading) return;
    setExportLang(lang);
    setIsDownloading(true);
    try {
      const subj = generatedSubjectName || 'Экзамен';
      await exportTicketsToDocx(
        generatedBatch.title,
        generatedBatch.tickets,
        subj,
        lang,
        await keyArchiveExtras(generatedBatch.title, generatedBatch.tickets, subj, selectionOf(), lang)
      );
    } catch (err: any) {
      notifyError(err, 'Не удалось скачать билеты');
    } finally {
      setIsDownloading(false);
    }
  };

  // Один вариант вместе с его ключами (ZIP)
  const exportSingleWithKey = async (t: any, lang: 'ru' | 'tg') => {
    if (!generatedBatch) return;
    try {
      const subj = generatedSubjectName || 'Экзамен';
      await exportSingleTicketDocx(
        generatedBatch.title || autoTitle, t, subj, lang,
        await keyArchiveExtras(generatedBatch.title || autoTitle, [t], subj, selectionOf(), lang)
      );
    } catch (err: any) {
      notifyError(err, 'Не удалось скачать вариант');
    }
  };

  const handleExportKey = async () => {
    if (!generatedBatch || !generatedBatch.tickets) return;
    try {
      const stats = await exportAnswerKey(generatedBatch.title, generatedBatch.tickets, generatedSubjectName, selectionOf());
      if (stats.universal) notifyInfo('Состав вопросов не поместился в шаблон ключей, поэтому ключ собран в универсальной таблице — все ответы на месте.');
      if (stats.missing) notifyError(new Error(`В базе нет верного ответа у вопросов: ${stats.missing} — клетки в ключе отмечены красным.`), 'Ключи готовы, но не полные');
    } catch (err: any) {
      notifyError(err, 'Не удалось скачать ключи');
    }
  };

  // Поделиться билетами через Web Share API (Telegram, WhatsApp, AirDrop и т.д.)
  const handleShareTickets = async () => {
    if (!generatedBatch || !generatedBatch.tickets) return;
    setIsSharing(true);
    try {
      const subj = generatedSubjectName || 'Предмет';
      const extras = await keyArchiveExtras(generatedBatch.title, generatedBatch.tickets, subj, selectionOf(), exportLang);
      const file = await buildTicketsFile(generatedBatch.title, generatedBatch.tickets, subj, exportLang, extras);
      if (!file) return;

      const shareFile = new File([file.blob], file.fileName, {
        type: file.fileName.endsWith('.zip') ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const text = `Экзаменационные билеты (${subj}) — ${generatedBatch.tickets.length} вар.`;

      if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
        await navigator.share({ title: generatedBatch.title, text, files: [shareFile] });
      } else {
        await navigator.share({ title: generatedBatch.title, text, url: window.location.href });
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        notifyError(err, 'Не удалось поделиться билетами');
      }
    } finally {
      setIsSharing(false);
    }
  };

  // Кнопка генерации: что мешает нажать и что на ней написать
  const blockReason = pickEmpty
    ? 'Отметьте главы'
    : poolStats && fitted.error
    ? 'Нет вопросов'
    : dayExhausted
    ? 'Лимит на сегодня исчерпан'
    : cooldownLeft > 0
    ? `Можно через ${formatWait(cooldownLeft)}`
    : null;
  const healthDot = !health ? 'bg-slate-300' : health.status === 'green' ? 'bg-emerald-500' : health.status === 'amber' ? 'bg-amber-500' : 'bg-rose-500';

  const variantChoices = isAdmin
    ? [1, 2, 4, 10, 20, 50].filter((n) => n <= limits.tickets)
    : Array.from({ length: Math.min(limits.tickets, 6) }, (_, i) => i + 1);

  const selectedChaptersCount = chapters.filter((ch) => {
    const chTopics = allTopics.filter((t) => t.chapter_id === ch.id);
    return chTopics.some((t) => selectedTopicIds.includes(t.id)) || (chTopics.length === 0 && selectedChapterIds.includes(ch.id));
  }).length;

  return (
    <div className="space-y-4 sm:space-y-5 max-w-5xl mx-auto">
      {/* Заголовок */}
      <div className="px-1">
        <h2 className="text-xl font-bold text-slate-900 leading-tight">Генератор билетов</h2>
        <p className="text-sm text-slate-600 mt-1">
          Выберите предмет и нажмите «Сгенерировать» — получите Word с билетами и ключами.
        </p>
      </div>

      {/* Результат генерации — первым, чтобы сразу было видно, что всё готово */}
      {generatedBatch && (
        <div ref={resultRef} className="scroll-mt-24 bento-card rounded-2xl p-4 sm:p-5 border-emerald-200 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900 text-base leading-tight">
                  Готово: {generatedBatch.tickets.length} {plural(generatedBatch.tickets.length, 'вариант', 'варианта', 'вариантов')}
                  {generatedBatch.tickets[0] ? ` по ${generatedBatch.tickets[0].questions.length} вопр.` : ''}
                </h3>
                <p className="text-sm text-slate-600 mt-0.5 truncate">
                  {generatedSubjectName}{generatedBatch.title ? ` · ${generatedBatch.title}` : ''}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Копия сохранена в архиве билетов</p>
              </div>
            </div>
            <button
              onClick={() => setGeneratedBatch(null)}
              className="w-10 h-10 -mr-2 -mt-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center shrink-0"
              aria-label="Закрыть результат"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Главное действие: скачать на запомненном языке; стрелка — выбрать другой язык */}
          <div className="sm:max-w-md sm:mx-auto">
            <DownloadButton lang={exportLang} busy={isDownloading} onDownload={handleDownload} />
            <p className="text-xs text-slate-500 mt-2 text-center">
              {generatedHasKey ? 'В архиве: билеты + ключи ответов' : 'Билеты в формате Word'}
            </p>
          </div>

          {/* Второстепенные действия */}
          <div className="flex flex-wrap items-center gap-2">
            <SendToTelegramButton
              title={generatedBatch.title}
              batchId={generatedBatch.id}
              ticketCount={generatedBatch.tickets.length}
              build={async (lang) => buildTicketsFile(
                generatedBatch.title,
                generatedBatch.tickets,
                generatedSubjectName || 'Экзамен',
                lang,
                await keyArchiveExtras(generatedBatch.title, generatedBatch.tickets, generatedSubjectName, selectionOf(), lang)
              )}
            />
            {canShare && (
              <button
                onClick={handleShareTickets}
                disabled={isSharing}
                className="min-h-[40px] px-3.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
              >
                {isSharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                <span>Поделиться</span>
              </button>
            )}
            {generatedHasKey && (
              <button
                onClick={handleExportKey}
                className="min-h-[40px] px-2 text-sm font-semibold text-slate-600 hover:text-indigo-700 underline-offset-2 hover:underline"
              >
                Только ключи
              </button>
            )}
          </div>

          {/* Просмотр вариантов — по запросу, чтобы не растягивать экран */}
          <div className="border-t border-slate-100 pt-2">
            <button
              onClick={() => setShowVariants((v) => !v)}
              className="w-full min-h-[44px] flex items-center justify-between text-sm font-semibold text-slate-700"
            >
              <span>Посмотреть варианты</span>
              <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${showVariants ? 'rotate-180' : ''}`} />
            </button>
            {showVariants && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                {generatedBatch.tickets.map((t: any) => (
                  <div key={t.id} className="p-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-slate-900">Вариант {t.ticket_number}</span>
                      <div className="flex items-center gap-1.5">
                        {(exportLang === 'both' ? (['ru', 'tg'] as const) : [exportLang]).map((l) => (
                          <button
                            key={l}
                            onClick={() => exportSingleWithKey(t, l)}
                            className="min-h-[36px] px-2.5 text-xs bg-white hover:bg-indigo-50 text-indigo-700 font-semibold rounded-lg border border-indigo-200/70 flex items-center gap-1 transition active:scale-95"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {l === 'tg' ? 'TJ' : 'RU'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1 text-sm text-slate-700 max-h-48 overflow-y-auto pr-1">
                      {t.questions.map((tq: any, i: number) => (
                        <div key={i} className="px-2 py-1.5 bg-white rounded-lg border border-slate-100 truncate">
                          <span className="font-bold text-slate-500 mr-1.5">{i + 1}.</span>
                          {tq.question_snapshot.content.replace(/<.*?>/g, '')}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Первый вход: как получить билеты за 3 шага */}
      {showIntro && (
        <div className="bento-card rounded-2xl p-4 sm:p-5 border-indigo-200 bg-indigo-50/50">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-bold text-slate-900 text-base">Как получить билеты за 3 шага</h3>
            <button
              onClick={dismissIntro}
              className="w-10 h-10 -mr-2 -mt-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-white flex items-center justify-center shrink-0"
              aria-label="Скрыть подсказку"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <ol className="mt-2 space-y-2 text-sm text-slate-700">
            {[
              ['Выберите предмет', 'состав билета подставится сам'],
              ['Оставьте «Весь предмет»', 'или отметьте нужные главы'],
              ['Нажмите «Сгенерировать» внизу', 'и скачайте Word с билетами и ключами'],
            ].map(([a, b], i) => (
              <li key={a} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span><b className="text-slate-900">{a}</b> — {b}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Повторить прошлый набор: одно нажатие — тот же набор заново. На телефоне — лента, листается пальцем */}
      {recentBatches.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 px-1 mb-2 text-sm font-semibold text-slate-700">
            <History className="w-4 h-4" />
            <span>Собрать заново в одно нажатие</span>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap">
            {recentBatches.map((b) => {
              const p = b.generation_params || {};
              const scope = p.chapter_ids?.length ? `${p.chapter_ids.length} гл.` : 'весь предмет';
              return (
                <button
                  key={b.id}
                  onClick={() => repeatBatch(b)}
                  disabled={isGenerating}
                  className="shrink-0 text-left pl-3 pr-3.5 py-2 bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 rounded-2xl transition active:scale-95 disabled:opacity-50 flex items-center gap-2.5"
                  title={`${b.title} — сгенерировать заново с теми же настройками`}
                >
                  <RotateCcw className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800 whitespace-nowrap">
                      {b.subject?.name || b.title} · {scope}
                    </span>
                    <span className="block text-xs text-slate-600 whitespace-nowrap">
                      {p.ticket_count ?? '?'} вар. · {new Date(b.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 sm:gap-5 items-start">
        <div className="md:col-span-3 space-y-4 sm:space-y-5">
          {/* 1. Предмет */}
          <section className="bento-card p-4 sm:p-5 rounded-2xl space-y-3">
            <h3 className="font-bold text-slate-900 text-base">1. Предмет</h3>
            {subjects.length <= 8 ? (
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => s.id !== subjectId && applyPresetForSubject(s.id)}
                    className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold border transition active:scale-95 ${
                      s.id === subjectId
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                    aria-pressed={s.id === subjectId}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            ) : (
              <select
                value={subjectId}
                onChange={(e) => applyPresetForSubject(e.target.value)}
                className="w-full min-h-[44px] text-base px-3 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-900"
              >
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </section>

          {/* 2. Что включить: весь предмет или выбранные главы */}
          <section className="bento-card p-4 sm:p-5 rounded-2xl space-y-3">
            <h3 className="font-bold text-slate-900 text-base">2. Какие главы</h3>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-2xl" role="radiogroup" aria-label="Какие главы">
              {([['all', 'Весь предмет'], ['pick', 'Выбрать главы']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={scopeMode === mode}
                  onClick={() => setScopeMode(mode)}
                  className={`min-h-[44px] rounded-xl text-sm font-semibold transition ${
                    scopeMode === mode ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {scopeMode === 'all' ? (
              <p className="text-sm text-slate-600 px-1">
                В билеты войдут все {chapters.length} {plural(chapters.length, 'глава', 'главы', 'глав')} и {allTopics.length} {plural(allTopics.length, 'тема', 'темы', 'тем')}.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="text-sm text-slate-600">
                    {pickEmpty ? 'Отметьте нужные главы' : `Выбрано глав: ${selectedChaptersCount} из ${chapters.length}`}
                  </span>
                  {!pickEmpty && (
                    <button
                      type="button"
                      onClick={() => { setSelectedTopicIds([]); setSelectedChapterIds([]); }}
                      className="min-h-[36px] px-2 text-sm font-semibold text-slate-500 hover:text-slate-800"
                    >
                      Снять всё
                    </button>
                  )}
                </div>
                <div className="space-y-2 md:max-h-[60vh] md:overflow-y-auto md:pr-1">
                  {chapters.map((ch, chIdx) => {
                    const chTopics = allTopics.filter(t => t.chapter_id === ch.id);
                    const chSelected = chTopics.filter(t => selectedTopicIds.includes(t.id)).length;
                    const isAll = chTopics.length > 0 ? chSelected === chTopics.length : selectedChapterIds.includes(ch.id);
                    const isExpanded = expandedChapterIds[ch.id] ?? false;
                    return (
                      <div key={ch.id} className={`border rounded-2xl overflow-hidden transition ${chSelected > 0 || isAll ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'}`}>
                        <div className="flex items-stretch">
                          <label className="flex items-start gap-3 flex-1 min-w-0 p-3 cursor-pointer select-none">
                            <TriCheckbox
                              checked={isAll}
                              indeterminate={chSelected > 0}
                              onChange={(v) => (v ? handleSelectChapterTopics(ch.id) : handleDeselectChapterTopics(ch.id))}
                              className="mt-0.5 w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 shrink-0"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-slate-900 leading-snug break-words">{ch.name}</span>
                              <span className="block text-xs text-slate-500 mt-0.5">
                                {chSelected > 0 && !isAll ? `Тем: ${chSelected} из ${chTopics.length}` : `${chTopics.length} ${plural(chTopics.length, 'тема', 'темы', 'тем')}`}
                              </span>
                            </span>
                          </label>
                          {chTopics.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleChapterExpanded(ch.id)}
                              className="w-12 shrink-0 flex items-center justify-center text-slate-500 hover:text-slate-700 border-l border-slate-100"
                              aria-label={isExpanded ? `Свернуть темы главы ${chIdx + 1}` : `Показать темы главы ${chIdx + 1}`}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? <ChevronDown className="w-5 h-5 text-indigo-600" /> : <ChevronRight className="w-5 h-5" />}
                            </button>
                          )}
                        </div>
                        {isExpanded && (
                          <div className="px-2 pb-2 space-y-1 border-t border-slate-100 bg-white">
                            {chTopics.map((tp, tpIdx) => {
                              const isChecked = selectedTopicIds.includes(tp.id);
                              return (
                                <label
                                  key={tp.id}
                                  className={`flex items-start gap-3 px-2.5 py-2.5 mt-1 rounded-xl cursor-pointer text-sm transition ${
                                    isChecked ? 'bg-indigo-50 text-slate-900 font-medium' : 'hover:bg-slate-50 text-slate-700'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => handleToggleTopic(tp.id, ch.id, e.target.checked)}
                                    className="mt-0.5 w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 shrink-0"
                                  />
                                  <span className="leading-snug">{tpIdx + 1}. {tp.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>

        <div className="md:col-span-2 space-y-4 sm:space-y-5">
          {/* 3. Состав билета: по умолчанию — стандарт предмета одной строкой */}
          <section className="bento-card p-4 sm:p-5 rounded-2xl space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900 text-base">3. Состав билета</h3>
                {!editComposition && (
                  <p className="text-sm text-slate-700 mt-1">
                    <b>{testCount + matchingCount + openCount}</b> {plural(testCount + matchingCount + openCount, 'вопрос', 'вопроса', 'вопросов')}: {testCount} тест. · {matchingCount} соотв. · {openCount} откр.
                  </p>
                )}
                {!editComposition && isStandard && (
                  <span className="inline-block mt-1.5 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Стандарт для предмета «{subjectName}»
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setEditComposition((v) => !v)}
                className="min-h-[40px] px-3 rounded-xl text-sm font-semibold text-indigo-700 hover:bg-indigo-50 shrink-0"
              >
                {editComposition ? 'Готово' : 'Изменить'}
              </button>
            </div>

            {editComposition && (
              <div className="divide-y divide-slate-100 -mt-1">
                <Stepper label="Тестовые" hint={`Доступно: ${poolStats?.test ?? 0}`} value={testCount} min={0} max={limits.perType} onChange={setTestCount} />
                <Stepper label="На соответствие" hint={`Доступно: ${poolStats?.matching ?? 0}`} value={matchingCount} min={0} max={limits.perType} onChange={setMatchingCount} />
                <Stepper label="Открытые" hint={`Доступно: ${poolStats?.open ?? 0}`} value={openCount} min={0} max={limits.perType} onChange={setOpenCount} />
                {standard && !isStandard && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => { setTestCount(standard.test); setMatchingCount(standard.matching); setOpenCount(standard.open); }}
                      className="min-h-[40px] text-sm font-semibold text-indigo-700"
                    >
                      Вернуть стандарт: {standard.test} + {standard.matching} + {standard.open}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Число вариантов — меняют чаще всего, поэтому всегда на виду */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-slate-800">Вариантов</span>
                {isAdmin && <span className="text-xs text-slate-500">до {limits.tickets}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {variantChoices.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTicketCount(n)}
                    className={`min-w-[48px] min-h-[44px] px-3 rounded-xl text-base font-bold border transition active:scale-95 ${
                      ticketCount === n ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                    aria-pressed={ticketCount === n}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {isAdmin && (
                <Stepper label="Другое число" value={ticketCount} min={1} max={limits.tickets} onChange={setTicketCount} />
              )}
            </div>

            {/* Готовность: один блок и одна кнопка, которая исправляет проблему */}
            {pickEmpty ? (
              <div className="p-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
                Отметьте хотя бы одну главу — или выберите «Весь предмет».
              </div>
            ) : health && (
              <div className={`p-3 rounded-2xl border ${
                health.status === 'green' ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : health.status === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}>
                <div className="flex items-start gap-2.5">
                  <span className={`w-3 h-3 rounded-full mt-1 shrink-0 ${healthDot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold leading-snug">{health.title}</div>
                    {health.desc && <p className="text-sm mt-0.5 leading-snug opacity-90">{health.desc}</p>}
                    {health.status !== 'green' && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {'fixTickets' in health && health.fixTickets && (
                          <button
                            type="button"
                            onClick={() => setTicketCount(health.safe)}
                            className="min-h-[40px] px-3 rounded-xl bg-white border border-black/10 text-sm font-semibold active:scale-95"
                          >
                            Сделать {health.safe} {plural(health.safe, 'вариант', 'варианта', 'вариантов')}
                          </button>
                        )}
                        {'fixCounts' in health && health.fixCounts && (
                          <button
                            type="button"
                            onClick={() => { setTestCount(fitted.settings.testCount); setMatchingCount(fitted.settings.matchingCount); setOpenCount(fitted.settings.openCount); }}
                            className="min-h-[40px] px-3 rounded-xl bg-white border border-black/10 text-sm font-semibold active:scale-95"
                          >
                            Сделать билет из {fittedTotal} вопр.
                          </button>
                        )}
                        {scopeMode === 'pick' && (
                          <button
                            type="button"
                            onClick={() => setScopeMode('all')}
                            className="min-h-[40px] px-3 rounded-xl bg-white border border-black/10 text-sm font-semibold active:scale-95"
                          >
                            Взять весь предмет
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Дополнительно: название и перемешивание — нужны редко */}
            <div className="border-t border-slate-100 pt-1">
              <button
                type="button"
                onClick={() => setShowExtra((v) => !v)}
                className="w-full min-h-[44px] flex items-center justify-between text-sm font-semibold text-slate-600"
              >
                <span className="flex items-center gap-2"><SlidersHorizontal className="w-4 h-4" /> Дополнительно</span>
                <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${showExtra ? 'rotate-180' : ''}`} />
              </button>
              {showExtra && (
                <div className="space-y-3 pb-1">
                  <label className="block">
                    <span className="block text-sm font-semibold text-slate-700 mb-1">Название набора</span>
                    <input
                      type="text"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder={autoTitle}
                      maxLength={100}
                      className="w-full min-h-[44px] text-base px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="block text-xs text-slate-600 mt-1">
                      {customTitle.trim() ? (
                        <button type="button" onClick={() => setCustomTitle('')} className="font-semibold text-indigo-700 min-h-[32px]">
                          Вернуть автоматическое название
                        </button>
                      ) : 'Можно не заполнять — название подставится само'}
                    </span>
                  </label>
                  <label className="flex items-center gap-3 min-h-[40px] text-sm text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={shuffleOptions}
                      onChange={(e) => setShuffleOptions(e.target.checked)}
                      className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                    />
                    <span>Перемешать варианты ответов (A, B, C, D)</span>
                  </label>
                  <label className="flex items-center gap-3 min-h-[40px] text-sm text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={shuffleMatching}
                      onChange={(e) => setShuffleMatching(e.target.checked)}
                      className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                    />
                    <span>Перемешать пары в заданиях на соответствие</span>
                  </label>
                </div>
              )}
            </div>
          </section>

          {/* Кнопка генерации: на телефоне закреплена над нижним меню, на компьютере — под настройками */}
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-3 pb-2 pt-2 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent md:static md:inset-auto md:z-auto md:p-0 md:bg-none">
            <div className="max-w-5xl mx-auto bento-card rounded-2xl p-2 pl-3.5 flex items-center gap-3 shadow-lg md:shadow-sm md:p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${healthDot}`} />
                  <span className="truncate">{ticketCount} вар. × {fittedTotal} вопр.</span>
                </div>
                <div className="text-xs text-slate-500 leading-tight">
                  {leftToday !== null
                    ? `Сегодня ещё ${leftToday} из ${userLimits.perDay}`
                    : subjectName}
                </div>
              </div>
              <button
                onClick={() => handleGenerate()}
                disabled={isGenerating || !!blockReason}
                className={`relative overflow-hidden min-h-[52px] px-5 rounded-xl text-base font-bold flex ${generatedBatch && !isGenerating ? 'bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/25'} items-center justify-center gap-2 transition active:scale-[0.98] disabled:bg-slate-300 disabled:border-transparent disabled:text-slate-600 disabled:shadow-none shrink-0 max-w-[60%]`}
              >
                {isGenerating && (
                  <div
                    className="absolute left-0 top-0 bottom-0 bg-indigo-400/60 transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(10, genProgress.percent)}%` }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2 min-w-0">
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                      <span className="truncate">{genProgress.percent}%</span>
                    </>
                  ) : blockReason ? (
                    <span className="truncate text-sm">{blockReason}</span>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 shrink-0" />
                      <span className="truncate">{generatedBatch ? 'Ещё набор' : 'Сгенерировать'}</span>
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
          {/* Место под закреплённой кнопкой, чтобы она не закрывала конец страницы */}
          <div className="h-20 md:hidden" aria-hidden />
        </div>
      </div>
    </div>
  );
};
