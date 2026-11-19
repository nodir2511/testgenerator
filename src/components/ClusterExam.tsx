import React, { useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { saveClusterBatch, loadUsedQuestionIds } from '../lib/clusterStore';
import { saveAs } from 'file-saver';
import { supabase } from '../lib/supabase';
import { Subject } from '../types/database';
import { describeError, notifyError, notifyInfo } from '../lib/errors';
import { keyKindOf } from '../lib/answerKey';
import { buildClusterZip, type ClusterSettings, type ClusterVariant } from '../lib/clusterExport';
import {
  CLUSTER_SUBJECTS, CLUSTER_KINDS, CLUSTER_MIN_SUBJECTS, CLUSTER_MAX_SUBJECTS, LEGACY_KINDS, type ClusterKind, type ClusterCounts,
} from '../lib/clusterSlots';
import {
  fitSettings, pickParallel, separateLinked, chapterTotalsFromCounts, totalsOf, poolStats as calcPoolStats, toSnapshot, preferUnused,
} from '../../supabase/functions/_shared/ticketing';
import { loadLightPool, hydrateTickets } from '../../supabase/functions/_shared/pool';
import { Layers, Loader2, Download, ChevronDown, ChevronRight, CheckCircle2, ArrowUp, ArrowDown, X, Plus } from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import { Button, Card, Field, Hint, PageHeader } from './ui';
import { ClusterFromTickets } from './ClusterFromTickets';

// Экзамен-кластер: книжка из 2–4 предметов по образцу; предметы и их порядок выбирает пользователь (только главный админ).
// Параметры экзамена (код кластера, название, дата) вносятся заранее и запоминаются в браузере.

const KEY = 'examiner_cluster_v1';
const MAX_VARIANTS = 20;

type Counts = ClusterCounts;
type ByKind<T> = Partial<Record<ClusterKind, T>>;
interface Saved {
  settings: ClusterSettings;
  /** Дата экзамена в виде ГГГГ-ММ-ДД (выбор в календаре); на обложке печатается как ДД.ММ */
  dateIso?: string;
  variants: number;
  /** Предметы книжки в порядке следования (от 2 до 4) */
  picks: ClusterKind[];
  /** Предмет базы, количества заданий и выбор глав и тем — отдельно для каждого предмета книжки, чтобы при смене порядка они не терялись */
  subjectByKind: ByKind<string>;
  countsByKind: ByKind<Counts>;
  /** Выбранные темы и главы без тем; пусто — весь предмет */
  topicsByKind: ByKind<string[]>;
  chaptersByKind: ByKind<string[]>;
  /** Не брать вопросы, уже вошедшие в сохранённые экзамены-кластеры (если неповторяющихся хватает) */
  avoidRepeats?: boolean;
}

/** Предметы, которых нельзя выбрать для книжки: в них задания с текстами (подбор книжки берёт вопросы по одному) */
const NO_BLOCKS_KINDS: ClusterKind[] = ['eng'];

/** Какому предмету книжки соответствует предмет базы (по названию) */
export function clusterKindOf(subjectName: string): ClusterKind | null {
  // Английский раньше остальных: «Забони англисӣ» иначе приняли бы за таджикский
  if (/англ|инглис|english/i.test(subjectName || '')) return 'eng';
  return keyKindOf(subjectName);
}

// 2026-09-27 → «27.09»
export const coverDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');

const todayIso = () => new Date().toISOString().slice(0, 10);

const defaults = (): Saved => {
  const iso = todayIso();
  return {
    settings: { code: 'А.5', exam: 'Авг', date: coverDate(iso) },
    dateIso: iso,
    variants: 4,
    picks: [...LEGACY_KINDS],
    subjectByKind: {}, countsByKind: {}, topicsByKind: {}, chaptersByKind: {},
    avoidRepeats: true,
  };
};

// Сохранённые параметры (в браузере и в базе) приводятся к текущему виду; прежний формат — четыре предмета по местам
function normalize(raw: any): Saved | null {
  if (!raw || !raw.settings) return null;
  const base = defaults();
  const merged: Saved = { ...base, settings: { ...base.settings, ...raw.settings }, dateIso: raw.dateIso ?? base.dateIso, variants: raw.variants ?? base.variants, avoidRepeats: raw.avoidRepeats ?? base.avoidRepeats };
  if (Array.isArray(raw.picks)) {
    const picks = (raw.picks as ClusterKind[]).filter((k, i, a) => CLUSTER_SUBJECTS[k] && a.indexOf(k) === i).slice(0, CLUSTER_MAX_SUBJECTS);
    merged.picks = picks.length >= CLUSTER_MIN_SUBJECTS ? picks : base.picks;
    merged.subjectByKind = raw.subjectByKind ?? {};
    merged.countsByKind = raw.countsByKind ?? {};
    merged.topicsByKind = raw.topicsByKind ?? {};
    merged.chaptersByKind = raw.chaptersByKind ?? {};
  } else if (Array.isArray(raw.subjectIds) && Array.isArray(raw.counts)) {
    const on = LEGACY_KINDS.filter((_, i) => raw.enabled?.[i] !== false);
    merged.picks = on.length >= CLUSTER_MIN_SUBJECTS ? on : base.picks;
    LEGACY_KINDS.forEach((k, i) => {
      if (raw.subjectIds[i]) merged.subjectByKind[k] = raw.subjectIds[i];
      if (raw.counts[i]) merged.countsByKind[k] = raw.counts[i];
      if (raw.topicIds?.[i]) merged.topicsByKind[k] = raw.topicIds[i];
      if (raw.chapterIds?.[i]) merged.chaptersByKind[k] = raw.chapterIds[i];
    });
  } else return null;
  if (!merged.settings.date && merged.dateIso) merged.settings.date = coverDate(merged.dateIso);
  return merged;
}

function load(): Saved {
  try {
    const n = normalize(JSON.parse(localStorage.getItem(KEY) || 'null'));
    if (n) return n;
  } catch { /* ignore */ }
  return defaults();
}

const PREFS_KEY = 'cluster_v1';

// Счётчики вопросов предмета (по главам и видам) одним запросом — для охвата глав, как в генераторе билетов
type CountRow = { chapter_id: string | null; type: string; cnt: number };
const fetchQuestionCounts = async (subjectId: string): Promise<CountRow[]> => {
  const { data, error } = await supabase.rpc('question_counts', { p_subject_id: subjectId });
  if (error) throw error;
  return (data || []) as CountRow[];
};

// Лёгкий пул (только поля для подбора) по выбранным темам и главам без тем; ничего не выбрано — весь предмет.
// Фильтр работает в базе, а не в браузере
async function loadSlotPool(subjectId: string, topicIds: string[], chapterIds: string[]): Promise<any[]> {
  if (!topicIds.length && !chapterIds.length) return loadLightPool(supabase, { subjectId, topicIds: [], chapterIds: [] });
  const parts = await Promise.all([
    topicIds.length ? loadLightPool(supabase, { subjectId, topicIds, chapterIds: [] }) : Promise.resolve([]),
    chapterIds.length ? loadLightPool(supabase, { subjectId, topicIds: [], chapterIds }) : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  return parts.flat().filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)));
}

