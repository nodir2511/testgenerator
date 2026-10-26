import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2, SlidersHorizontal, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { notifyError, notifyInfo } from '../lib/errors';
import { useGenerationSettings, type GenerationSettings } from '../lib/generationLimits';
import { type UserRole } from '../types/database';

// Статистика использования (только для администратора): RPC admin_usage_stats (supabase/sql/usage_stats_v3.sql).
// Поля, которых нет в старой версии функции, необязательны — экран работает и с ней.

interface Totals { batches: number; tickets: number; users: number; telegram?: number }
interface Stats {
  since: string;
  per_day?: number;
  totals: Totals;
  prev?: Totals;
  today?: { batches: number; users: number };
  people?: { total: number; new: number; never: number; telegram: number; limit_days: number; limit_users: number };
  users: Array<{ id: string; name: string; email: string; role?: UserRole; batches: number; tickets: number; telegram: number; days?: number; subject?: string | null; last_at: string }>;
  inactive?: Array<{ id: string; name: string; email: string; last_at: string }>;
  sources?: Array<{ source: string; batches: number }>;
  subjects: Array<{ name: string; batches: number; tickets: number; tests: number; matching: number; open: number }>;
  bank?: Array<{ name: string; total: number; added: number; test: number; matching: number; open: number }>;
  authors?: Array<{ name: string; added: number }>;
  topics: Array<{ name: string; chapter: string; uses: number }>;
  chapters: Array<{ name: string; uses: number }>;
  hours?: Array<{ hour: number; batches: number }>;
  days: Array<{ day: string; batches: number; users?: number }>;
}

const short = (s: string) => (s.split(' / ')[0] || s).trim();
const PERIODS = [
  { days: 7, label: '7 дней', prevLabel: 'прошлой неделе' },
  { days: 30, label: '30 дней', prevLabel: 'прошлым 30 дням' },
  { days: 90, label: '90 дней', prevLabel: 'прошлым 90 дням' },
  { days: 365, label: 'Год', prevLabel: 'прошлому году' },
];
const SOURCE_LABEL: Record<string, string> = {
  site: 'Сайт',
  telegram: 'Telegram-бот',
  'telegram-app': 'Telegram Mini App',
  cluster: 'Экзамен-кластер',
};
const ROLE_SHORT: Partial<Record<UserRole, string>> = { admin: 'Админ', subject_admin: 'Админ предмета' };
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const fmtDay = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
};

// Полоса-значение в списках (одна серия — один цвет, подпись рядом текстом)
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${max ? Math.max(3, (value / max) * 100) : 0}%` }} />
    </div>
  );
}

const Card: React.FC<{ title: string; hint?: string; children: React.ReactNode; className?: string }> = ({ title, hint, children, className = '' }) => (
  <section className={`bg-white border border-slate-200 rounded-2xl p-4 ${className}`}>
    <h3 className="font-bold text-slate-900 text-base">{title}</h3>
    {hint && <p className="text-sm text-slate-600 mt-0.5">{hint}</p>}
    <div className="mt-3">{children}</div>
  </section>
);

const Empty = () => <p className="text-sm text-slate-600">За этот период данных нет.</p>;

// Главная цифра с изменением к прошлому периоду
const Kpi: React.FC<{ label: string; value: number; prev?: number; prevLabel: string; note?: string }> = ({ label, value, prev, prevLabel, note }) => {
  const pct = prev !== undefined && prev > 0 ? Math.round(((value - prev) / prev) * 100) : null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3.5">
      <div className="text-sm font-semibold text-slate-600 leading-tight">{label}</div>
      <div className="text-3xl font-bold text-slate-900 mt-1 tabular-nums">{value}</div>
      {note ? (
        <div className="text-xs text-slate-600 mt-1">{note}</div>
      ) : pct !== null ? (
        <div className={`text-xs font-semibold mt-1 flex items-center gap-1 ${pct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          {pct >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {pct >= 0 ? '+' : ''}{pct}% к {prevLabel}
        </div>
      ) : (
        <div className="text-xs text-slate-500 mt-1">Раньше данных нет</div>
      )}
    </div>
  );
};

