import React, { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { assertRowsChanged, notifyError, notifyInfo, withUndo } from '../lib/errors';
import { Subject } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { exportTicketsToDocx, exportSingleTicketDocx, buildTicketsFile } from '../lib/exportLazy';
import { exportAnswerKey, hasKeyTemplate, keyArchiveExtras, makeSelectionInfoLoader, withSelectionInfo } from '../lib/exportLazy';
import { SendToTelegramButton } from './SendToTelegramButton';
import { DownloadButton, useExportLang, type Lang } from './DownloadButton';
import { saveAs } from 'file-saver';
import { isClusterBatch, clusterVariantsFromBatch } from '../lib/clusterStore';
import {
  FileCheck2,
  Download,
  Trash2,
  ChevronDown,
  Loader2,
  Search,
  Sparkles,
  X,
} from 'lucide-react';

const PAGE = 15;

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

// Цветовой акцент карточки по предмету
const subjectAccent = (name?: string) => {
  const n = (name || '').toLowerCase();
  if (n.includes('хим')) return { bar: 'bg-gradient-to-r from-sky-400 to-blue-600', pill: 'bg-blue-50 text-blue-800 border-blue-200' };
  if (n.includes('физ')) return { bar: 'bg-gradient-to-r from-violet-400 to-purple-600', pill: 'bg-violet-50 text-violet-800 border-violet-200' };
  if (n.includes('био')) return { bar: 'bg-gradient-to-r from-emerald-400 to-green-600', pill: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
  return { bar: 'bg-gradient-to-r from-slate-300 to-slate-500', pill: 'bg-slate-50 text-slate-800 border-slate-200' };
};

// Варианты набора с вопросами — грузятся, только когда нужны (раскрыли карточку или скачивают)
const ticketsQueryKey = (batchId: string) => ['batch_tickets', batchId];
async function fetchBatchTickets(batch: any) {
  const { data, error } = await supabase
    .from('tickets')
    .select('id, ticket_number, created_at, questions:ticket_questions(id, order_index, question_snapshot)')
    .eq('batch_id', batch.id)
    .order('ticket_number');
  if (error) throw error;
  const tickets = (data || []).map((t: any) => ({
    ...t,
    questions: [...(t.questions || [])].sort((a: any, b: any) => a.order_index - b.order_index),
  }));
  return isClusterBatch(batch) ? tickets : withSelectionInfo(tickets, batch.subject_id, batch.generation_params);
}

export const SavedTicketsView: React.FC = () => {
  const queryClient = useQueryClient();
  const { isAdmin, isOwner } = useAuth();
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportLang, setExportLang] = useExportLang();
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);

  // Фильтры: предмет и поиск по названию (ищет база, с небольшой задержкой после ввода)
  const [subjectFilter, setSubjectFilter] = useState(() => localStorage.getItem('examiner_archive_subject') || '');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);
  React.useEffect(() => {
    localStorage.setItem('examiner_archive_subject', subjectFilter);
  }, [subjectFilter]);

  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Subject[];
    },
  });

  // Описание охвата глав (чипы «Глава 1 · полностью») — общий кэш структуры предметов
  const loaderRef = React.useRef(makeSelectionInfoLoader());

  // Архив по страницам: только заголовки наборов, без вопросов
  const list = useInfiniteQuery({
    queryKey: ['saved_ticket_batches', subjectFilter, search],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let q = supabase
        .from('ticket_batches')
        .select('id, title, created_at, subject_id, generation_params, subject:subjects(name), creator:profiles!created_by(full_name, email), tickets(count)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + PAGE - 1);
      if (subjectFilter) q = q.eq('subject_id', subjectFilter);
      if (search) q = q.ilike('title', `%${search.replace(/[%_]/g, (c) => `\\${c}`)}%`);
      // Экзамен-кластер виден только главному админу — это уже проверяет база (политика «Просмотр партий билетов»)
      const { data, error, count } = await q;
      if (error) throw error;
      const rows = await Promise.all((data || []).map(async (b: any) => ({
        ...b,
        ticketCount: b.tickets?.[0]?.count ?? b.generation_params?.ticket_count ?? 0,
        chips: isClusterBatch(b) ? [] : (await loaderRef.current(b.subject_id, b.generation_params)).chips || [],
      })));
      return { rows, count: count ?? 0, next: pageParam + PAGE };
    },
    getNextPageParam: (last) => (last.next < last.count ? last.next : undefined),
    meta: { action: 'Не удалось загрузить архив билетов' },
  });
  const batches = (list.data?.pages.flatMap((p) => p.rows) ?? []).filter((b) => !hiddenIds.includes(b.id));
  const total = Math.max(0, (list.data?.pages[0]?.count ?? 0) - hiddenIds.length);
  const filtered = Boolean(subjectFilter || search);

  const deleteBatchMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const { data, error } = await supabase.from('ticket_batches').delete().eq('id', batchId).select('id');
      if (error) throw error;
      assertRowsChanged(data, 'партия билетов');
    },
    meta: { action: 'Не удалось удалить набор билетов' },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recent_batches'] }),
    onError: (_e, id) => setHiddenIds((prev) => prev.filter((x) => x !== id)),
  });

  // Удаление с отменой: набор сразу пропадает из списка, из базы — через 5 секунд
  const removeBatch = (batch: any) => {
    setHiddenIds((prev) => [...prev, batch.id]);
    if (expandedBatchId === batch.id) setExpandedBatchId(null);
    withUndo('Набор удалён', () => deleteBatchMutation.mutate(batch.id), () => setHiddenIds((prev) => prev.filter((x) => x !== batch.id)));
  };

  const ticketsOf = (batch: any) =>
    queryClient.fetchQuery({ queryKey: ticketsQueryKey(batch.id), queryFn: () => fetchBatchTickets(batch), staleTime: Infinity });
  const selectionOf = (batch: any) => ({ subjectId: batch.subject_id, params: batch.generation_params });

  const handleExport = async (batch: any, lang: Lang) => {
    setExportLang(lang);
    setBusyId(`${batch.id}-dl`);
    try {
      const tickets = await ticketsOf(batch);
      const subj = batch.subject?.name || 'Экзамен';
      await exportTicketsToDocx(batch.title, tickets, subj, lang, await keyArchiveExtras(batch.title, tickets, batch.subject?.name || '', selectionOf(batch), lang));
    } catch (err) {
      notifyError(err, 'Не удалось скачать билеты');
    } finally {
      setBusyId(null);
    }
  };

  const handleKey = async (batch: any) => {
    setBusyId(`${batch.id}-key`);
    try {
      const tickets = await ticketsOf(batch);
      const stats = await exportAnswerKey(batch.title, tickets, batch.subject?.name || '', selectionOf(batch));
      if (stats.universal) notifyInfo('Состав вопросов не поместился в шаблон ключей, поэтому ключ собран в универсальной таблице — все ответы на месте.');
      if (stats.missing) notifyError(new Error(`В базе нет верного ответа у вопросов: ${stats.missing} — клетки в ключе отмечены красным.`), 'Ключи готовы, но не полные');
    } catch (err) {
      notifyError(err, 'Не удалось скачать ключи');
    } finally {
      setBusyId(null);
    }
  };

  // Экзамен-кластер: книжки на двух языках и ключи по всем предметам одним архивом
  const handleClusterExport = async (batch: any) => {
    setBusyId(`${batch.id}-dl`);
    try {
      const { buildClusterZip } = await import('../lib/clusterExport');
      const settings = batch.generation_params?.cluster?.settings;
      if (!settings) throw new Error('В партии нет параметров экзамена');
      const file = await buildClusterZip(settings, clusterVariantsFromBatch(await ticketsOf(batch)));
      saveAs(file.blob, file.fileName);
      if (file.keyUniversal) notifyInfo(`Ключей в универсальной таблице (состав не поместился в шаблон): ${file.keyUniversal}.`);
      if (file.missingAnswers) notifyError(new Error(`В базе нет верного ответа у вопросов: ${file.missingAnswers} — клетки в ключах отмечены красным.`), 'Кластер готов, но ключи не полные');
    } catch (err) {
      notifyError(err, 'Ошибка при экспорте кластера');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="px-1">
        <h2 className="text-xl font-bold text-slate-900 leading-tight">Архив билетов</h2>
        <p className="text-sm text-slate-600 mt-1">Все созданные наборы: скачать снова, отправить в Telegram или посмотреть варианты.</p>
      </div>

      {/* Поиск и фильтр по предмету */}
      <div className="space-y-2">
        <label className="relative block">
          <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Поиск по названию"
            className="w-full min-h-[48px] pl-10 pr-10 text-base bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-slate-500"
              aria-label="Очистить поиск"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </label>
        {subjects.length > 1 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap">
            {[{ id: '', name: 'Все предметы' }, ...subjects].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSubjectFilter(s.id)}
                aria-pressed={subjectFilter === s.id}
                className={`shrink-0 min-h-[40px] px-3.5 rounded-xl text-sm font-semibold border transition active:scale-95 ${
                  subjectFilter === s.id ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        {!list.isLoading && total > 0 && (
          <p className="text-sm text-slate-600 px-1">
            {filtered ? 'Найдено' : 'Всего'}: {total} {plural(total, 'набор', 'набора', 'наборов')}
          </p>
        )}
      </div>

      {list.isLoading ? (
        <div className="bento-card p-12 rounded-2xl text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-600">Загружаем архив…</p>
        </div>
      ) : batches.length === 0 ? (
        <div className="bento-card p-8 sm:p-12 rounded-2xl text-center space-y-3">
          <FileCheck2 className="w-10 h-10 text-slate-300 mx-auto" />
          {filtered ? (
            <>
              <h3 className="font-bold text-slate-900 text-base">Ничего не нашлось</h3>
              <p className="text-sm text-slate-600">Попробуйте другое название или другой предмет.</p>
              <button
                onClick={() => { setSearchInput(''); setSubjectFilter(''); }}
                className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800"
              >
                Сбросить фильтры
              </button>
            </>
          ) : (
            <>
              <h3 className="font-bold text-slate-900 text-base">Здесь появятся ваши билеты</h3>
              <p className="text-sm text-slate-600 max-w-sm mx-auto">Каждый созданный набор сохраняется в архиве — его можно скачать снова в любой момент.</p>
              <a
                href="#generator"
                className="inline-flex items-center gap-2 min-h-[48px] px-5 rounded-xl bg-indigo-600 text-white text-base font-bold"
              >
                <Sparkles className="w-5 h-5" /> Создать билеты
              </a>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map((batch: any) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              expanded={expandedBatchId === batch.id}
              onToggle={() => setExpandedBatchId(expandedBatchId === batch.id ? null : batch.id)}
              busyId={busyId}
              exportLang={exportLang}
              showCreator={isOwner}
              canDelete={isAdmin}
              onDownload={(lang) => (isClusterBatch(batch) ? handleClusterExport(batch) : handleExport(batch, lang))}
              onKey={() => handleKey(batch)}
              onDelete={() => removeBatch(batch)}
              loadTickets={() => ticketsOf(batch)}
            />
          ))}
          {list.hasNextPage && (
            <button
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-800 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {list.isFetchingNextPage && <Loader2 className="w-5 h-5 animate-spin" />}
              Показать ещё
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const BatchCard: React.FC<{
  batch: any;
  expanded: boolean;
  onToggle: () => void;
  busyId: string | null;
  exportLang: Lang;
  showCreator: boolean;
  canDelete: boolean;
  onDownload: (lang: Lang) => void;
  onKey: () => void;
  onDelete: () => void;
  loadTickets: () => Promise<any[]>;
}> = ({ batch, expanded, onToggle, busyId, exportLang, showCreator, canDelete, onDownload, onKey, onDelete, loadTickets }) => {
  const cluster = isClusterBatch(batch);
  const p = batch.generation_params || {};
  const perTicket = (p.test_count ?? 0) + (p.matching_count ?? 0) + (p.open_count ?? 0);
  const clusterSubjects: Array<{ name: string; count: number }> = p.cluster?.subjects ?? [];
  const accent = cluster ? { bar: 'bg-gradient-to-r from-amber-400 to-orange-600', pill: 'bg-amber-50 text-amber-900 border-amber-200' } : subjectAccent(batch.subject?.name);
  const subjName = batch.subject?.name || '';
  const wholeSubject = !(p.chapter_ids?.length || p.topic_ids?.length);
  const [showAllChips, setShowAllChips] = useState(false);

  const tickets = useQuery({
    queryKey: ticketsQueryKey(batch.id),
    queryFn: loadTickets,
    enabled: expanded,
    staleTime: Infinity,
    meta: { action: 'Не удалось загрузить варианты' },
  });

  const exportOne = async (t: any, lang: 'ru' | 'tg') => {
    try {
      await exportSingleTicketDocx(batch.title, t, subjName || 'Экзамен', lang, await keyArchiveExtras(batch.title, [t], subjName, { subjectId: batch.subject_id, params: p }, lang));
    } catch (err) {
      notifyError(err, 'Не удалось скачать вариант');
    }
  };

  return (
    <div className="bento-card rounded-2xl">
      <div className={`h-1 rounded-t-2xl ${accent.bar}`} />
      <div className="p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-slate-900 text-base sm:text-lg leading-snug break-words min-w-0">{batch.title}</h3>
          {canDelete && (
            <button
              onClick={onDelete}
              className="w-10 h-10 -mr-2 -mt-1.5 shrink-0 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition"
              aria-label="Удалить набор"
              title="Удалить набор"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-slate-700">
          <span className={`px-2.5 py-0.5 rounded-full font-semibold border text-sm ${accent.pill}`}>{cluster ? 'Экзамен-кластер' : subjName || 'Без предмета'}</span>
          <span>{new Date(batch.created_at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span><b>{batch.ticketCount}</b> {plural(batch.ticketCount, 'вариант', 'варианта', 'вариантов')}{!cluster && perTicket > 0 ? ` × ${perTicket} вопр.` : ''}</span>
          {showCreator && (
            <span className="w-full text-slate-600" title={batch.creator?.email || ''}>
              Автор: <b className="text-slate-800">{batch.creator ? batch.creator.full_name || batch.creator.email : 'неизвестно'}</b>
            </span>
          )}
        </div>

        {cluster && clusterSubjects.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {clusterSubjects.map((s) => (
              <span key={s.name} className="text-sm px-2 py-0.5 rounded-full border bg-slate-50 text-slate-800 border-slate-200">{s.name} · {s.count}</span>
            ))}
          </div>
        )}

        {!cluster && wholeSubject && (
          <span className="inline-block rounded-lg border px-2 py-1 text-sm bg-emerald-50 border-emerald-200 text-emerald-900">Весь предмет</span>
        )}
        {!cluster && !wholeSubject && batch.chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(showAllChips ? batch.chips : batch.chips.slice(0, 3)).map((c: any) => (
              <span
                key={c.chapter}
                className={`rounded-lg border px-2 py-1 text-sm ${c.full ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}
                title={c.full ? 'Глава взята полностью' : `Выбрано тем: ${c.picked} из ${c.total}`}
              >
                <b>Гл. {c.chapter}</b> · {c.full ? 'полностью' : `${plural(c.picked, 'тема', 'темы', 'тем')} ${c.topics}`}
              </span>
            ))}
            {!showAllChips && batch.chips.length > 3 && (
              <button onClick={() => setShowAllChips(true)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold text-slate-700 bg-white">
                ещё {batch.chips.length - 3}
              </button>
            )}
          </div>
        )}

        {/* Главное действие — одна кнопка; остальное — второстепенные кнопки с рамкой */}
        {cluster ? (
          <button
            onClick={() => onDownload(exportLang)}
            disabled={busyId === `${batch.id}-dl`}
            className="w-full sm:w-auto min-h-[44px] px-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busyId === `${batch.id}-dl` ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            Скачать кластер (ZIP)
          </button>
        ) : (
          <div className="sm:max-w-sm">
            <DownloadButton size="md" lang={exportLang} busy={busyId === `${batch.id}-dl`} onDownload={onDownload} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!cluster && (
            <SendToTelegramButton
              title={batch.title}
              batchId={batch.id}
              ticketCount={batch.ticketCount}
              build={async (lang) => {
                const ts = await loadTickets();
                return buildTicketsFile(batch.title, ts, subjName || 'Экзамен', lang, await keyArchiveExtras(batch.title, ts, subjName, { subjectId: batch.subject_id, params: p }, lang));
              }}
            />
          )}
          {!cluster && hasKeyTemplate(subjName) && (
            <button
              onClick={onKey}
              disabled={busyId === `${batch.id}-key`}
              className="min-h-[40px] px-3.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60"
            >
              {busyId === `${batch.id}-key` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Только ключи
            </button>
          )}
        </div>

        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="w-full min-h-[44px] -mb-2 border-t border-slate-100 flex items-center justify-between text-sm font-semibold text-slate-800"
        >
          Посмотреть варианты
          <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 p-3 sm:p-5 bg-slate-50/60 rounded-b-2xl">
          {tickets.isLoading ? (
            <div className="py-6 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(tickets.data || []).map((t: any) => (
                <div key={t.id} className="p-3 bg-white rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm text-slate-900">Вариант {t.ticket_number} <span className="font-normal text-slate-600">· {t.questions?.length} вопр.</span></span>
                    {!cluster && (
                      <div className="flex items-center gap-1.5">
                        {(exportLang === 'both' ? (['ru', 'tg'] as const) : [exportLang]).map((l) => (
                          <button
                            key={l}
                            onClick={() => exportOne(t, l)}
                            className="min-h-[36px] px-2.5 text-sm bg-white hover:bg-indigo-50 text-indigo-700 font-semibold rounded-lg border border-indigo-200 flex items-center gap-1"
                          >
                            <Download className="w-4 h-4" />
                            {l === 'tg' ? 'TJ' : 'RU'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 text-sm text-slate-700 max-h-48 overflow-y-auto pr-1">
                    {t.questions?.map((tq: any, i: number) => (
                      <div key={i} className="truncate px-2 py-1 bg-slate-50 rounded">
                        <span className="font-bold text-slate-500 mr-1">{i + 1}.</span>
                        {tq.question_snapshot?.content?.replace(/<.*?>/g, '')}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
