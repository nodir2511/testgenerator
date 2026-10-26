import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { saveClusterBatch, loadUsedQuestionIds } from '../lib/clusterStore';
import { saveAs } from 'file-saver';
import { supabase } from '../lib/supabase';
import { Subject } from '../types/database';
import { describeError, notifyError, notifyInfo } from '../lib/errors';
import { keyKindOf } from '../lib/answerKey';
import { CLUSTER_SLOTS, buildClusterZip, type ClusterSettings, type ClusterVariant } from '../lib/clusterExport';
import {
  fitSettings, pickParallel, separateLinked, chapterTotals, totalsOf, poolStats as calcPoolStats, toSnapshot, preferUnused,
} from '../../supabase/functions/_shared/ticketing';
import { Layers, Loader2, Download, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';

// Экзамен-кластер: книжка сразу из 4 предметов по образцу (только главный админ).
// Параметры экзамена (код кластера, название, дата) вносятся заранее и запоминаются в браузере.

const KEY = 'examiner_cluster_v1';
const MAX_VARIANTS = 20;

type Counts = { test: number; matching: number; open: number };
interface Saved {
  settings: ClusterSettings;
  /** Дата экзамена в виде ГГГГ-ММ-ДД (выбор в календаре); на обложке печатается как ДД.ММ */
  dateIso?: string;
  variants: number;
  subjectIds: string[];
  counts: Counts[];
  enabled: boolean[];
  /** Выбранные темы и главы без тем по каждому предмету; пусто — весь предмет */
  topicIds: string[][];
  chapterIds: string[][];
  /** Не брать вопросы, уже вошедшие в сохранённые экзамены-кластеры (если неповторяющихся хватает) */
  avoidRepeats?: boolean;
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
    subjectIds: CLUSTER_SLOTS.map(() => ''),
    counts: CLUSTER_SLOTS.map((s) => ({ ...s.counts })),
    enabled: CLUSTER_SLOTS.map(() => true),
    topicIds: CLUSTER_SLOTS.map(() => []),
    chapterIds: CLUSTER_SLOTS.map(() => []),
    avoidRepeats: true,
  };
};

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && raw.settings && Array.isArray(raw.subjectIds) && Array.isArray(raw.counts)) {
      const merged: Saved = { ...defaults(), ...raw };
      if (!merged.settings.date && merged.dateIso) {
        merged.settings.date = coverDate(merged.dateIso);
      }
      return merged;
    }
  } catch { /* ignore */ }
  return defaults();
}

const PREFS_KEY = 'cluster_v1';

const LIGHT_COLUMNS = 'id, type, chapter_id, topic_id, num, seq, created_at, linked_ids';

// Все вопросы предмета без вариантов ответа (быстро), страницы по 1000 — параллельно
async function loadLightQuestions(subjectId: string): Promise<any[]> {
  const page = (from: number) =>
    supabase.from('questions').select(LIGHT_COLUMNS, { count: 'exact' }).eq('subject_id', subjectId).eq('is_deleted', false).order('id').range(from, from + 999);
  const first = await page(0);
  if (first.error) throw first.error;
  const total = first.count ?? first.data?.length ?? 0;
  const rest = [] as ReturnType<typeof page>[];
  for (let from = 1000; from < total; from += 1000) rest.push(page(from));
  const pages = await Promise.all(rest);
  const out: any[] = [...(first.data || [])];
  for (const r of pages) {
    if (r.error) throw r.error;
    out.push(...(r.data || []));
  }
  return out;
}

