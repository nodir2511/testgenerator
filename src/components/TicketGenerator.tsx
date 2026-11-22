import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { examProfileFor } from '../../supabase/functions/_shared/examProfiles';
import { nctConfigFor } from '../../supabase/functions/_shared/nctConfigs';
import { CHEM_CONFIG, NCT_DEFAULT_DIFFICULTY, type NctDifficultyShares } from '../../supabase/functions/_shared/nct';
import { fitSettings } from '../../supabase/functions/_shared/ticketing';
import { Subject, Chapter, Topic, Question } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { fetchSubjects } from '../lib/startupPrefetch';
import { hasKeyTemplate, withSelectionInfo, warmKeyModule } from '../lib/exportLazy';
import { useUserLimits } from '../lib/generationLimits';
import { autoBatchTitle, DEFAULT_BATCH_TITLE } from '../lib/batchTitle';
import { useExportLang } from './DownloadButton';
import { PageHeader } from './ui';
import {
  ADMIN_SITE_LIMITS, standardFor, plural, dushanbeDayStart, formatWait,
  getStorageJSON, getStorageString, getStorageNumber, getStorageBool,
} from '../lib/generatorHelpers';
import { GeneratedBatchPanel } from './generator/GeneratedBatchPanel';
import { IntroCard } from './generator/IntroCard';
import { ScopeColumn, type ScopeMode } from './generator/ScopeColumn';
import { CompositionColumn } from './generator/CompositionColumn';
import { useGenerate, fetchQuestionCounts, type GenCfg } from './generator/useGenerate';

type PassageCountRow = { chapter_id: string | null; topic_id: string | null; kind: string; passages: number; questions: number };

// Тексты предмета (полные, по 8 вопросов). RPC появляется после применения supabase/sql/passages.sql;
// до этого (или при любой ошибке) — пустой список, и экран выглядит как у предмета без текстов
const fetchPassageCounts = async (subjectId: string): Promise<PassageCountRow[]> => {
  try {
    const { data, error } = await supabase.rpc('passage_counts', { p_subject_id: subjectId });
    if (error) return [];
    return (data || []) as PassageCountRow[];
  } catch {
    return [];
  }
};

// Главы предмета со всеми темами одним запросом (вместо двух последовательных)
const fetchStructure = async (subjectId: string): Promise<{ chapters: Chapter[]; topics: Topic[] }> => {
  const { data, error } = await supabase
    .from('chapters')
    .select('*, topics(*)')
    .eq('subject_id', subjectId)
    .eq('is_deleted', false)
    .eq('topics.is_deleted', false)
    .order('order_index')
    .order('order_index', { referencedTable: 'topics' });
  if (error) throw error;
  const rows = (data || []) as Array<Chapter & { topics: Topic[] | null }>;
  return {
    chapters: rows.map(({ topics: _t, ...ch }) => ch as Chapter),
    topics: rows.flatMap((r) => r.topics ?? []),
  };
};