const slotPoolKey = (subjectId: string, topicIds: string[], chapterIds: string[]) =>
  ['cluster_pool', subjectId, [...topicIds].sort().join(','), [...chapterIds].sort().join(',')];

async function pickForSlot(
  qc: QueryClient, subjectId: string, topicIds: string[], chapterIds: string[], want: Counts, V: number, usedP: Promise<Set<string>>,
) {
  // Пул и счётчики берутся из кэша страницы, если их уже загрузила предзагрузка (не старше минуты)
  const [cached, countRows, used] = await Promise.all([
    qc.fetchQuery({ queryKey: slotPoolKey(subjectId, topicIds, chapterIds), queryFn: () => loadSlotPool(subjectId, topicIds, chapterIds), staleTime: 60_000 }),
    qc.fetchQuery({ queryKey: ['question_counts', subjectId], queryFn: () => fetchQuestionCounts(subjectId), staleTime: 60_000 }),
    usedP,
  ]);
  const selected = cached.map((q) => ({ ...q })); // кэш не меняем

  const fit = fitSettings(calcPoolStats(selected), {
    testCount: want.test, matchingCount: want.matching, openCount: want.open,
    ticketCount: V, shuffleOptions: true, shuffleMatching: true, title: '',
  });
  if (fit.error) throw new Error(fit.error);

  // Охват глав — по всем вопросам выбранных глав (как в генераторе билетов)
  const totals = chapterTotalsFromCounts(countRows, [...new Set(selected.map((q) => q.chapter_id).filter(Boolean))]);
  // Вопросы из прошлых экзаменов — только если новых не хватает; сколько таких повторов вошло, считаем отдельно
  let repeats = 0;
  const pick = (type: 'test' | 'matching' | 'open', n: number) => {
    const { pool } = preferUnused(selected.filter((q) => q.type === type), used, n * V);
    return pickParallel(pool, n, V, Math.random, totalsOf(totals, type));
  };
  const tests = pick('test', fit.settings.testCount);
  const matchings = pick('matching', fit.settings.matchingCount);
  const opens = pick('open', fit.settings.openCount);
  separateLinked([tests, matchings, opens], selected);

  const ids = new Set<string>();
  for (let k = 0; k < V; k++) [...tests[k], ...matchings[k], ...opens[k]].forEach((q) => ids.add(q.id));
  ids.forEach((id) => { if (used.has(id)) repeats++; });

  // Полные данные (варианты ответов, пары, названия глав и тем) — только для выбранных вопросов
  await hydrateTickets(supabase, [tests, matchings, opens]);
  const perVariant = Array.from({ length: V }, (_, k) =>
    [...tests[k], ...matchings[k], ...opens[k]].map((q) => toSnapshot(q, { shuffleOptions: true, shuffleMatching: true })));
  return { perVariant, notes: fit.notes, repeats, picked: ids.size };
}

