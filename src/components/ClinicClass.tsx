import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { ArrowLeft, Check, Copy, Loader2, Plus, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button, Card, EmptyState } from './ui';

interface CaseInfo { key: string; title: string; topic: string; emer: boolean }
interface TopicInfo { id: string; sec: string; name: string }
interface Catalog { topics: TopicInfo[]; cases: CaseInfo[] }
interface SessionRow { code: string; title: string; status: 'open' | 'closed'; created_at: string; cases: number; players: number }
interface Player { n: number; name: string; score: number; done: number; results: Record<string, number> }
interface Board { title: string; status: 'open' | 'closed'; keys: string[]; players: Player[] }

const GAME_PATH = '/games/priem-patsienta/index.html';
const joinUrl = (code: string) => `${window.location.origin}${GAME_PATH}?c=${code}`;

const useCatalog = () => useQuery({
  queryKey: ['clinic-catalog'],
  queryFn: async (): Promise<Catalog> => (await fetch('/games/priem-patsienta/cases.json')).json(),
  staleTime: 60 * 60 * 1000,
});

/** Экран занятия: код, QR, таблица мест в реальном времени */
const LiveBoard: React.FC<{ code: string; onBack: () => void }> = ({ code, onBack }) => {
  const qc = useQueryClient();
  const catalog = useCatalog();
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const url = joinUrl(code);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 360 }).then((d) => { if (live) setQr(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [url]);

  const board = useQuery({
    queryKey: ['clinic-board', code],
    queryFn: async (): Promise<Board> => {
      const { data, error } = await supabase.rpc('clinic_board', { p_code: code });
      if (error) throw error;
      return data as Board;
    },
    refetchInterval: 3000,
  });

  const toggle = useMutation({
    mutationFn: async (open: boolean) => {
      const { error } = await supabase.rpc('clinic_close', { p_code: code, p_open: open });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clinic-board', code] }); qc.invalidateQueries({ queryKey: ['clinic-sessions'] }); },
  });

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* буфер недоступен */ }
  };

  const b = board.data;
  const titleOf = (key: string) => catalog.data?.cases.find((c) => c.key === key)?.title ?? key;
  const open = b?.status === 'open';

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 min-h-[40px]">
        <ArrowLeft className="w-4 h-4" /> К занятиям
      </button>

      <Card>
        <div className="flex flex-col sm:flex-row gap-5 sm:items-center">
          {qr && <img src={qr} alt="QR-код для входа" className="w-40 h-40 rounded-xl border border-slate-200 self-center sm:self-auto" />}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="text-sm text-slate-500">{b?.title || 'Занятие'}</div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Код занятия</div>
            <div className="text-5xl sm:text-6xl font-extrabold tracking-[0.2em] text-indigo-700 tabular-nums">{code}</div>
            <div className="text-sm text-slate-600 break-all">{url}</div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" onClick={copy}>{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Скопировано' : 'Скопировать ссылку'}</Button>
              <Button variant={open ? 'secondary' : 'primary'} onClick={() => toggle.mutate(!open)} disabled={!b || toggle.isPending}>
                {open ? 'Завершить занятие' : 'Открыть снова'}
              </Button>
            </div>
            {!open && b && <div className="text-sm font-semibold text-amber-700">Занятие завершено: новые участники не входят, баллы не принимаются.</div>}
          </div>
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 flex items-center gap-2"><Users className="w-4 h-4" /> Участники: {b?.players.length ?? 0}</h3>
          <span className="text-xs text-slate-500">Случаев в занятии: {b?.keys.length ?? 0} · обновляется само</span>
        </div>
        {board.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-indigo-600 animate-spin" /></div>
        ) : board.isError ? (
          <div className="p-6 text-sm text-red-700">Не удалось загрузить табло. Проверьте связь и обновите страницу.</div>
        ) : !b || b.players.length === 0 ? (
          <div className="p-6"><EmptyState title="Пока никого нет" description="Ординаторы открывают ссылку или QR-код, вводят имя и сразу появляются здесь." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="px-4 py-2 w-16">Место</th>
                  <th className="px-4 py-2">Имя</th>
                  <th className="px-4 py-2 w-28">Пройдено</th>
                  {b.keys.map((k, i) => <th key={k} className="px-2 py-2 text-center w-16" title={titleOf(k)}>№{i + 1}</th>)}
                  <th className="px-4 py-2 text-right w-24">Баллы</th>
                </tr>
              </thead>
              <tbody>
                {b.players.map((p, i) => {
                  const place = i > 0 && b.players[i - 1].score === p.score ? b.players.findIndex((x) => x.score === p.score) + 1 : i + 1;
                  return (
                    <tr key={p.n} className="border-b border-slate-100 last:border-0 text-lg">
                      <td className="px-4 py-2.5 font-extrabold text-slate-900">{place <= 3 ? ['🥇', '🥈', '🥉'][place - 1] : place}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{p.name}</td>
                      <td className="px-4 py-2.5 text-slate-600 tabular-nums">{p.done} из {b.keys.length}</td>
                      {b.keys.map((k) => (
                        <td key={k} className="px-2 py-2.5 text-center text-base tabular-nums text-slate-600">{k in p.results ? p.results[k] : '·'}</td>
                      ))}
                      <td className="px-4 py-2.5 text-right text-2xl font-extrabold text-indigo-700 tabular-nums">{p.score}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {b && (
        <div className="text-xs text-slate-500 px-1">
          Номера в таблице: {b.keys.map((k, i) => `№${i + 1} — ${titleOf(k)}`).join('; ')}
        </div>
      )}
    </div>
  );
};

/** Выбор случаев и создание занятия */
const NewSession: React.FC<{ onCreated: (code: string) => void; onBack: () => void }> = ({ onCreated, onBack }) => {
  const catalog = useCatalog();
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await supabase.rpc('clinic_create', { p_title: title.trim(), p_keys: picked });
      if (err) throw err;
      return data as string;
    },
    onSuccess: (code) => onCreated(code),
    onError: (e: Error) => setError(e.message),
  });

  const flip = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  const cat = catalog.data;
  const topicKeys = (id: string) => (cat?.cases ?? []).filter((c) => c.topic === id).map((c) => c.key);
  const flipTopic = (id: string) => {
    const ks = topicKeys(id);
    setPicked((p) => (ks.every((k) => p.includes(k)) ? p.filter((k) => !ks.includes(k)) : [...p, ...ks.filter((k) => !p.includes(k))]));
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 min-h-[40px]">
        <ArrowLeft className="w-4 h-4" /> К занятиям
      </button>
      <Card className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="clTitle">Название занятия</label>
          <input
            id="clTitle" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Например: Эндокринология, 2 курс"
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white text-sm"
          />
        </div>
        <div className="space-y-4">
          <div className="text-sm font-semibold text-slate-700">Какие случаи пройдут ординаторы ({picked.length})</div>
          {!cat ? <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" /> : cat.topics.map((t) => {
            const ks = topicKeys(t.id);
            const all = ks.length > 0 && ks.every((k) => picked.includes(k));
            return (
              <div key={t.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="font-bold text-slate-900">{t.name} <span className="text-xs font-medium text-slate-500">· {t.sec}</span></div>
                  <button type="button" onClick={() => flipTopic(t.id)} className="text-sm font-semibold text-indigo-700 min-h-[36px]">{all ? 'Снять все' : 'Выбрать все'}</button>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {cat.cases.filter((c) => c.topic === t.id).map((c) => (
                    <label key={c.key} className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-slate-50 cursor-pointer text-sm text-slate-800">
                      <input type="checkbox" className="mt-0.5 w-4 h-4" checked={picked.includes(c.key)} onChange={() => flip(c.key)} />
                      <span>{c.title}{c.emer ? ' ⚡' : ''}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {error && <div className="text-sm text-red-700">{error}</div>}
        <div className="flex justify-end">
          <Button onClick={() => { setError(''); create.mutate(); }} disabled={picked.length === 0 || create.isPending}>
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Начать занятие
          </Button>
        </div>
      </Card>
    </div>
  );
};

/** Раздел учителя: свои занятия, новое занятие, экран с местами */
export const ClinicClass: React.FC = () => {
  const [view, setView] = useState<{ t: 'list' } | { t: 'new' } | { t: 'board'; code: string }>({ t: 'list' });
  const sessions = useQuery({
    queryKey: ['clinic-sessions'],
    queryFn: async (): Promise<SessionRow[]> => {
      const { data, error } = await supabase.rpc('clinic_my_sessions');
      if (error) throw error;
      return (data ?? []) as SessionRow[];
    },
  });

  if (view.t === 'new') return <NewSession onBack={() => setView({ t: 'list' })} onCreated={(code) => setView({ t: 'board', code })} />;
  if (view.t === 'board') return <LiveBoard code={view.code} onBack={() => { sessions.refetch(); setView({ t: 'list' }); }} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-900">Занятия «Приём пациента»</h3>
        <Button onClick={() => setView({ t: 'new' })}><Plus className="w-4 h-4" /> Новое занятие</Button>
      </div>
      {sessions.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-indigo-600 animate-spin" /></div>
      ) : sessions.isError ? (
        <Card tone="warning" className="text-sm text-slate-800">Занятия пока недоступны: не применены настройки базы (файл clinic_class.sql).</Card>
      ) : (sessions.data ?? []).length === 0 ? (
        <Card><EmptyState title="Занятий пока нет" description="Нажмите «Новое занятие», выберите случаи — ординаторы войдут по коду со своих телефонов." /></Card>
      ) : (
        <div className="grid gap-2">
          {(sessions.data ?? []).map((s) => (
            <button key={s.code} onClick={() => setView({ t: 'board', code: s.code })} className="text-left">
              <Card interactive padding="sm" className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 truncate">{s.title || 'Без названия'}</div>
                  <div className="text-xs text-slate-500">{new Date(s.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} · случаев: {s.cases} · участников: {s.players}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-extrabold tracking-widest text-indigo-700">{s.code}</div>
                  <div className={`text-xs font-semibold ${s.status === 'open' ? 'text-green-700' : 'text-slate-500'}`}>{s.status === 'open' ? 'идёт' : 'закончено'}</div>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