// Список «название — число — полоса» с кнопкой «Показать все»
function RankList<T>({ items, limit = 7, render, value }: { items: T[]; limit?: number; render: (it: T) => React.ReactNode; value: (it: T) => number }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return <Empty />;
  const max = Math.max(1, ...items.map(value));
  const shown = all ? items : items.slice(0, limit);
  return (
    <div>
      <ul className="space-y-3">
        {shown.map((it, i) => (
          <li key={i}>
            {render(it)}
            <div className="mt-1.5"><Bar value={value(it)} max={max} /></div>
          </li>
        ))}
      </ul>
      {items.length > limit && (
        <button onClick={() => setAll((v) => !v)} className="mt-3 min-h-[40px] text-sm font-semibold text-indigo-700">
          {all ? 'Свернуть' : `Показать все (${items.length})`}
        </button>
      )}
    </div>
  );
}

// Столбики по времени: касание столбика показывает его значение. Длинный период — по неделям или месяцам
function TimeBars({ buckets, unit }: { buckets: Array<{ label: string; batches: number; users?: number }>; unit: string }) {
  const [sel, setSel] = useState<number | null>(null);
  if (buckets.every((b) => b.batches === 0)) return <Empty />;
  const max = Math.max(1, ...buckets.map((b) => b.batches));
  // Пока ничего не выбрано — подсвечен самый активный столбик
  const idx = sel ?? buckets.findIndex((b) => b.batches === max);
  const cur = buckets[idx];
  return (
    <div>
      <div className="text-sm text-slate-700 min-h-[20px]">
        {sel === null && 'Больше всего — '}<b className="text-slate-900">{cur.label}</b>: {cur.batches} {plural(cur.batches, 'генерация', 'генерации', 'генераций')}
        {cur.users !== undefined && cur.batches > 0 ? `, ${cur.users} ${plural(cur.users, 'человек', 'человека', 'человек')}` : ''}
      </div>
      <div className="mt-2 flex items-end h-32 border-b border-slate-200" role="list" aria-label={`Генерации по ${unit}`}>
        {buckets.map((b, i) => (
          <button
            key={i}
            type="button"
            role="listitem"
            onClick={() => setSel(i)}
            onMouseEnter={() => setSel(i)}
            className="flex-1 h-full flex items-end justify-center px-px"
            aria-label={`${b.label}: ${b.batches}`}
          >
            <span
              className={`w-full max-w-[18px] rounded-t ${i === idx ? 'bg-indigo-700' : 'bg-indigo-400'}`}
              style={{ height: b.batches ? `${Math.max(4, (b.batches / max) * 100)}%` : 2, opacity: b.batches ? 1 : 0.35 }}
            />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-slate-600 mt-1">
        <span>{buckets[0].label}</span>
        <span>{buckets[buckets.length - 1].label}</span>
      </div>
    </div>
  );
}

const bucketDays = (days: Stats['days'], period: number) => {
  if (period <= 31) return days.map((d) => ({ label: fmtDay(d.day), batches: d.batches, users: d.users }));
  const size = period <= 120 ? 7 : 30;
  const out: Array<{ label: string; batches: number }> = [];
  // Считаем от сегодняшнего дня назад, чтобы последний столбик был полным периодом до сегодня
  for (let end = days.length; end > 0; end -= size) {
    const chunk = days.slice(Math.max(0, end - size), end);
    out.unshift({
      label: size === 7 ? `${fmtDay(chunk[0].day)} – ${fmtDay(chunk[chunk.length - 1].day)}` : `${fmtDay(chunk[0].day)} – ${fmtDay(chunk[chunk.length - 1].day)}`,
      batches: chunk.reduce((s, d) => s + d.batches, 0),
    });
  }
  return out;
};

// Лимиты генерации для обычных пользователей (таблица generation_settings): меняет только главный админ
const LIMIT_FIELDS: Array<{ key: keyof GenerationSettings; label: string; min: number; max: number }> = [
  { key: 'per_day', label: 'Генераций в сутки', min: 1, max: 1000 },
  { key: 'cooldown_seconds', label: 'Пауза между генерациями, сек.', min: 0, max: 86400 },
  { key: 'max_tickets', label: 'Вариантов за раз', min: 1, max: 50 },
  { key: 'max_per_ticket', label: 'Вопросов в одном билете', min: 1, max: 200 },
];

const GenerationLimitsCard: React.FC<{ hint?: string }> = ({ hint }) => {
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();
  const { data } = useGenerationSettings();
  const [draft, setDraft] = useState<GenerationSettings | null>(null);
  const [saving, setSaving] = useState(false);
  React.useEffect(() => { if (data) setDraft(data); }, [data]);
  if (!draft) return null;
  const dirty = data && LIMIT_FIELDS.some((f) => draft[f.key] !== data[f.key]);
  const valid = LIMIT_FIELDS.every((f) => Number.isInteger(draft[f.key]) && draft[f.key] >= f.min && draft[f.key] <= f.max);

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('generation_settings').update(draft).eq('id', true);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['generation_settings'] });
      notifyInfo('Лимиты сохранены');
    } catch (e) {
      notifyError(e, 'Не удалось сохранить лимиты');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4">
      <h3 className="font-bold text-slate-900 text-base flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-indigo-600" /> Лимиты генерации</h3>
      <p className="text-sm text-slate-600 mt-0.5 mb-3">
        Для всех, кроме администраторов: сайт, Telegram-бот и Mini App.{isOwner ? '' : ' Менять может только главный админ.'}
        {hint ? ` ${hint}` : ''}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {LIMIT_FIELDS.map((f) => (
          <label key={f.key} className="flex items-center justify-between gap-3 sm:block text-sm font-semibold text-slate-700 sm:space-y-1">
            <span>{f.label}</span>
            <input
              type="number" inputMode="numeric" min={f.min} max={f.max} disabled={!isOwner}
              value={Number.isNaN(draft[f.key]) ? '' : draft[f.key]}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value === '' ? NaN : Number(e.target.value) })}
              className="w-24 sm:w-full min-h-[44px] text-base px-3 border border-slate-300 rounded-xl disabled:bg-slate-50 disabled:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
        ))}
      </div>
      {isOwner && (
        <button onClick={save} disabled={!dirty || !valid || saving}
          className="mt-3 w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-40">
          {saving ? 'Сохранение…' : 'Сохранить лимиты'}
        </button>
      )}
    </section>
  );
};

