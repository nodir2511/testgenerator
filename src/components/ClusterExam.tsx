import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { saveAs } from 'file-saver';
import { supabase } from '../lib/supabase';
import { Subject } from '../types/database';
import { fetchAllPages } from '../lib/fetchAllPages';
import { describeError, notifyError, notifyInfo } from '../lib/errors';
import { keyKindOf } from '../lib/answerKey';
import { CLUSTER_SLOTS, buildClusterZip, type ClusterSettings, type ClusterVariant } from '../lib/clusterExport';
import {
  fitSettings, pickParallel, chapterTotals, totalsOf, poolStats as calcPoolStats, toSnapshot,
} from '../../supabase/functions/_shared/ticketing';
import { Layers, Loader2, Download } from 'lucide-react';

// Экзамен-кластер: книжка сразу из 4 предметов по образцу (только главный админ).
// Параметры экзамена (код кластера, название, дата) вносятся заранее и запоминаются в браузере.

const KEY = 'examiner_cluster_v1';
const MAX_VARIANTS = 20;

type Counts = { test: number; matching: number; open: number };
interface Saved {
  settings: ClusterSettings;
  variants: number;
  subjectIds: string[];
  counts: Counts[];
  enabled: boolean[];
}

const defaults = (): Saved => ({
  settings: { code: 'А.5', exam: 'Авг', date: '' },
  variants: 4,
  subjectIds: CLUSTER_SLOTS.map(() => ''),
  counts: CLUSTER_SLOTS.map((s) => ({ ...s.counts })),
  enabled: CLUSTER_SLOTS.map(() => true),
});

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && raw.settings && Array.isArray(raw.subjectIds) && Array.isArray(raw.counts)) return { ...defaults(), ...raw };
  } catch { /* ignore */ }
  return defaults();
}

export const ClusterExam: React.FC = () => {
  const [state, setState] = useState<Saved>(load);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busyRef = React.useRef(false);

  React.useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

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
  const setSubject = (i: number, id: string) => setState((st) => ({ ...st, subjectIds: st.subjectIds.map((x, j) => (j === i ? id : x)) }));

  const total = (c: Counts) => c.test + c.matching + c.open;

  const handleGenerate = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const { settings, variants: V, subjectIds, counts } = state;
      const enabled = CLUSTER_SLOTS.map((_, i) => state.enabled?.[i] !== false);
      if (!enabled.some(Boolean)) throw new Error('Включите хотя бы один предмет');
      if (!settings.code.trim() || !settings.exam.trim() || !settings.date.trim()) throw new Error('Заполните код кластера, название экзамена и дату');
      if (V < 1 || V > MAX_VARIANTS) throw new Error(`Вариантов может быть от 1 до ${MAX_VARIANTS}`);
      if (subjectIds.some((id, i) => enabled[i] && !id)) throw new Error('Выберите предмет для каждого включённого субтеста');

      const variants: ClusterVariant[] = Array.from({ length: V }, (_, k) => ({ number: k + 1, subjects: [] }));
      const notes: string[] = [];

      for (let s = 0; s < CLUSTER_SLOTS.length; s++) {
        const slot = CLUSTER_SLOTS[s];
        if (!enabled[s]) {
          variants.forEach((v) => v.subjects.push(null));
          continue;
        }
        setProgress(`Подбор вопросов: ${slot.name}…`);
        const { data: all, error: qErr } = await fetchAllPages<any>(() =>
          supabase
            .from('questions')
            .select('*, chapter:chapters(name, order_index), topic:topics(name, order_index), options:question_options(*), matching_items:matching_items(*)')
            .eq('subject_id', subjectIds[s])
            .eq('is_deleted', false)
        );
        if (qErr || !all) throw qErr || new Error(`Не удалось загрузить вопросы: ${slot.name}`);

        const want = counts[s];
        const fit = fitSettings(calcPoolStats(all), {
          testCount: want.test, matchingCount: want.matching, openCount: want.open,
          ticketCount: V, shuffleOptions: true, shuffleMatching: true, title: '',
        });
        if (fit.error) throw new Error(`${slot.name}: ${fit.error}`);
        fit.notes.forEach((n) => notes.push(`${slot.name} — ${n}`));

        const totals = chapterTotals(all);
        const pick = (type: 'test' | 'matching' | 'open', n: number) =>
          pickParallel(all.filter((q) => q.type === type), n, V, Math.random, totalsOf(totals, type));
        const tests = pick('test', fit.settings.testCount);
        const matchings = pick('matching', fit.settings.matchingCount);
        const opens = pick('open', fit.settings.openCount);
        for (let k = 0; k < V; k++) {
          variants[k].subjects.push([...tests[k], ...matchings[k], ...opens[k]].map((q) => toSnapshot(q, { shuffleOptions: true, shuffleMatching: true })));
        }
      }

      setProgress('Сборка Word-файлов и ключей…');
      const file = await buildClusterZip(settings, variants);
      saveAs(file.blob, file.fileName);
      if (notes.length) notifyInfo(`Вопросов не хватило, книжки составлены из того, что есть. ${notes.join('; ')}`);
      if (file.keyOverflow) {
        notifyError(new Error(`В шаблонах ключей не нашлось мест для вопросов: ${file.keyOverflow}. Проверьте состав субтестов.`), 'Ключи заполнены не полностью');
      }
      if (file.missingAnswers) {
        notifyError(new Error(`В базе нет верного ответа у вопросов: ${file.missingAnswers} — клетки в ключах пустые.`), 'Кластер готов, но ключи не полные');
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
            <span>Дата на обложке</span>
            <input className={input} value={state.settings.date} onChange={(e) => setSetting('date', e.target.value)} placeholder="27.09" />
          </label>
          <label className="text-xs font-semibold text-slate-600 space-y-1">
            <span>Вариантов (1–{MAX_VARIANTS})</span>
            <input
              type="number" min={1} max={MAX_VARIANTS} className={input} value={state.variants}
              onChange={(e) => setState((st) => ({ ...st, variants: Math.max(1, Math.min(MAX_VARIANTS, Number(e.target.value) || 1)) }))}
            />
          </label>
        </div>
        <p className="text-[11px] text-slate-400">
          Пример: «Компонент {state.settings.code || 'А.5'}-{state.settings.exam || 'Авг'}» на обложке и «Компонент {state.settings.code || 'А.5'}-1» в колонтитулах первого варианта.
        </p>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">2. Субтесты</h3>
        <p className="text-[11px] text-slate-400">Снимите галочку у предмета, чтобы не включать его в экзамен.</p>
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
                <select disabled={!on} className={input} value={state.subjectIds[i]} onChange={(e) => setSubject(i, e.target.value)}>
                  <option value="">— выберите предмет —</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                {([['test', 'Тестов'], ['matching', 'Соответствий'], ['open', 'Открытых']] as const).map(([k, label]) => (
                  <label key={k} className="text-[11px] font-semibold text-slate-500 space-y-1 block">
                    <span>{label}</span>
                    <input type="number" min={0} disabled={!on} className={num} value={state.counts[i][k]} onChange={(e) => setCount(i, k, Number(e.target.value))} />
                  </label>
                ))}
                <span className="text-xs text-slate-500 pb-2">= {total(state.counts[i])}</span>
              </div>
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
        className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-semibold shadow-sm flex items-center justify-center space-x-2 transition"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        <span>{busy ? progress || 'Создание…' : 'Создать кластер и скачать'}</span>
      </button>
    </div>
  );
};
