import React from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { notifyError, notifyInfo } from '../../lib/errors';
import { examProfileFor } from '../../../supabase/functions/_shared/examProfiles';
import { pickNct, expandPermuted, NCT_DEFAULT_DIFFICULTY, type NctConfig, type NctDifficultyShares } from '../../../supabase/functions/_shared/nct';
import { fitSettings, pickTickets, pickParallel, snapshotTickets, chapterTotalsFromCounts, poolStats as calcPoolStats, checkSettings } from '../../../supabase/functions/_shared/ticketing';
import { loadLightPool, hydrateTickets } from '../../../supabase/functions/_shared/pool';
import type { Subject, Chapter, Topic } from '../../types/database';
import { exportTicketsToDocx, exportSingleTicketDocx, buildTicketsFile } from '../../lib/exportLazy';
import { exportAnswerKey, keyArchiveExtras, withSelectionInfo, describeSelection } from '../../lib/exportLazy';
import { autoBatchTitle } from '../../lib/batchTitle';
import type { Lang } from '../DownloadButton';

type CountRow = { chapter_id: string | null; topic_id: string | null; type: string; cnt: number };

// Счётчики вопросов предмета (по главам, темам и видам) одним запросом к базе
export const fetchQuestionCounts = async (subjectId: string): Promise<CountRow[]> => {
  const { data, error } = await supabase.rpc('question_counts', { p_subject_id: subjectId });
  if (error) throw error;
  return (data || []) as CountRow[];
};

const fetchChapters = async (subjectId: string) => {
  const { data, error } = await supabase.from('chapters').select('*').eq('subject_id', subjectId).eq('is_deleted', false).order('order_index');
  if (error) throw error; // ошибку показываем, а не выдаём за пустой список
  return (data || []) as Chapter[];
};

// Всё, что нужно для одной генерации; title === null — название подставится само
export interface GenCfg {
  subjectId: string;
  chapterIds: string[];
  topicIds: string[];
  test: number;
  matching: number;
  open: number;
  /** сколько текстов для чтения и с пропусками (английский); нет = 0 */
  reading?: number;
  cloze?: number;
  tickets: number;
  shuffleOptions: boolean;
  shuffleMatching: boolean;
  title: string | null;
  /** режим «по формату НЦТ» (химия): 18 + 2 + 7, разделы по номерам */
  nct?: boolean;
  nctPerm?: boolean;
  /** доли сложности тестов и соответствий, % (режим НЦТ); null — выбор сложности выключен, не задано — доли по умолчанию */
  nctDiff?: NctDifficultyShares | null;
}

interface GenerateDeps {
  queryClient: QueryClient;
  /** настройки с экрана — для генерации без параметров */
  currentCfg: () => GenCfg;
  nctCfg: NctConfig;
  limits: { perType: number; tickets: number; total?: number };
  subjectName: string;
  subjects: Subject[];
  chapters: Chapter[];
  allTopics: Topic[];
  chapterNumsOf: (list: Chapter[], ids: string[]) => number[];
  autoTitle: string;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
  setGenProgress: React.Dispatch<React.SetStateAction<{ percent: number; stage: string }>>;
  /** созданный набор с билетами */
  generatedBatch: any | null;
  setGeneratedBatch: React.Dispatch<React.SetStateAction<any | null>>;
  setShowVariants: React.Dispatch<React.SetStateAction<boolean>>;
  setScrollToResult: React.Dispatch<React.SetStateAction<boolean>>;
  generatedSubjectName: string;
  selectionOf: () => { subjectId: any; params: any };
  exportLang: Lang;
  setExportLang: (l: Lang) => void;
  isDownloading: boolean;
  setIsDownloading: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSharing: React.Dispatch<React.SetStateAction<boolean>>;
}