export const TicketGenerator: React.FC = () => {
  const queryClient = useQueryClient();
  const { user, isAdmin, isStaff, isOwner } = useAuth();
  const userLimits = useUserLimits();
  const limits = isStaff ? ADMIN_SITE_LIMITS : userLimits;

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
  const [readingCount, setReadingCount] = useState<number>(() => getStorageNumber('examiner_tg_reading_count', 0));
  const [clozeCount, setClozeCount] = useState<number>(() => getStorageNumber('examiner_tg_cloze_count', 0));
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

  // Модуль ключей (с JSZip) подгружается заранее, в простое: иначе показ созданных билетов ждёт его загрузки
  React.useEffect(() => {
    const t = setTimeout(warmKeyModule, 1500);
    return () => clearTimeout(t);
  }, []);

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
    localStorage.setItem('examiner_tg_reading_count', String(readingCount));
    localStorage.setItem('examiner_tg_cloze_count', String(clozeCount));
  }, [readingCount, clozeCount]);

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
  const { data: subjects = [], isSuccess: subjectsLoaded } = useQuery({
    queryKey: ['subjects'],
    queryFn: fetchSubjects,
  });
  // Запомненный предмет удалён или больше не назначен: выбор сбрасывается
  React.useEffect(() => {
    if (subjectId && subjectsLoaded && !subjects.some((s) => s.id === subjectId)) {
      setSubjectId(''); setSelectedChapterIds([]); setSelectedTopicIds([]);
    }
  }, [subjectId, subjects, subjectsLoaded]);

  const subjectName = subjects.find((s) => s.id === subjectId)?.name || '';
  const standard = standardFor(subjectName);
  const nctCfg = nctConfigFor(subjectName) ?? CHEM_CONFIG; // настройки режима НЦТ предмета (химия, право)
  const isChem = isStaff && !!examProfileFor(subjectName); // режим НЦТ: админы по предметам и выше (доли сложности — только главный админ)
  const [nctPref, setNctPref] = useState<boolean>(() => getStorageBool('examiner_nct_mode', false));
  const nctMode = isChem && nctPref;
  const [permPref, setPermPref] = useState<boolean>(() => getStorageBool('examiner_nct_perm', false));
  const [diffShares, setDiffShares] = useState<NctDifficultyShares>(() => {
    const v = getStorageJSON<Partial<NctDifficultyShares>>('examiner_nct_diff', NCT_DEFAULT_DIFFICULTY);
    const ok = [v.easy, v.medium, v.hard].every((x) => typeof x === 'number' && x >= 0 && x <= 100) && (v.easy! + v.medium! + v.hard!) === 100;
    return ok ? (v as NctDifficultyShares) : NCT_DEFAULT_DIFFICULTY;
  });
  const diffSum = diffShares.easy + diffShares.medium + diffShares.hard;
  const setDiffShare = (key: keyof NctDifficultyShares, raw: string) => {
    const n = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    setDiffShares((prev) => {
      const next = { ...prev, [key]: n };
      try { localStorage.setItem('examiner_nct_diff', JSON.stringify(next)); } catch { /* память недоступна */ }
      return next;
    });
  };
  const permAvailable = !nctCfg.textSections && ticketCount >= 4 && ticketCount % 2 === 0;
  const nctPerm = nctMode && permPref && permAvailable;
  const isStandard = !!standard && testCount === standard.test && matchingCount === standard.matching && openCount === standard.open
    && readingCount === (standard.reading ?? 0) && clozeCount === (standard.cloze ?? 0);

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
    setReadingCount(st?.reading ?? 0);
    setClozeCount(st?.cloze ?? 0);
  };

  // Автоматический выбор предмета (вместе с его стандартным составом билета)
  React.useEffect(() => {
    if (subjects.length > 0) {
      if (!subjectId || !subjects.some(s => s.id === subjectId)) {
        applyPresetForSubject(subjects[0].id);
      }
    }
  }, [subjects, subjectId]);

  // 2–3. Главы и все их темы (для древовидного раскрытия) — одним запросом.
  // Кэш живёт минуту; правки в «Предметах и темах» сбрасывают его (ключ topics_for_generation).
  const { data: structure } = useQuery({
    queryKey: ['topics_for_generation', subjectId],
    enabled: Boolean(subjectId),
    staleTime: 60_000,
    queryFn: () => fetchStructure(subjectId),
  });
  const chapters = React.useMemo(() => structure?.chapters ?? [], [structure]);
  const allTopics = React.useMemo(() => structure?.topics ?? [], [structure]);
  // Запомненные главы и темы, которых в предмете уже нет (удалены), из выбора убираем:
  // иначе «нет вопросов», хотя ни одна глава не отмечена
  React.useEffect(() => {
    if (!structure) return;
    const ch = new Set(structure.chapters.map((c) => c.id));
    const tp = new Set(structure.topics.map((t) => t.id));
    setSelectedChapterIds((prev) => (prev.every((id) => ch.has(id)) ? prev : prev.filter((id) => ch.has(id))));
    setSelectedTopicIds((prev) => (prev.every((id) => tp.has(id)) ? prev : prev.filter((id) => tp.has(id))));
  }, [structure]);

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
    staleTime: 30_000, // сбрасывается при правке вопросов
    enabled: Boolean(subjectId),
    queryFn: () => fetchQuestionCounts(subjectId),
  });
  // Тексты предмета (английский): RPC есть только в supabase/sql/passages.sql; пока он не применён — пустой список
  const { data: passageRows } = useQuery({
    queryKey: ['passage_counts', subjectId],
    staleTime: 30_000,
    enabled: Boolean(subjectId),
    queryFn: () => fetchPassageCounts(subjectId),
  });
  const poolStats = React.useMemo(() => {
    if (!poolCounts) return undefined;
    const topicSet = new Set(effTopicIds);
    const chapterSet = new Set(effChapterIds);
    const inScope = (r: { topic_id: string | null; chapter_id: string | null }) =>
      topicSet.size > 0 ? !!(r.topic_id && topicSet.has(r.topic_id)) : chapterSet.size === 0 || !!(r.chapter_id && chapterSet.has(r.chapter_id));
    const out = { total: 0, test: 0, matching: 0, open: 0, reading: 0, cloze: 0 };
    for (const r of poolCounts) {
      if (!inScope(r)) continue;
      out.total += r.cnt;
      if (r.type === 'test' || r.type === 'matching' || r.type === 'open') out[r.type] += r.cnt;
    }
    // вопросы текстов не считаются отдельными тестами; тексты считаются блоками
    for (const p of passageRows ?? []) {
      if (!inScope(p)) continue;
      out.test = Math.max(0, out.test - p.questions);
      if (p.kind === 'reading') out.reading += p.passages;
      else if (p.kind === 'cloze') out.cloze += p.passages;
    }
    return out;
  }, [poolCounts, passageRows, effTopicIds.join(','), effChapterIds.join(',')]);
  const hasTexts = (poolStats?.reading ?? 0) + (poolStats?.cloze ?? 0) > 0;
  // поля текстов показываем, если в выбранных темах есть тексты или они уже заданы
  const showTexts = hasTexts || readingCount + clozeCount > 0;

  // Состав билета с учётом того, что реально есть в выбранных темах
  const fitted = fitSettings(
    { total: poolStats?.total || 0, test: poolStats?.test || 0, matching: poolStats?.matching || 0, open: poolStats?.open || 0, reading: poolStats?.reading || 0, cloze: poolStats?.cloze || 0 },
    { testCount, matchingCount, openCount, ticketCount, shuffleOptions, shuffleMatching, title: '', ...(hasTexts || readingCount + clozeCount > 0 ? { readingCount, clozeCount } : {}) }
  );
  const fittedTotal = fitted.settings.testCount + fitted.settings.matchingCount + fitted.settings.openCount;

  // Единый индикатор готовности: хватает ли вопросов, и одна кнопка, которая это исправляет
  const health = React.useMemo(() => {
    if (!poolStats || pickEmpty) return null;
    const { testCount: t, matchingCount: m, openCount: o } = fitted.settings;
    const rc = fitted.settings.readingCount ?? 0, cc = fitted.settings.clozeCount ?? 0;
    const maxBy = (pool: number, n: number) => (n > 0 ? Math.floor(pool / n) : Infinity);
    const safeRaw = Math.min(
      maxBy(poolStats.test, t - 8 * (rc + cc)), maxBy(poolStats.matching, m), maxBy(poolStats.open, o),
      maxBy(poolStats.reading, rc), maxBy(poolStats.cloze, cc),
    );
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
    enabled: Boolean(user?.id) && !isStaff,
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
  const cooldownUntil = !isStaff && usage?.last ? usage.last + userLimits.cooldownSeconds * 1000 : 0;
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
  const leftToday = !isStaff && usage ? Math.max(0, userLimits.perDay - usage.today) : null;
  const dayExhausted = leftToday === 0;

  // Номера выбранных глав (по порядку в предмете) — для названия набора
  const chapterNumsOf = (list: Chapter[], ids: string[]) =>
    list.map((ch, i) => (ids.includes(ch.id) ? i + 1 : 0)).filter(Boolean);
  const autoTitle = autoBatchTitle(subjectName, scopeMode === 'pick' ? chapterNumsOf(chapters, selectedChapterIds) : null);

  const currentCfg = (): GenCfg => ({
    subjectId, chapterIds: effChapterIds, topicIds: effTopicIds,
    test: testCount, matching: matchingCount, open: openCount, tickets: ticketCount,
    ...(readingCount + clozeCount > 0 ? { reading: readingCount, cloze: clozeCount } : {}),
    shuffleOptions, shuffleMatching, title: customTitle.trim() || null, nct: nctMode, nctPerm,
    ...(nctMode && isOwner ? { nctDiff: diffShares } : {}),
  });

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


  const generatedSubjectName = subjects.find(s => s.id === (generatedBatch?.subject_id || subjectId))?.name || '';
  const generatedHasKey = hasKeyTemplate(generatedSubjectName);
  const selectionOf = () => ({ subjectId: generatedBatch.subject_id || subjectId, params: generatedBatch.generation_params });

  // Создание билетов и их выдача (Word, ключи, «Поделиться») — в хуке; состояние остаётся здесь
  const { handleGenerate, handleDownload, exportSingleWithKey, handleExportKey, handleShareTickets } = useGenerate({
    queryClient, currentCfg, nctCfg, limits, subjectName, subjects, chapters, allTopics, chapterNumsOf, autoTitle, setIsGenerating, setGenProgress,
    generatedBatch, setGeneratedBatch, setShowVariants, setScrollToResult, generatedSubjectName, selectionOf, exportLang, setExportLang,
    isDownloading, setIsDownloading, setIsSharing,
  });

  // Набор изменили (замена вопросов или темы): обновляем билеты и параметры, чтобы Word, ключи и Telegram взяли новые вопросы
  const handleBatchChanged = async (params: any, tickets: any[]) => {
    const withInfo = await withSelectionInfo(tickets, generatedBatch?.subject_id || subjectId, params);
    setGeneratedBatch((prev: any) => (prev ? { ...prev, generation_params: params, tickets: withInfo } : prev));
  };

  // Карточка «Готово» хранится в браузере. Пока раздел был закрыт, набор могли изменить или удалить
  // в «Архиве билетов»: при открытии сверяем её с базой, чтобы скачивался нынешний состав.
  React.useEffect(() => {
    const id = generatedBatch?.id;
    if (!id) return;
    let off = false;
    (async () => {
      const { data: row, error } = await supabase.from('ticket_batches').select('id, generation_params').eq('id', id).maybeSingle();
      if (off || error) return;
      if (!row) { setGeneratedBatch(null); return; }
      const { data, error: tErr } = await supabase.from('tickets')
        .select('id, ticket_number, created_at, questions:ticket_questions(id, order_index, question_snapshot)')
        .eq('batch_id', id).order('ticket_number');
      if (off || tErr || !data?.length) return;
      const tickets = data.map((t: any) => ({ ...t, questions: [...(t.questions || [])].sort((a: any, b: any) => a.order_index - b.order_index) }));
      await handleBatchChanged(row.generation_params, tickets);
    })().catch(() => { /* нет связи — остаётся сохранённая копия */ });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Кнопка генерации: что мешает нажать и что на ней написать
  const blockReason = pickEmpty
    ? 'Отметьте главы'
    : poolStats && fitted.error
    ? 'Нет вопросов'
    : dayExhausted
    ? 'Лимит на сегодня исчерпан'
    : cooldownLeft > 0
    ? `Можно через ${formatWait(cooldownLeft)}`
    : nctMode && isOwner && diffSum !== 100
    ? 'Доли сложности: сумма не 100 %'
    : null;
  const healthDot = !health ? 'bg-slate-300' : health.status === 'green' ? 'bg-emerald-500' : health.status === 'amber' ? 'bg-amber-500' : 'bg-rose-500';

  const variantChoices = isStaff
    ? [1, 2, 4, 10, 20, 50].filter((n) => n <= limits.tickets)
    : Array.from({ length: Math.min(limits.tickets, 6) }, (_, i) => i + 1);

  const selectedChaptersCount = chapters.filter((ch) => {
    const chTopics = allTopics.filter((t) => t.chapter_id === ch.id);
    return chTopics.some((t) => selectedTopicIds.includes(t.id)) || (chTopics.length === 0 && selectedChapterIds.includes(ch.id));
  }).length;

  return (
    <div className="space-y-4 sm:space-y-5 max-w-5xl xl:max-w-none mx-auto">
      {/* Заголовок */}
      <PageHeader
        title="Генератор билетов"
        description="Выберите предмет и нажмите «Генерировать» — получите Word с билетами и ключами."
      />

      {/* Результат генерации — первым, чтобы сразу было видно, что всё готово */}
      {generatedBatch && (
        <GeneratedBatchPanel
          resultRef={resultRef} generatedBatch={generatedBatch} setGeneratedBatch={setGeneratedBatch} generatedSubjectName={generatedSubjectName}
          generatedHasKey={generatedHasKey} handleBatchChanged={handleBatchChanged} selectionOf={selectionOf} exportLang={exportLang}
          isDownloading={isDownloading} handleDownload={handleDownload} canShare={canShare} isSharing={isSharing}
          handleShareTickets={handleShareTickets} handleExportKey={handleExportKey} showVariants={showVariants} setShowVariants={setShowVariants}
          exportSingleWithKey={exportSingleWithKey}
        />
      )}

      {/* Первый вход: как получить билеты за 3 шага */}
      {showIntro && <IntroCard dismissIntro={dismissIntro} />}


      <div className="grid grid-cols-1 md:grid-cols-5 xl:grid-cols-12 gap-4 sm:gap-5 items-start">
        <ScopeColumn
          subjects={subjects} subjectId={subjectId} applyPresetForSubject={applyPresetForSubject} scopeMode={scopeMode} setScopeMode={setScopeMode}
          chapters={chapters} allTopics={allTopics} pickEmpty={pickEmpty} selectedChaptersCount={selectedChaptersCount}
          selectedTopicIds={selectedTopicIds} setSelectedTopicIds={setSelectedTopicIds} selectedChapterIds={selectedChapterIds}
          setSelectedChapterIds={setSelectedChapterIds} expandedChapterIds={expandedChapterIds} handleSelectChapterTopics={handleSelectChapterTopics}
          handleDeselectChapterTopics={handleDeselectChapterTopics} handleToggleTopic={handleToggleTopic}
          toggleChapterExpanded={toggleChapterExpanded}
        />

        <CompositionColumn
          subjectName={subjectName} isStaff={isStaff} isOwner={isOwner}
          composition={{
            editComposition, setEditComposition, testCount, setTestCount, matchingCount, setMatchingCount, openCount, setOpenCount,
            readingCount, setReadingCount, clozeCount, setClozeCount, showTexts, standard, isStandard,
          }}
          nct={{ isChem, nctCfg, nctPref, setNctPref, nctMode, diffShares, setDiffShare, diffSum, permAvailable, permPref, setPermPref }}
          variants={{ variantChoices, ticketCount, setTicketCount }}
          quota={{ limits, userLimits, leftToday }}
          pool={{ poolStats, pickEmpty, health, healthDot, fitted, fittedTotal, scopeMode, setScopeMode }}
          extra={{ showExtra, setShowExtra, customTitle, setCustomTitle, autoTitle, shuffleOptions, setShuffleOptions, shuffleMatching, setShuffleMatching }}
          run={{ handleGenerate, isGenerating, genProgress, blockReason, generatedBatch }}
        />
      </div>
    </div>
  );
};
