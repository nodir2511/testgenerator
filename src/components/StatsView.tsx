import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2, BarChart3, Users, FileText, Send } from 'lucide-react';

// Статистика использования генератора (только для администратора): RPC admin_usage_stats

interface Stats {
  since: string;
  totals: { batches: number; tickets: number; users: number; telegram: number };
  users: Array<{ id: string; name: string; email: string; batches: number; tickets: number; telegram: number; last_at: string }>;
  subjects: Array<{ name: string; batches: number; tickets: number; tests: number; matching: number; open: number }>;
  topics: Array<{ name: string; chapter: string; uses: number }>;
  chapters: Array<{ name: string; uses: number }>;
  days: Array<{ day: string; batches: number }>;
}

const short = (s: string) => (s.split(' / ')[0] || s).trim();
const PERIODS = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
  { days: 365, label: 'Год' },
];

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex-1 min-w-[60px]">
      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${max ? Math.max(4, (value / max) * 100) : 0}%` }} />
    </div>
  );
}

export const StatsView: React.FC = () => {
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-usage-stats', days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_usage_stats', { p_days: days });
      if (error) throw error;
      return data as Stats;
    },
    meta: { action: 'Не удалось загрузить статистику' },
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 text-blue-600 animate-spin" /></div>;
  if (error || !data) return <div className="p-6 text-sm text-red-600">Не удалось загрузить статистику. Убедитесь, что вы администратор.</div>;

  const maxUser = Math.max(1, ...data.users.map((u) => u.batches));
  const maxTopic = Math.max(1, ...data.topics.map((t) => t.uses));
  const maxChapter = Math.max(1, ...data.chapters.map((c) => c.uses));
  const maxDay = Math.max(1, ...data.days.map((d) => d.batches));

  const cards = [
    { label: 'Наборов создано', value: data.totals.batches, icon: FileText },
    { label: 'Билетов (вариантов)', value: data.totals.tickets, icon: BarChart3 },
    { label: 'Активных пользователей', value: data.totals.users, icon: Users },
    { label: 'Через Telegram', value: data.totals.telegram, icon: Send },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-blue-600" /> Статистика использования</h2>
        <div className="inline-flex rounded-xl border border-slate-200 overflow-hidden bg-white text-sm">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 font-semibold ${days === p.days ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold"><c.icon className="w-4 h-4" />{c.label}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h3 className="font-bold text-slate-800 mb-3">Кто пользуется чаще</h3>
          {data.users.length === 0 && <p className="text-sm text-slate-400">Пока нет данных за период.</p>}
          <div className="space-y-2.5">
            {data.users.map((u) => (
              <div key={u.id ?? u.email}>
                <div className="flex justify-between text-sm gap-2">
                  <span className="font-semibold text-slate-800 truncate" title={u.email}>{u.name}</span>
                  <span className="text-slate-500 shrink-0">{u.batches} наборов · {u.tickets} билетов{u.telegram ? ` · TG ${u.telegram}` : ''}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Bar value={u.batches} max={maxUser} />
                  <span className="text-[11px] text-slate-400 shrink-0">{new Date(u.last_at).toLocaleDateString('ru-RU')}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h3 className="font-bold text-slate-800 mb-3">Что генерируют</h3>
          {data.subjects.length === 0 && <p className="text-sm text-slate-400">Пока нет данных за период.</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="font-semibold pb-1">Предмет</th><th className="font-semibold pb-1 text-right">Наборов</th>
                <th className="font-semibold pb-1 text-right">Тестов</th><th className="font-semibold pb-1 text-right">Соотв.</th><th className="font-semibold pb-1 text-right">Откр.</th>
              </tr>
            </thead>
            <tbody>
              {data.subjects.map((s) => (
                <tr key={s.name} className="border-t border-slate-100">
                  <td className="py-1.5 font-semibold text-slate-800">{short(s.name)}</td>
                  <td className="py-1.5 text-right">{s.batches}</td>
                  <td className="py-1.5 text-right">{s.tests}</td>
                  <td className="py-1.5 text-right">{s.matching}</td>
                  <td className="py-1.5 text-right">{s.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-slate-400 mt-2">Количество вопросов — всего в созданных билетах.</p>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h3 className="font-bold text-slate-800 mb-3">Какие темы выбирают чаще</h3>
          {data.topics.length === 0 && <p className="text-sm text-slate-400">Нет данных по темам за период.</p>}
          <div className="space-y-2">
            {data.topics.map((t, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm gap-2">
                  <span className="text-slate-800 truncate" title={`${t.chapter} · ${t.name}`}>{short(t.name)} <span className="text-slate-400">· {short(t.chapter)}</span></span>
                  <span className="text-slate-500 shrink-0">{t.uses}</span>
                </div>
                <Bar value={t.uses} max={maxTopic} />
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h3 className="font-bold text-slate-800 mb-3">Какие главы выбирают чаще</h3>
          {data.chapters.length === 0 && <p className="text-sm text-slate-400">Нет данных по главам за период.</p>}
          <div className="space-y-2">
            {data.chapters.map((c, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm gap-2">
                  <span className="text-slate-800 truncate">{short(c.name)}</span>
                  <span className="text-slate-500 shrink-0">{c.uses}</span>
                </div>
                <Bar value={c.uses} max={maxChapter} />
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="bg-white border border-slate-200 rounded-2xl p-4">
        <h3 className="font-bold text-slate-800 mb-3">Активность по дням</h3>
        {data.days.length === 0 && <p className="text-sm text-slate-400">Пока нет данных за период.</p>}
        <div className="flex items-end gap-1 h-28 overflow-x-auto">
          {data.days.map((d) => (
            <div key={d.day} className="flex flex-col items-center justify-end h-full min-w-[22px]" title={`${d.day}: ${d.batches}`}>
              <span className="text-[10px] text-slate-500">{d.batches}</span>
              <div className="w-4 bg-blue-500 rounded-t" style={{ height: `${(d.batches / maxDay) * 80}%`, minHeight: 3 }} />
              <span className="text-[9px] text-slate-400 mt-0.5">{d.day.slice(8)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
