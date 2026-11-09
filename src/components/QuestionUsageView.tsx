import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Badge, Card, EmptyState, Hint, PageHeader, Skeleton } from './ui';
import type { Subject } from '../types/database';

// Раздел «Подборы» (только главный админ): как вопросы банка попадают в билеты.
// Данные — RPC owner_question_usage (supabase/sql/question_usage.sql).

interface TopicRow { chapter_id: string; chapter: string; topic_id: string; topic: string; total: number; used: number; uses: number; last_at: string | null }
interface QRow { id: string; type: string; txt: string; chapter: string; topic: string; uses?: number }
interface Usage {
  totals: { questions: number; used: number; uses: number };
  topics: TopicRow[];
  top: QRow[];
  unused: QRow[];
}

const PERIODS: Array<{ days: number | null; label: string }> = [
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
  { days: 365, label: 'Год' },
  { days: null, label: 'Всё время' },
];
const TYPE_LABEL: Record<string, string> = { test: 'Тест', matching: 'Соответствие', open: 'Открытый' };
const plain = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

type Sort = 'order' | 'overloaded' | 'empty';
const SORTS: Array<{ id: Sort; label: string }> = [
  { id: 'order', label: 'По порядку' },
  { id: 'overloaded', label: 'Чаще всего' },
  { id: 'empty', label: 'Реже всего' },
];