// Создание билетов и их выдача (Word, ключи, «Поделиться»). Состояние экрана остаётся в TicketGenerator и приходит в deps;
// хук вызывается при каждой отрисовке, поэтому обработчики видят те же значения, что и раньше внутри компонента
export function useGenerate(deps: GenerateDeps) {
  const {
    queryClient, currentCfg, nctCfg, limits, subjectName, subjects, chapters, allTopics, chapterNumsOf, autoTitle, setIsGenerating, setGenProgress,
    generatedBatch, setGeneratedBatch, setShowVariants, setScrollToResult, generatedSubjectName, selectionOf, exportLang, setExportLang,
    isDownloading, setIsDownloading, setIsSharing,
  } = deps;
  const generatingRef = React.useRef(false);

  // Алгоритм параллельной генерации билетов
  const handleGenerate = async (cfg: GenCfg = currentCfg()) => {
    if (generatingRef.current) return; // защита от двойного нажатия
    if (cfg.nct && cfg.nctDiff && cfg.nctDiff.easy + cfg.nctDiff.medium + cfg.nctDiff.hard !== 100) { notifyInfo('Доли сложности должны давать в сумме 100 %'); return; }
    generatingRef.current = true;
    setIsGenerating(true);
    setGenProgress({ percent: 15, stage: 'Загрузка вопросов...' });
    const nct = !!cfg.nct;
    const { test: testCount, matching: matchingCount, open: openCount, tickets: ticketCount, shuffleOptions, shuffleMatching } = nct
      ? { ...cfg, test: nctCfg.composition.test, matching: nctCfg.composition.matching, open: nctCfg.composition.open }
      : cfg;
    const subjectId = cfg.subjectId;
    const effTopicIds = cfg.topicIds;
    const effChapterIds = cfg.chapterIds;
    // тексты (английский) — только вне режима НЦТ; без них ключей в настройках нет, подбор как раньше
    const textOpts = !nct && ((cfg.reading ?? 0) + (cfg.cloze ?? 0) > 0) ? { readingCount: cfg.reading ?? 0, clozeCount: cfg.cloze ?? 0 } : {};

    try {
      if (!subjectId) throw new Error('Выберите предмет');
      if (testCount + matchingCount + openCount === 0) throw new Error('Задайте хотя бы один вопрос в билете');
      if (ticketCount < 1) throw new Error('Количество билетов должно быть не менее 1');

      const limitErr = checkSettings({ testCount, matchingCount, openCount, ticketCount, shuffleOptions, shuffleMatching, title: '', ...textOpts }, limits);
      if (limitErr) throw new Error(limitErr);

      // 1. Лёгкий пул (только поля для подбора) и счётчики предмета — одновременно.
      // Счётчики берутся из кэша страницы, если им меньше минуты. Полные вопросы догружаются ниже, только выбранные.
      const [allQuestionsRaw, countRows] = await Promise.all([
        loadLightPool(supabase, { subjectId, chapterIds: effChapterIds, topicIds: effTopicIds }),
        queryClient.fetchQuery({ queryKey: ['question_counts', subjectId], queryFn: () => fetchQuestionCounts(subjectId), staleTime: 60_000 }),
      ]);

      setGenProgress({ percent: 45, stage: 'Подбор вопросов...' });

      // 2. Если вопросов какого-то вида не хватает, берём сколько есть (считаем по реально загруженным вопросам)
      const fit = fitSettings(
        calcPoolStats(allQuestionsRaw),
        { testCount, matchingCount, openCount, ticketCount, shuffleOptions, shuffleMatching, title: '', ...textOpts }
      );
      if (fit.error) throw new Error(fit.error);
      if (fit.notes.length) notifyInfo(`Вопросов не хватает, билеты составлены из того, что есть. ${fit.notes.join('; ')}`);
      const { testCount: useTest, matchingCount: useMatching, openCount: useOpen } = fit.settings;

      // 3. Формирование параллельных билетов (см. pickParallel): позиция в билете берётся
      // из одной темы во всех билетах, соседними вопросами сборника, темы — поровну,
      // без повторов, пока хватает вопросов
      // Охват глав: сколько вопросов главы выбрано от всех её вопросов (неполный выбор уменьшает долю главы)
      const chapterIds = Array.from(new Set(allQuestionsRaw.map(q => q.chapter_id).filter(Boolean)));
      const totals = chapterTotalsFromCounts(countRows, chapterIds);
      let picked = pickTickets(allQuestionsRaw, fit.settings, Math.random, totals);
      if (nct) {
        // сборник НЦТ в банке — источники «ЦВЭ …» и «НЦТ …»: их вопросы идут на ~40 % баллов
        const { data: srcRows } = await supabase.from('sources').select('id, name').eq('is_deleted', false);
        const nctSources = new Set((srcRows || []).filter((r: any) => (examProfileFor(subjectName)?.sourcePattern ?? /ЦВЭ|НЦТ/i).test(r.name || '')).map((r: any) => r.id));
        allQuestionsRaw.forEach((q: any) => { q.isNct = !!q.source_id && nctSources.has(q.source_id); });
        const permuted = !!cfg.nctPerm && ticketCount >= 4 && ticketCount % 2 === 0;
        let np = pickNct(allQuestionsRaw, permuted ? 2 : ticketCount, Math.random, totals, cfg.nctDiff === undefined ? NCT_DEFAULT_DIFFICULTY : cfg.nctDiff, nctCfg);

        // Добор недостающих заданий из обычного пула (наши вопросы, подходящие по типу)
        const targetT = permuted ? 2 : ticketCount;
        const totalPickedInNct = (np.kinds[0][0]?.length ?? 0) + (np.kinds[1][0]?.length ?? 0) + (np.kinds[2][0]?.length ?? 0);
        if (totalPickedInNct === 0) {
          notifyInfo('В выбранных темах недостаточно заданий формата НЦТ — билеты составлены из вопросов банка по типу');
          np.kinds = picked.kinds;
        } else {
          const targets: Array<{ kind: 'test' | 'matching' | 'open'; want: number; idx: number }> = [
            { kind: 'test', want: nctCfg.composition.test, idx: 0 },
            { kind: 'matching', want: nctCfg.composition.matching, idx: 1 },
            { kind: 'open', want: nctCfg.composition.open, idx: 2 },
          ];
          const usedInNct = new Set<string>();
          for (const k of np.kinds) for (const ticket of k) for (const q of ticket) if (q?.id) usedInNct.add(q.id);

          for (const { kind, want, idx } of targets) {
            const current = np.kinds[idx][0]?.length ?? 0;
            if (current < want) {
              const missing = want - current;
              const freeOwn = allQuestionsRaw.filter((q: any) => q.type === kind && !usedInNct.has(q.id) && !q.passage_id);
              const fillPicked = pickParallel(freeOwn, missing, targetT, Math.random);
              if (fillPicked.length === targetT && fillPicked.every(t => t.length === missing)) {
                for (let t = 0; t < targetT; t++) {
                  np.kinds[idx][t].push(...fillPicked[t]);
                  fillPicked[t].forEach(q => usedInNct.add(q.id));
                }
              }
            }
          }
        }

        if (np.notes.length) notifyInfo(`Формат НЦТ: ${np.notes.join('; ')}`);
        if (np.kinds[0][0]?.length + np.kinds[1][0]?.length + np.kinds[2][0]?.length === 0) throw new Error('В выбранных темах нет вопросов для формата НЦТ');
        if (permuted) np = expandPermuted(np, ticketCount, Math.random);
        picked = np;
      }

      setGenProgress({ percent: 60, stage: 'Загрузка выбранных вопросов...' });
      await hydrateTickets(supabase, picked.kinds);

      setGenProgress({ percent: 75, stage: 'Сборка вариантов...' });

      // 4. Сохранение одной транзакцией: партия, билеты и вопросы билетов (см. supabase/sql/save_ticket_batch.sql).
      // При любой ошибке база откатывает всё — недосозданных наборов не остаётся.
      const ticketsPayload = snapshotTickets(picked, { shuffleOptions, shuffleMatching }, Math.random).map(t => ({
        ticket_number: t.ticketNumber,
        questions: t.questions,
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
            test_count: nct ? picked.kinds[0][0]?.length ?? 0 : useTest,
            matching_count: nct ? picked.kinds[1][0]?.length ?? 0 : useMatching,
            open_count: nct ? picked.kinds[2][0]?.length ?? 0 : useOpen,
            ticket_count: ticketCount,
            shuffle_options: shuffleOptions,
            shuffle_matching: shuffleMatching,
            ...(textOpts.readingCount !== undefined ? { reading_count: fit.settings.readingCount ?? 0, cloze_count: fit.settings.clozeCount ?? 0 } : {}),
            requested: { test: testCount, matching: matchingCount, open: openCount },
            auto_title: !cfg.title?.trim(),
            source: 'site',
            ...(nct ? { nct: true, nct_subject: nctCfg.key, nct_difficulty: cfg.nctDiff === undefined ? NCT_DEFAULT_DIFFICULTY : cfg.nctDiff } : {}),
            ...(nct && cfg.nctPerm && ticketCount >= 4 && ticketCount % 2 === 0 ? { nct_perm: true } : {}),
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

      // Главы и темы предмета уже загружены на странице — дополнительных запросов к базе не нужно
      const structureLoaded = batch.subject_id === subjectId && chapters.length > 0 && chapters[0].subject_id === subjectId
        && allTopics.length > 0 && chapters.some((c) => c.id === allTopics[0].chapter_id);
      setGeneratedBatch({
        ...batch,
        tickets: await withSelectionInfo(
          createdTicketsWithQuestions, batch.subject_id, batch.generation_params,
          structureLoaded ? async (_subject, params) => describeSelection(chapters, allTopics, params) : undefined,
        ),
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

  return { handleGenerate, handleDownload, exportSingleWithKey, handleExportKey, handleShareTickets };
}