export const StatsView: React.FC = () => {
  const [days, setDays] = useState(() => Number(localStorage.getItem('examiner_stats_days')) || 30);
  const [noAdmins, setNoAdmins] = useState(() => localStorage.getItem('examiner_stats_no_admins') === 'true');
  React.useEffect(() => { localStorage.setItem('examiner_stats_days', String(days)); }, [days]);
  React.useEffect(() => { localStorage.setItem('examiner_stats_no_admins', String(noAdmins)); }, [noAdmins]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['admin-usage-stats', days, noAdmins],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let res = await supabase.rpc('admin_usage_stats', { p_days: days, p_no_admins: noAdmins });
      // Старая версия функции в базе — без фильтра «без администраторов»
      if (res.error?.code === 'PGRST202') res = await supabase.rpc('admin_usage_stats', { p_days: days });
      if (res.error) throw res.error;
      return res.data as Stats;
    },
    meta: { action: 'Не удалось загрузить статистику' },
  });
  const period = PERIODS.find((p) => p.days === days) ?? PERIODS[1];

  const header = (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-2xl" role="radiogroup" aria-label="Период">
        {PERIODS.map((p) => (
          <button
            key={p.days}
            role="radio"
            aria-checked={days === p.days}
            onClick={() => setDays(p.days)}
            className={`min-h-[44px] rounded-xl text-sm font-semibold transition ${days === p.days ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 min-h-[40px] px-1 text-sm text-slate-800 cursor-pointer select-none">
        <input type="checkbox" checked={noAdmins} onChange={(e) => setNoAdmins(e.target.checked)} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500" />
        <span className="flex-1">Без администраторов (только преподаватели)</span>
        {isFetching && !isLoading && <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />}
      </label>
    </div>
  );

  if (isLoading) return <div className="space-y-4">{header}<div className="flex justify-center py-16"><Loader2 className="w-7 h-7 text-indigo-600 animate-spin" /></div></div>;
  if (error || !data) return <div className="space-y-4">{header}<div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl">Не удалось загрузить статистику. Убедитесь, что вы администратор.</div></div>;

  const people = data.people;
  const sources = data.sources ?? [];
  const totalSrc = Math.max(1, sources.reduce((s, x) => s + x.batches, 0));
  const hours = data.hours ?? [];
  const peak = hours.length ? hours.reduce((a, b) => (b.batches > a.batches ? b : a)) : null;
  const bank = data.bank ?? [];
  const usageBySubject = new Map(data.subjects.map((s) => [s.name, s]));
  const limitHint = people && people.limit_users > 0
    ? `За период ${people.limit_users} ${plural(people.limit_users, 'человек', 'человека', 'человек')} упирались в дневной лимит.`
    : undefined;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {header}

      {/* Главные цифры */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Генераций" value={data.totals.batches} prev={data.prev?.batches} prevLabel={period.prevLabel} />
        <Kpi label="Билетов (вариантов)" value={data.totals.tickets} prev={data.prev?.tickets} prevLabel={period.prevLabel} />
        <Kpi label="Пользовались" value={data.totals.users} prev={data.prev?.users} prevLabel={period.prevLabel} note={people ? `из ${people.total} аккаунтов` : undefined} />
        {data.today
          ? <Kpi label="Сегодня" value={data.today.batches} prevLabel="" note={`${data.today.users} ${plural(data.today.users, 'человек', 'человека', 'человек')}`} />
          : <Kpi label="Через Telegram" value={data.totals.telegram ?? 0} prevLabel="" note="бот и Mini App" />}
      </div>

      <Card title="Активность" hint={days <= 31 ? 'Генерации по дням — коснитесь столбика' : days <= 120 ? 'Генерации по неделям' : 'Генерации по месяцам'}>
        <TimeBars buckets={bucketDays(data.days, days)} unit={days <= 31 ? 'дням' : 'неделям'} />
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {people && (
          <Card title="Люди">
            <dl className="grid grid-cols-2 gap-3">
              {[
                ['Аккаунтов всего', people.total, ''],
                ['Новых за период', people.new, ''],
                ['Ни разу не генерировали', people.never, people.never ? 'стоит напомнить или показать, как пользоваться' : ''],
                ['Привязали Telegram', people.telegram, ''],
                ['Упирались в дневной лимит', people.limit_users, people.limit_days ? `${people.limit_days} ${plural(people.limit_days, 'раз', 'раза', 'раз')} за период` : ''],
                ['Перестали пользоваться', data.inactive?.length ?? 0, 'были раньше, но не в этот период'],
              ].map(([label, value, note]) => (
                <div key={label as string} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <dt className="text-sm text-slate-600 leading-tight">{label}</dt>
                  <dd className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{value}</dd>
                  {note && <dd className="text-xs text-slate-600 mt-0.5 leading-snug">{note}</dd>}
                </div>
              ))}
            </dl>
          </Card>
        )}

        <Card title="Кто пользуется чаще" hint="Сколько генераций за период">
          <RankList
            items={data.users}
            value={(u) => u.batches}
            render={(u) => (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate" title={u.email}>{u.name}</div>
                  <div className="text-xs text-slate-600 leading-snug">
                    {[u.role && u.role !== 'subject_teacher' && u.role !== 'user' ? ROLE_SHORT[u.role] : null, u.subject ? short(u.subject) : null, ago(u.last_at)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-slate-900 tabular-nums">{u.batches}</div>
                  <div className="text-xs text-slate-600">{u.days !== undefined ? `${u.days} ${plural(u.days, 'день', 'дня', 'дней')}` : `${u.tickets} бил.`}</div>
                </div>
              </div>
            )}
          />
        </Card>

        {data.inactive && data.inactive.length > 0 && (
          <Card title="Перестали пользоваться" hint="Генерировали раньше, но не за этот период">
            <ul className="divide-y divide-slate-100">
              {data.inactive.slice(0, 15).map((u) => (
                <li key={u.id} className="py-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-900 truncate" title={u.email}>{u.name}</span>
                  <span className="text-xs text-slate-600 shrink-0">{ago(u.last_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Предметы" hint={bank.length ? 'Генерации за период и вопросы в банке' : 'Генерации за период'}>
          {bank.length === 0 && data.subjects.length === 0 ? <Empty /> : (
            <ul className="space-y-3">
              {(bank.length ? bank.map((b) => b.name) : data.subjects.map((s) => s.name)).map((name) => {
                const use = usageBySubject.get(name);
                const b = bank.find((x) => x.name === name);
                return (
                  <li key={name} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-slate-900">{short(name)}</span>
                      <span className="text-sm text-slate-700"><b className="text-slate-900 tabular-nums">{use?.batches ?? 0}</b> генер. · {use?.tickets ?? 0} бил.</span>
                    </div>
                    {b && (
                      <div className="text-xs text-slate-600 mt-1">
                        В банке {b.total.toLocaleString('ru-RU')} вопр.: {b.test} тест. · {b.matching} соотв. · {b.open} откр.
                        {b.added > 0 && <b className="text-emerald-700"> · +{b.added.toLocaleString('ru-RU')} за период</b>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {sources.length > 0 && (
          <Card title="Откуда генерируют">
            <ul className="space-y-3">
              {sources.map((s) => (
                <li key={s.source}>
                  <div className="flex justify-between text-sm gap-2">
                    <span className="font-semibold text-slate-900">{SOURCE_LABEL[s.source] ?? s.source}</span>
                    <span className="text-slate-700 tabular-nums">{s.batches} · {Math.round((s.batches / totalSrc) * 100)}%</span>
                  </div>
                  <div className="mt-1.5"><Bar value={s.batches} max={totalSrc} /></div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {hours.length > 0 && (
          <Card title="Время активности" hint={peak && peak.batches > 0 ? `Чаще всего — около ${peak.hour}:00 (по Душанбе)` : undefined}>
            <TimeBars buckets={hours.map((h) => ({ label: `${h.hour}:00–${h.hour + 1}:00`, batches: h.batches }))} unit="часам" />
          </Card>
        )}

        <Card title="Главы, которые выбирают чаще" hint="Без учёта генераций «Весь предмет»">
          <RankList
            items={data.chapters}
            value={(c) => c.uses}
            render={(c) => (
              <div className="flex justify-between text-sm gap-3">
                <span className="text-slate-900 min-w-0">{short(c.name)}</span>
                <span className="text-slate-700 tabular-nums shrink-0">{c.uses}</span>
              </div>
            )}
          />
        </Card>

        <Card title="Темы, которые выбирают чаще">
          <RankList
            items={data.topics}
            value={(t) => t.uses}
            render={(t) => (
              <div className="flex justify-between text-sm gap-3">
                <span className="min-w-0">
                  <span className="block text-slate-900">{short(t.name)}</span>
                  <span className="block text-xs text-slate-600">{short(t.chapter)}</span>
                </span>
                <span className="text-slate-700 tabular-nums shrink-0">{t.uses}</span>
              </div>
            )}
          />
        </Card>

        {data.authors && data.authors.length > 0 && (
          <Card title="Кто пополнял банк вопросов" hint="Добавлено вопросов за период">
            <RankList
              items={data.authors}
              value={(a) => a.added}
              render={(a) => (
                <div className="flex justify-between text-sm gap-3">
                  <span className="font-semibold text-slate-900 truncate">{a.name}</span>
                  <span className="text-slate-700 tabular-nums shrink-0">{a.added.toLocaleString('ru-RU')}</span>
                </div>
              )}
            />
          </Card>
        )}
      </div>

      <GenerationLimitsCard hint={limitHint} />
    </div>
  );
};