export const QuestionUsageView: React.FC = () => {
  const [subjectId, setSubjectId] = useState('');
  const [days, setDays] = useState<number | null>(90);
  const [sort, setSort] = useState<Sort>('order');
  const [showUnused, setShowUnused] = useState(false);

  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Subject[];
    },
  });
  React.useEffect(() => { if (!subjectId && subjects.length) setSubjectId(subjects[0].id); }, [subjects, subjectId]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['question-usage', subjectId, days],
    enabled: !!subjectId,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('owner_question_usage', { p_subject_id: subjectId, p_days: days });
      if (error) throw error;
      return data as Usage;
    },
    meta: { action: 'Не удалось загрузить подборы' },
  });

  const avg = data && data.totals.questions > 0 ? data.totals.uses / data.totals.questions : 0;
  // Перегружена: вопросы темы берут в билеты вдвое чаще среднего по предмету. Пустует: больше половины вопросов темы ни разу не брали
  const flag = (t: TopicRow): 'over' | 'empty' | null => {
    if (avg > 0 && t.uses >= 5 && t.uses / t.total >= avg * 2) return 'over';
    if (data && data.totals.uses > 0 && t.total >= 3 && t.used / t.total < 0.5) return 'empty';
    return null;
  };

  const topics = React.useMemo(() => {
    const list = [...(data?.topics ?? [])];
    if (sort === 'overloaded') list.sort((a, b) => b.uses / b.total - a.uses / a.total);
    if (sort === 'empty') list.sort((a, b) => a.used / a.total - b.used / b.total || b.total - a.total);
    return list;
  }, [data, sort]);
  const maxPerQ = Math.max(0.0001, ...topics.map((t) => t.uses / t.total));

  const controls = (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          aria-label="Предмет"
          className="min-h-[44px] text-base px-3 border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:w-72"
        >
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-2xl flex-1 sm:max-w-md" role="radiogroup" aria-label="Период">
          {PERIODS.map((p) => (
            <button
              key={p.label}
              role="radio"
              aria-checked={days === p.days}
              onClick={() => setDays(p.days)}
              className={`min-h-[44px] rounded-xl text-sm font-semibold transition ${days === p.days ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {isFetching && !isLoading && <Loader2 className="w-4 h-4 text-indigo-600 animate-spin self-center" />}
      </div>
    </div>
  );

  const head = (
    <PageHeader
      icon={Layers}
      title="Подборы"
      description={<>Как вопросы банка попадают в билеты: что берут часто, а что не берут вовсе. <Hint label="Как читать раздел">Считаются все билеты, созданные за выбранный период, включая экзамен-кластер. «Использовано» — вопрос попал хотя бы в один билет. Метка «Перегружена» — вопросы темы берут вдвое чаще среднего по предмету; «Пустует» — больше половины вопросов темы не брали ни разу.</Hint></>}
    />
  );

  if (isLoading || !subjectId) return (
    <div className="space-y-4">{head}{controls}<Skeleton className="h-24 rounded-card" /><Skeleton className="h-64 rounded-card" /></div>
  );
  if (error || !data) return (
    <div className="space-y-4">{head}{controls}
      <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl">Не удалось загрузить подборы. Раздел доступен только главному админу; в базе должна быть применена функция из supabase/sql/question_usage.sql.</div>
    </div>
  );

  const { totals } = data;
  const unusedCount = totals.questions - totals.used;

  return (
    <div className="space-y-4">
      {head}
      {controls}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          ['Вопросов в банке', totals.questions, 'без удалённых'],
          ['Использовано', totals.used, `${pct(totals.used, totals.questions)}% банка`],
          ['Ни разу не брали', unusedCount, `${pct(unusedCount, totals.questions)}% банка`],
          ['Всего попаданий', totals.uses, avg > 0 ? `в среднем ${avg.toFixed(1)} на вопрос` : 'за период'],
        ] as const).map(([label, value, note]) => (
          <Card key={label} padding="none" className="p-3.5">
            <div className="text-sm font-semibold text-slate-600 leading-tight">{label}</div>
            <div className="text-3xl font-bold text-slate-900 mt-1 tabular-nums">{value}</div>
            <div className="text-xs text-slate-600 mt-1">{note}</div>
          </Card>
        ))}
      </div>

      <Card as="section" padding="none" className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="font-bold text-slate-900 text-base">Темы</h3>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl" role="radiogroup" aria-label="Порядок тем">
            {SORTS.map((s) => (
              <button
                key={s.id}
                role="radio"
                aria-checked={sort === s.id}
                onClick={() => setSort(s.id)}
                className={`min-h-[40px] px-3 rounded-lg text-sm font-semibold transition ${sort === s.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {topics.length === 0 ? (
          <div className="mt-3"><EmptyState title="В предмете нет вопросов" /></div>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {topics.map((t) => {
              const f = flag(t);
              const perQ = t.uses / t.total;
              return (
                <li key={t.topic_id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{t.topic}</div>
                      <div className="text-xs text-slate-600">{t.chapter}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {f === 'over' && <Badge tone="warning">Перегружена</Badge>}
                      {f === 'empty' && <Badge tone="info">Пустует</Badge>}
                    </div>
                  </div>
                  <div className="mt-1.5 h-2 bg-slate-100 rounded-full overflow-hidden" aria-hidden="true">
                    <div className={`h-full rounded-full ${f === 'over' ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${perQ > 0 ? Math.max(3, (perQ / maxPerQ) * 100) : 0}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-slate-700 flex flex-wrap gap-x-4 gap-y-0.5">
                    <span>Вопросов: <b>{t.total}</b></span>
                    <span>Использовано: <b>{t.used}</b> ({pct(t.used, t.total)}%)</span>
                    <span>Попаданий: <b>{t.uses}</b> ({perQ.toFixed(1)} на вопрос)</span>
                    <span>Последний раз: {fmtDate(t.last_at)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QuestionBlock title="Чаще всего в билетах" hint="Самые частые вопросы за период" rows={data.top} showUses />
        <Card as="section" padding="none" className="p-4">
          <h3 className="font-bold text-slate-900 text-base">Ни разу не брали ({unusedCount})</h3>
          <p className="text-sm text-slate-600 mt-0.5">Самые старые сверху{unusedCount > data.unused.length ? `, показаны первые ${data.unused.length}` : ''}</p>
          {data.unused.length === 0 ? (
            <p className="text-sm text-slate-600 mt-3">Все вопросы хотя бы раз попадали в билеты.</p>
          ) : (
            <>
              <button onClick={() => setShowUnused((v) => !v)} className="mt-2 min-h-[40px] text-sm font-semibold text-indigo-700">
                {showUnused ? 'Скрыть список' : 'Показать список'}
              </button>
              {showUnused && <QuestionList rows={data.unused} />}
            </>
          )}
        </Card>
      </div>
    </div>
  );
};

const QuestionList: React.FC<{ rows: QRow[]; showUses?: boolean }> = ({ rows, showUses }) => (
  <ul className="mt-2 divide-y divide-slate-100">
    {rows.map((q) => (
      <li key={q.id} className="py-2.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-900 line-clamp-2">{plain(q.txt) || '(без текста)'}</div>
          <div className="text-xs text-slate-600 mt-0.5">{TYPE_LABEL[q.type] ?? q.type} · {q.topic}</div>
        </div>
        {showUses && <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0">{q.uses}×</span>}
      </li>
    ))}
  </ul>
);

const QuestionBlock: React.FC<{ title: string; hint: string; rows: QRow[]; showUses?: boolean }> = ({ title, hint, rows, showUses }) => (
  <Card as="section" padding="none" className="p-4">
    <h3 className="font-bold text-slate-900 text-base">{title}</h3>
    <p className="text-sm text-slate-600 mt-0.5">{hint}</p>
    {rows.length === 0 ? <p className="text-sm text-slate-600 mt-3">За этот период билетов не было.</p> : <QuestionList rows={rows} showUses={showUses} />}
  </Card>
);