// Выбор тем предмета: главы со списком тем; пусто — берётся весь предмет
const TopicPicker: React.FC<{
  subjectId: string; chapterIds: string[]; topicIds: string[]; disabled?: boolean;
  onChange: (chapterIds: string[], topicIds: string[]) => void;
}> = ({ subjectId, chapterIds, topicIds, disabled, onChange }) => {
  const [open, setOpen] = useState(false);
  const { data: chapters = [] } = useQuery({
    queryKey: ['chapters', subjectId],
    enabled: Boolean(subjectId) && open,
    queryFn: async () => {
      const { data } = await supabase.from('chapters').select('*').eq('subject_id', subjectId).eq('is_deleted', false).order('order_index');
      return (data || []) as any[];
    },
  });
  const { data: topics = [] } = useQuery({
    queryKey: ['cluster_topics', subjectId, chapters.length],
    enabled: Boolean(subjectId) && open && chapters.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('topics').select('*').in('chapter_id', chapters.map((c: any) => c.id)).eq('is_deleted', false).order('order_index');
      return (data || []) as any[];
    },
  });

  const picked = topicIds.length + chapterIds.length;
  const toggleTopic = (id: string, on: boolean) => onChange(chapterIds, on ? [...new Set([...topicIds, id])] : topicIds.filter((x) => x !== id));
  const toggleChapter = (ch: any, on: boolean) => {
    const own = topics.filter((t: any) => t.chapter_id === ch.id).map((t: any) => t.id);
    if (own.length === 0) return onChange(on ? [...new Set([...chapterIds, ch.id])] : chapterIds.filter((x) => x !== ch.id), topicIds);
    onChange(chapterIds, on ? [...new Set([...topicIds, ...own])] : topicIds.filter((x) => !own.includes(x)));
  };

  return (
    <div className="md:col-span-2">
      <button type="button" disabled={disabled || !subjectId} onClick={() => setOpen((o) => !o)}
        className="flex items-center space-x-1 text-sm font-semibold text-indigo-700 disabled:text-slate-400 min-h-[40px]">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span>Темы: {picked === 0 ? 'весь предмет' : `выбрано ${picked}`}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <button type="button" className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium min-h-[40px]"
              onClick={() => onChange(chapters.filter((c: any) => !topics.some((t: any) => t.chapter_id === c.id)).map((c: any) => c.id), topics.map((t: any) => t.id))}>Выбрать все</button>
            <button type="button" className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium min-h-[40px]" onClick={() => onChange([], [])}>Снять всё (= весь предмет)</button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {chapters.map((ch: any) => {
              const own = topics.filter((t: any) => t.chapter_id === ch.id);
              const checked = own.length === 0 ? chapterIds.includes(ch.id) : own.every((t: any) => topicIds.includes(t.id));
              return (
                <div key={ch.id} className="bg-white border border-slate-200 rounded-lg p-2">
                  <label className="flex items-start space-x-2 text-xs font-bold text-slate-800 cursor-pointer">
                    <input type="checkbox" className="mt-0.5 w-4 h-4 rounded text-indigo-600" checked={checked} onChange={(e) => toggleChapter(ch, e.target.checked)} />
                    <span className="break-words">{ch.name}</span>
                  </label>
                  {own.map((t: any, i: number) => (
                    <label key={t.id} className="flex items-start space-x-2 text-xs text-slate-700 cursor-pointer pl-6 pt-1">
                      <input type="checkbox" className="mt-0.5 w-3.5 h-3.5 rounded text-indigo-600" checked={topicIds.includes(t.id)} onChange={(e) => toggleTopic(t.id, e.target.checked)} />
                      <span className="leading-snug">{i + 1}. {t.name}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export const ClusterExam: React.FC = () => {
  const [state, setState] = useState<Saved>(load);
  const { user } = useAuth();
  const prefsReady = React.useRef(false);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; fileName: string; saved: boolean } | null>(null);
  const busyRef = React.useRef(false);
  // «bank» — подбор вопросов из банка, «tickets» — книжка из готовых билетов (архив или файлы Word)
  const [mode, setMode] = useState<'bank' | 'tickets'>(() => {
    try { return localStorage.getItem('examiner_cluster_mode') === 'tickets' ? 'tickets' : 'bank'; } catch { return 'bank'; }
  });
  const chooseMode = (m: 'bank' | 'tickets') => {
    setMode(m);
    try { localStorage.setItem('examiner_cluster_mode', m); } catch { /* ignore */ }
  };

  React.useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  // Параметры экзамена хранятся в базе (таблица user_prefs) — одинаковы на всех устройствах; браузер — запасной кэш
  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase.from('user_prefs').select('value').eq('user_id', user.id).eq('key', PREFS_KEY).maybeSingle().then(({ data, error }) => {
      if (cancelled || error) return;
      const merged = normalize(data?.value);
      if (merged) setState(merged);
      prefsReady.current = true;
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  React.useEffect(() => {
    if (!user || !prefsReady.current) return;
    const timer = setTimeout(() => {
      supabase.from('user_prefs').upsert({ user_id: user.id, key: PREFS_KEY, value: state, updated_at: new Date().toISOString() })
        .then(({ error }) => { if (error) console.warn('Не удалось сохранить параметры кластера', error); });
    }, 800);
    return () => clearTimeout(timer);
  }, [state, user?.id]);

  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Subject[];
    },
  });

  // Предмет базы подбирается по названию, пока не выбран вручную
  React.useEffect(() => {
    if (subjects.length === 0) return;
    setState((st) => {
      let changed = false;
      const subjectByKind = { ...st.subjectByKind };
      for (const kind of CLUSTER_KINDS) {
        const id = subjectByKind[kind];
        if (id && subjects.some((s) => s.id === id)) continue;
        const found = subjects.find((s) => clusterKindOf(s.name) === kind);
        if (found) { subjectByKind[kind] = found.id; changed = true; }
        else if (id) { delete subjectByKind[kind]; changed = true; }
      }
      return changed ? { ...st, subjectByKind } : st;
    });
  }, [subjects]);

  // Предзагрузка: пока настраиваются параметры, вопросы и счётчики выбранных предметов уже качаются
  // (как только выбор не меняется полсекунды). При создании экзамена они берутся из кэша
  React.useEffect(() => {
    const timer = setTimeout(() => {
      state.picks.forEach((kind) => {
        const id = state.subjectByKind[kind];
        if (!id) return;
        const t = state.topicsByKind[kind] ?? [], c = state.chaptersByKind[kind] ?? [];
        queryClient.prefetchQuery({ queryKey: slotPoolKey(id, t, c), queryFn: () => loadSlotPool(id, t, c), staleTime: 60_000 }).catch(() => {});
        queryClient.prefetchQuery({ queryKey: ['question_counts', id], queryFn: () => fetchQuestionCounts(id), staleTime: 60_000 }).catch(() => {});
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [state.picks, state.subjectByKind, state.topicsByKind, state.chaptersByKind, queryClient]);

  const setSetting = (k: keyof ClusterSettings, v: string) => setState((st) => ({ ...st, settings: { ...st.settings, [k]: v } }));
  const countsOf = (st: Saved, kind: ClusterKind): Counts => st.countsByKind[kind] ?? CLUSTER_SUBJECTS[kind].counts;
  const setCount = (kind: ClusterKind, k: keyof Counts, v: number) =>
    setState((st) => ({ ...st, countsByKind: { ...st.countsByKind, [kind]: { ...countsOf(st, kind), [k]: Math.max(0, Math.min(100, v || 0)) } } }));
  const setSubject = (kind: ClusterKind, id: string) => setState((st) => ({
    ...st,
    subjectByKind: { ...st.subjectByKind, [kind]: id },
    topicsByKind: { ...st.topicsByKind, [kind]: [] },
    chaptersByKind: { ...st.chaptersByKind, [kind]: [] },
  }));
  const setSelection = (kind: ClusterKind, chapterIds: string[], topicIds: string[]) => setState((st) => ({
    ...st,
    topicsByKind: { ...st.topicsByKind, [kind]: topicIds },
    chaptersByKind: { ...st.chaptersByKind, [kind]: chapterIds },
  }));
  // Состав и порядок книжки
  const changeKind = (i: number, kind: ClusterKind) => setState((st) => ({ ...st, picks: st.picks.map((k, j) => (j === i ? kind : k)) }));
  const moveKind = (i: number, d: -1 | 1) => setState((st) => {
    const j = i + d;
    if (j < 0 || j >= st.picks.length) return st;
    const picks = [...st.picks];
    [picks[i], picks[j]] = [picks[j], picks[i]];
    return { ...st, picks };
  });
  const removeKind = (i: number) => setState((st) => (st.picks.length <= CLUSTER_MIN_SUBJECTS ? st : { ...st, picks: st.picks.filter((_, j) => j !== i) }));
  const addKind = () => setState((st) => {
    const free = CLUSTER_KINDS.find((k) => !st.picks.includes(k) && !NO_BLOCKS_KINDS.includes(k));
    return free && st.picks.length < CLUSTER_MAX_SUBJECTS ? { ...st, picks: [...st.picks, free] } : st;
  });

  const total = (c: Counts) => c.test + c.matching + c.open;

  const handleGenerate = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const { settings, variants: V, picks } = state;
      const subjectIds = picks.map((k) => state.subjectByKind[k] ?? '');
      if (picks.some((k) => NO_BLOCKS_KINDS.includes(k))) throw new Error('Английский язык пока нельзя добавить в книжку: в нём задания с текстами, а книжка собирает вопросы по одному. Уберите его из списка.');
      if (picks.length < CLUSTER_MIN_SUBJECTS || picks.length > CLUSTER_MAX_SUBJECTS) throw new Error(`В книжке должно быть от ${CLUSTER_MIN_SUBJECTS} до ${CLUSTER_MAX_SUBJECTS} предметов`);
      if (!settings.code.trim()) throw new Error('Укажите код кластера (например, А.5)');
      if (!settings.exam.trim()) throw new Error('Укажите название экзамена (например, Авг)');
      if (!settings.date.trim()) throw new Error('Выберите дату экзамена в календаре');
      if (V < 1 || V > MAX_VARIANTS) throw new Error(`Вариантов может быть от 1 до ${MAX_VARIANTS}`);
      const missingSlot = picks.find((_, i) => !subjectIds[i]);
      if (missingSlot) throw new Error(`Выберите предмет из базы для субтеста «${CLUSTER_SUBJECTS[missingSlot].name}» или уберите его из книжки`);

      const variants: ClusterVariant[] = Array.from({ length: V }, (_, k) => ({ number: k + 1, kinds: [...picks], subjects: [] }));
      const notes: string[] = [];
      const repeatNotes: string[] = [];

      // Предметы подбираются параллельно: сначала лёгкий список вопросов, полные данные — только для выбранных
      setProgress('Подбор вопросов…');
      // Прошлые экзамены читаются одновременно с вопросами предметов, а не перед ними
      const usedP: Promise<Set<string>> = state.avoidRepeats === false
        ? Promise.resolve(new Set<string>())
        : loadUsedQuestionIds().catch((e) => {
          notifyError(e, 'Не удалось проверить прошлые экзамены — повторы вопросов не исключены');
          return new Set<string>();
        });
      const perSlot = await Promise.all(picks.map(async (kind, s) => {
        const slot = CLUSTER_SUBJECTS[kind];
        try {
          const r = await pickForSlot(queryClient, subjectIds[s], state.topicsByKind[kind] ?? [], state.chaptersByKind[kind] ?? [], countsOf(state, kind), V, usedP);
          r.notes.forEach((n) => notes.push(`${slot.name} — ${n}`));
          if (r.repeats > 0) repeatNotes.push(`${slot.name}: ${r.repeats} из ${r.picked}`);
          return r.perVariant;
        } catch (slotErr: any) {
          throw new Error(`Субтест «${slot.name}»: ${describeError(slotErr, 'ошибка подбора вопросов')}`);
        }
      }));
      perSlot.forEach((pv) => variants.forEach((v, k) => v.subjects.push(pv ? pv[k] : null)));

      // Сначала сохраняем экзамен в «Сохранённых билетах» (видит только главный админ), потом собираем файл:
      // если сохранить не вышло — ничего не теряется (файл не создаётся), а если не вышла сборка — экзамен
      // уже в архиве и скачивается оттуда.
      setProgress('Сохранение в архив…');
      await saveClusterBatch({ settings, variants, subjectIds });
      queryClient.invalidateQueries({ queryKey: ['saved_ticket_batches'] });
      const saved = true;

      setProgress('Сборка Word-файлов и ключей…');
      let file: Awaited<ReturnType<typeof buildClusterZip>>;
      try {
        file = await buildClusterZip(settings, variants);
      } catch (buildErr) {
        throw new Error(`Экзамен сохранён во вкладке «Сохраненные билеты», но собрать файл не получилось (${describeError(buildErr, 'ошибка сборки')}). Скачайте его оттуда.`);
      }
      setResult({ blob: file.blob, fileName: file.fileName, saved });
      if (repeatNotes.length) notifyInfo(`Новых вопросов не хватило, часть вопросов повторяет прошлые экзамены: ${repeatNotes.join('; ')}`);
      if (notes.length) notifyInfo(`Вопросов не хватило, книжки составлены из того, что есть. ${notes.join('; ')}`);
      if (file.keyUniversal) {
        notifyInfo(`Ключей в универсальной таблице (состав субтестов не поместился в шаблон): ${file.keyUniversal}.`);
      }
      if (file.missingAnswers) {
        notifyError(new Error(`В базе нет верного ответа у вопросов: ${file.missingAnswers} — клетки в ключах отмечены красным.`), 'Кластер готов, но ключи не полные');
      }
    } catch (err: any) {
      setError(describeError(err, 'Не удалось создать кластер'));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress('');
    }
  };

  const input = 'w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const num = 'w-16 text-sm px-2 py-1.5 border border-slate-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="space-y-6">
      <Card padding="none" className="p-5">
        <PageHeader icon={Layers} title="Экзамен-кластер" className="px-0" />
        <p className="text-sm text-slate-600 mt-2">
          Тестовая книжка из 2–4 предметов по образцу (предметы и порядок выбираете вы): обложка, инструкция, субтесты, справочные материалы. Русский и таджикский языки и ключи ответов — одним архивом.
        </p>
        <div className="flex flex-wrap gap-2 mt-4" role="tablist">
          {([['bank', 'Подбор из банка'], ['tickets', 'Из готовых билетов']] as const).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => chooseMode(m)}
              className={`px-4 min-h-[40px] rounded-xl text-sm font-semibold border ${mode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">
          {mode === 'bank'
            ? 'Сайт сам подбирает вопросы по темам и сохраняет экзамен в «Архиве билетов».'
            : 'Вы даёте по одному билету на предмет — из «Архива билетов» или файлами Word (подходят и сборники не из системы), — сайт собирает из них книжку на русском и таджикском, без ключей. Можно взять только химию и биологию.'}
        </p>
      </Card>

      <Card padding="none" className="p-5 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">1. Параметры экзамена</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Field label={<span className="inline-flex items-center gap-1">Код кластера <Hint label="Что такое код кластера">Короткий шифр экзаменационной книжки, например «А.5». Он печатается на обложке («Компонент А.5-Авг») и в колонтитулах вариантов.</Hint></span>}>
            <input className={input} value={state.settings.code} onChange={(e) => setSetting('code', e.target.value)} placeholder="А.5" />
          </Field>
          <Field label="Название экзамена">
            <input className={input} value={state.settings.exam} onChange={(e) => setSetting('exam', e.target.value)} placeholder="Авг" />
          </Field>
          <Field label="Дата экзамена" hint={<>На обложке: <strong className="text-slate-700">{state.settings.date || '—'}</strong></>}>
            <input
              type="date" className={input} value={state.dateIso ?? ''}
              onChange={(e) => {
                const iso = e.target.value;
                const formatted = coverDate(iso);
                setState((st) => ({ ...st, dateIso: iso, settings: { ...st.settings, date: formatted || st.settings.date } }));
              }}
            />
          </Field>
          {mode === 'bank' && <Field label={`Вариантов (1–${MAX_VARIANTS})`}>
            <input
              type="number" min={1} max={MAX_VARIANTS} className={input} value={state.variants}
              onChange={(e) => setState((st) => ({ ...st, variants: Math.max(1, Math.min(MAX_VARIANTS, Number(e.target.value) || 1)) }))}
            />
          </Field>}
        </div>
        {mode === 'bank' && <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox" className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
            checked={state.avoidRepeats !== false}
            onChange={(e) => setState((st) => ({ ...st, avoidRepeats: e.target.checked }))}
          />
          <span>Не брать вопросы, которые уже были в сохранённых экзаменах-кластерах (если не хватает новых — берутся и старые, с предупреждением)</span>
        </label>}
        <p className="text-xs text-slate-500">
          Пример: «Компонент {state.settings.code || 'А.5'}-{state.settings.exam || 'Авг'}» на обложке и «Компонент {state.settings.code || 'А.5'}-1» в колонтитулах первого варианта.
        </p>
      </Card>

      {mode === 'tickets' && (
        <ClusterFromTickets settings={state.settings} subjects={subjects} subjectIds={LEGACY_KINDS.map((k) => state.subjectByKind[k] ?? '')} onSubject={(i, id) => setSubject(LEGACY_KINDS[i], id)} />
      )}

      {mode === 'bank' && <>
      <Card padding="none" className="p-5 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">2. Субтесты</h3>
        <p className="text-xs text-slate-500">
          Выберите от {CLUSTER_MIN_SUBJECTS} до {CLUSTER_MAX_SUBJECTS} предметов и поставьте их в нужном порядке: так они пойдут на обложке, в инструкции и в книжке. Английского языка в списке пока нет: в нём задания с текстами, и книжка с ним появится позже.
        </p>
        <div className="space-y-3">
          {state.picks.map((kind, i) => {
            const slot = CLUSTER_SUBJECTS[kind];
            const subjectId = state.subjectByKind[kind] ?? '';
            const counts = countsOf(state, kind);
            const iconBtn = 'p-2 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white min-h-[40px] min-w-[40px] inline-flex items-center justify-center';
            return (
            <div key={kind} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-700 w-5 shrink-0">{i + 1}.</span>
                  <CustomSelect className={input} value={kind} onChange={(val) => changeKind(i, val as ClusterKind)}>
                    {CLUSTER_KINDS.filter((k) => k === kind || (!state.picks.includes(k) && !NO_BLOCKS_KINDS.includes(k))).map((k) => <option key={k} value={k}>{CLUSTER_SUBJECTS[k].name}</option>)}
                  </CustomSelect>
                  <button type="button" className={iconBtn} disabled={i === 0} onClick={() => moveKind(i, -1)} aria-label={`Поднять «${slot.name}» выше`}><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" className={iconBtn} disabled={i === state.picks.length - 1} onClick={() => moveKind(i, 1)} aria-label={`Опустить «${slot.name}» ниже`}><ArrowDown className="w-4 h-4" /></button>
                  <button type="button" className={iconBtn} disabled={state.picks.length <= CLUSTER_MIN_SUBJECTS} onClick={() => removeKind(i)} aria-label={`Убрать «${slot.name}» из книжки`}><X className="w-4 h-4" /></button>
                </div>
                <CustomSelect
                  className={`${input} ${!subjectId ? 'border-amber-400 bg-amber-50/40 focus:ring-amber-500' : ''}`}
                  value={subjectId}
                  onChange={(val) => setSubject(kind, val)}
                >
                  <option value="">— выберите предмет из базы —</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </CustomSelect>
                {!subjectId && (
                  <p className="text-xs text-amber-700 font-medium">Предмет из базы не выбран. Выберите его из списка или уберите субтест из книжки.</p>
                )}
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                {([['test', 'Тестов'], ['matching', 'Соответствий'], ['open', 'Открытых']] as const).map(([k, label]) => (
                  <Field key={k} label={label}>
                    <input type="number" min={0} className={num} value={counts[k]} onChange={(e) => setCount(kind, k, Number(e.target.value))} />
                  </Field>
                ))}
                <span className="text-xs text-slate-500 pb-2">= {total(counts)}</span>
              </div>
              <TopicPicker
                subjectId={subjectId}
                chapterIds={state.chaptersByKind[kind] ?? []} topicIds={state.topicsByKind[kind] ?? []}
                onChange={(c, t) => setSelection(kind, c, t)}
              />
            </div>
            );
          })}
        </div>
        {state.picks.length < CLUSTER_MAX_SUBJECTS && (
          <Button variant="secondary" type="button" onClick={addKind}>
            <Plus className="w-4 h-4" />
            <span>Добавить предмет</span>
          </Button>
        )}
      </Card>

      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

      <Button variant="primary" className="w-full sm:w-auto disabled:bg-slate-300" type="button" onClick={handleGenerate} disabled={busy}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        <span>{busy ? progress || 'Создание…' : 'Создать кластер'}</span>
      </Button>

      {result && !busy && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 text-sm text-emerald-800">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>Кластер готов: <strong>{result.fileName}</strong> ({(result.blob.size / 1048576).toFixed(1)} МБ){result.saved ? ' · сохранён во вкладке «Сохраненные билеты»' : ''}</span>
          </div>
          <Button variant="primary" type="button" onClick={() => saveAs(result.blob, result.fileName)}>
            <Download className="w-4 h-4" />
            <span>Скачать архив</span>
          </Button>
        </div>
      )}
      </>}
    </div>
  );
};