async function pickForSlot(subjectId: string, topicIds: string[], chapterIds: string[], want: Counts, V: number, used: Set<string>) {
  const [rows, chaptersRes] = await Promise.all([
    loadLightQuestions(subjectId),
    supabase.from('chapters').select('id, name, order_index').eq('subject_id', subjectId).eq('is_deleted', false),
  ]);
  if (chaptersRes.error) throw chaptersRes.error;
  const chapters = new Map<string, any>((chaptersRes.data || []).map((c: any) => [c.id, c]));
  const topicsRes = chapters.size
    ? await supabase.from('topics').select('id, name, order_index').in('chapter_id', [...chapters.keys()]).eq('is_deleted', false)
    : { data: [] as any[], error: null };
  if (topicsRes.error) throw topicsRes.error;
  const topics = new Map<string, any>((topicsRes.data || []).map((t: any) => [t.id, t]));

  // Выбор тем: если ничего не выбрано — весь предмет
  const tSet = new Set(topicIds), cSet = new Set(chapterIds);
  const selected = tSet.size === 0 && cSet.size === 0
    ? rows
    : rows.filter((q) => (q.topic_id && tSet.has(q.topic_id)) || cSet.has(q.chapter_id));
  selected.forEach((q) => { q.chapter = chapters.get(q.chapter_id); q.topic = q.topic_id ? topics.get(q.topic_id) : undefined; });

  const fit = fitSettings(calcPoolStats(selected), {
    testCount: want.test, matchingCount: want.matching, openCount: want.open,
    ticketCount: V, shuffleOptions: true, shuffleMatching: true, title: '',
  });
  if (fit.error) throw new Error(fit.error);

  // Охват глав — по всем вопросам выбранных глав (как в генераторе билетов)
  const chosenChapters = new Set(selected.map((q) => q.chapter_id));
  const totals = chapterTotals(rows.filter((q) => chosenChapters.has(q.chapter_id)));
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

  // Полные данные (варианты ответов, пары соответствия) — только для выбранных вопросов
  const ids = new Set<string>();
  for (let k = 0; k < V; k++) [...tests[k], ...matchings[k], ...opens[k]].forEach((q) => ids.add(q.id));
  ids.forEach((id) => { if (used.has(id)) repeats++; });
  const idList = [...ids];
  const batches: string[][] = [];
  for (let i = 0; i < idList.length; i += 80) batches.push(idList.slice(i, i + 80));
  const full = new Map<string, any>();
  const results = await Promise.all(batches.map((b) =>
    supabase.from('questions').select('*, options:question_options(*), matching_items:matching_items(*)').in('id', b)));
  for (const r of results) {
    if (r.error) throw r.error;
    (r.data || []).forEach((q: any) => full.set(q.id, q));
  }
  const perVariant = Array.from({ length: V }, (_, k) =>
    [...tests[k], ...matchings[k], ...opens[k]].map((q) => toSnapshot({ ...full.get(q.id), chapter: q.chapter, topic: q.topic }, { shuffleOptions: true, shuffleMatching: true })));
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
        className="flex items-center space-x-1 text-xs font-semibold text-blue-700 disabled:text-slate-400">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span>Темы: {picked === 0 ? 'весь предмет' : `выбрано ${picked}`}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <button type="button" className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium"
              onClick={() => onChange(chapters.filter((c: any) => !topics.some((t: any) => t.chapter_id === c.id)).map((c: any) => c.id), topics.map((t: any) => t.id))}>Выбрать все</button>
            <button type="button" className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium" onClick={() => onChange([], [])}>Снять всё (= весь предмет)</button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {chapters.map((ch: any) => {
              const own = topics.filter((t: any) => t.chapter_id === ch.id);
              const checked = own.length === 0 ? chapterIds.includes(ch.id) : own.every((t: any) => topicIds.includes(t.id));
              return (
                <div key={ch.id} className="bg-white border border-slate-200 rounded-lg p-2">
                  <label className="flex items-start space-x-2 text-xs font-bold text-slate-800 cursor-pointer">
                    <input type="checkbox" className="mt-0.5 w-4 h-4 rounded text-blue-600" checked={checked} onChange={(e) => toggleChapter(ch, e.target.checked)} />
                    <span className="break-words">{ch.name}</span>
                  </label>
                  {own.map((t: any, i: number) => (
                    <label key={t.id} className="flex items-start space-x-2 text-xs text-slate-700 cursor-pointer pl-6 pt-1">
                      <input type="checkbox" className="mt-0.5 w-3.5 h-3.5 rounded text-blue-600" checked={topicIds.includes(t.id)} onChange={(e) => toggleTopic(t.id, e.target.checked)} />
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

  React.useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  // Параметры экзамена хранятся в базе (таблица user_prefs) — одинаковы на всех устройствах; браузер — запасной кэш
  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase.from('user_prefs').select('value').eq('user_id', user.id).eq('key', PREFS_KEY).maybeSingle().then(({ data, error }) => {
      if (cancelled || error) return;
      const v = data?.value as Saved | undefined;
      if (v && v.settings && Array.isArray(v.subjectIds) && Array.isArray(v.counts)) {
        const merged: Saved = { ...defaults(), ...v };
        if (!merged.settings.date && merged.dateIso) {
          merged.settings.date = coverDate(merged.dateIso);
        }
        setState(merged);
      }
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

  // Предметы подбираются по названию, пока не выбраны вручную
  React.useEffect(() => {
    if (subjects.length === 0) return;
    setState((st) => {
      let changed = false;
      const ids = st.subjectIds.map((id, i) => {
        if (id && subjects.some((s) => s.id === id)) return id;
        const found = subjects.find((s) => keyKindOf(s.name) === CLUSTER_SLOTS[i].kind);
        if (found) { changed = true; return found.id; }
        if (id) changed = true;
        return '';
      });
      return changed ? { ...st, subjectIds: ids } : st;
    });
  }, [subjects]);

  const setSetting = (k: keyof ClusterSettings, v: string) => setState((st) => ({ ...st, settings: { ...st.settings, [k]: v } }));
  const setCount = (i: number, k: keyof Counts, v: number) =>
    setState((st) => ({ ...st, counts: st.counts.map((c, j) => (j === i ? { ...c, [k]: Math.max(0, Math.min(100, v || 0)) } : c)) }));
  const setEnabled = (i: number, on: boolean) => setState((st) => ({ ...st, enabled: CLUSTER_SLOTS.map((_, j) => (j === i ? on : st.enabled?.[j] !== false)) }));
  const setSubject = (i: number, id: string) => setState((st) => ({
    ...st,
    subjectIds: st.subjectIds.map((x, j) => (j === i ? id : x)),
    topicIds: CLUSTER_SLOTS.map((_, j) => (j === i ? [] : st.topicIds?.[j] ?? [])),
    chapterIds: CLUSTER_SLOTS.map((_, j) => (j === i ? [] : st.chapterIds?.[j] ?? [])),
  }));
  const setSelection = (i: number, chapterIds: string[], topicIds: string[]) => setState((st) => ({
    ...st,
    topicIds: CLUSTER_SLOTS.map((_, j) => (j === i ? topicIds : st.topicIds?.[j] ?? [])),
    chapterIds: CLUSTER_SLOTS.map((_, j) => (j === i ? chapterIds : st.chapterIds?.[j] ?? [])),
  }));

  const total = (c: Counts) => c.test + c.matching + c.open;

  const handleGenerate = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const { settings, variants: V, subjectIds, counts } = state;
      const enabled = CLUSTER_SLOTS.map((_, i) => state.enabled?.[i] !== false);
      if (!enabled.some(Boolean)) throw new Error('Включите хотя бы один предмет');
      if (!settings.code.trim()) throw new Error('Укажите код кластера (например, А.5)');
      if (!settings.exam.trim()) throw new Error('Укажите название экзамена (например, Авг)');
      if (!settings.date.trim()) throw new Error('Выберите дату экзамена в календаре');
      if (V < 1 || V > MAX_VARIANTS) throw new Error(`Вариантов может быть от 1 до ${MAX_VARIANTS}`);
      const missingSlot = CLUSTER_SLOTS.find((_, i) => enabled[i] && !subjectIds[i]);
      if (missingSlot) throw new Error(`Выберите предмет из базы для субтеста «${missingSlot.name}» или снимите с него галочку`);

      const variants: ClusterVariant[] = Array.from({ length: V }, (_, k) => ({ number: k + 1, subjects: [] }));
      const notes: string[] = [];
      const repeatNotes: string[] = [];

      // Предметы подбираются параллельно: сначала лёгкий список вопросов, полные данные — только для выбранных
      setProgress('Подбор вопросов…');
      let used = new Set<string>();
      if (state.avoidRepeats !== false) {
        try {
          used = await loadUsedQuestionIds();
        } catch (e) {
          notifyError(e, 'Не удалось проверить прошлые экзамены — повторы вопросов не исключены');
        }
      }
      const perSlot = await Promise.all(CLUSTER_SLOTS.map(async (slot, s) => {
        if (!enabled[s]) return null;
        try {
          const r = await pickForSlot(subjectIds[s], state.topicIds?.[s] ?? [], state.chapterIds?.[s] ?? [], counts[s], V, used);
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

  const input = 'w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
  const num = 'w-16 text-sm px-2 py-1.5 border border-slate-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 flex items-center">
          <Layers className="w-5 h-5 mr-2 text-blue-600" />
          Экзамен-кластер
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Тестовая книжка из 4 предметов по образцу: обложка, инструкция, субтесты, справочные материалы. Русский и таджикский языки и ключи ответов — одним архивом.
        </p>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">1. Параметры экзамена</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <label className="text-xs font-semibold text-slate-600 space-y-1">
            <span>Код кластера</span>
            <input className={input} value={state.settings.code} onChange={(e) => setSetting('code', e.target.value)} placeholder="А.5" />
          </label>
          <label className="text-xs font-semibold text-slate-600 space-y-1">
            <span>Название экзамена</span>
            <input className={input} value={state.settings.exam} onChange={(e) => setSetting('exam', e.target.value)} placeholder="Авг" />
          </label>
          <label className="text-xs font-semibold text-slate-600 space-y-1">
            <span>Дата экзамена</span>
            <input
              type="date" className={input} value={state.dateIso ?? ''}
              onChange={(e) => {
                const iso = e.target.value;
                const formatted = coverDate(iso);
                setState((st) => ({ ...st, dateIso: iso, settings: { ...st.settings, date: formatted || st.settings.date } }));
              }}
            />
            <span className="block text-xs font-normal text-slate-500">На обложке: <strong className="text-slate-700">{state.settings.date || '—'}</strong></span>
          </label>
          <label className="text-xs font-semibold text-slate-600 space-y-1">
            <span>Вариантов (1–{MAX_VARIANTS})</span>
            <input
              type="number" min={1} max={MAX_VARIANTS} className={input} value={state.variants}
              onChange={(e) => setState((st) => ({ ...st, variants: Math.max(1, Math.min(MAX_VARIANTS, Number(e.target.value) || 1)) }))}
            />
          </label>
        </div>
        <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox" className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
            checked={state.avoidRepeats !== false}
            onChange={(e) => setState((st) => ({ ...st, avoidRepeats: e.target.checked }))}
          />
          <span>Не брать вопросы, которые уже были в сохранённых экзаменах-кластерах (если не хватает новых — берутся и старые, с предупреждением)</span>
        </label>
        <p className="text-xs text-slate-500">
          Пример: «Компонент {state.settings.code || 'А.5'}-{state.settings.exam || 'Авг'}» на обложке и «Компонент {state.settings.code || 'А.5'}-1» в колонтитулах первого варианта.
        </p>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">2. Субтесты</h3>
        <p className="text-xs text-slate-500">Снимите галочку у предмета, чтобы не включать его в экзамен.</p>
        <div className="space-y-3">
          {CLUSTER_SLOTS.map((slot, i) => {
            const on = state.enabled?.[i] !== false;
            return (
            <div key={slot.kind} className={`grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end p-3 rounded-xl bg-slate-50 border border-slate-200 ${on ? '' : 'opacity-60'}`}>
              <div className="space-y-1">
                <label className="flex items-center space-x-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={on} onChange={(e) => setEnabled(i, e.target.checked)} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                  <span>{i + 1}. {slot.name}</span>
                </label>
                <select
                  disabled={!on}
                  className={`${input} ${on && !state.subjectIds[i] ? 'border-amber-400 bg-amber-50/40 focus:ring-amber-500' : ''}`}
                  value={state.subjectIds[i]}
                  onChange={(e) => setSubject(i, e.target.value)}
                >
                  <option value="">— выберите предмет —</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {on && !state.subjectIds[i] && (
                  <p className="text-xs text-amber-700 font-medium">Предмет не выбран. Выберите предмет из списка или снимите галочку.</p>
                )}
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                {([['test', 'Тестов'], ['matching', 'Соответствий'], ['open', 'Открытых']] as const).map(([k, label]) => (
                  <label key={k} className="text-xs font-semibold text-slate-500 space-y-1 block">
                    <span>{label}</span>
                    <input type="number" min={0} disabled={!on} className={num} value={state.counts[i][k]} onChange={(e) => setCount(i, k, Number(e.target.value))} />
                  </label>
                ))}
                <span className="text-xs text-slate-500 pb-2">= {total(state.counts[i])}</span>
              </div>
              <TopicPicker
                subjectId={state.subjectIds[i]} disabled={!on}
                chapterIds={state.chapterIds?.[i] ?? []} topicIds={state.topicIds?.[i] ?? []}
                onChange={(c, t) => setSelection(i, c, t)}
              />
            </div>
            );
          })}
        </div>
      </div>

      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={busy}
        className="w-full sm:w-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-semibold shadow-sm flex items-center justify-center space-x-2 transition"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        <span>{busy ? progress || 'Создание…' : 'Создать кластер'}</span>
      </button>

      {result && !busy && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 text-sm text-emerald-800">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>Кластер готов: <strong>{result.fileName}</strong> ({(result.blob.size / 1048576).toFixed(1)} МБ){result.saved ? ' · сохранён во вкладке «Сохраненные билеты»' : ''}</span>
          </div>
          <button
            type="button"
            onClick={() => saveAs(result.blob, result.fileName)}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-sm flex items-center justify-center space-x-2 transition"
          >
            <Download className="w-4 h-4" />
            <span>Скачать архив</span>
          </button>
        </div>
      )}
    </div>
  );
};
