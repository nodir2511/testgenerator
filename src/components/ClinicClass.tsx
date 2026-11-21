import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import './clinic.css';
import { supabase } from '../lib/supabase';
import { plainError } from '../lib/errors';
import { confirmAction } from '../lib/confirm';

interface CaseInfo { key: string; title: string; topic: string; emer: boolean }
interface TopicInfo { id: string; sec: string; name: string }
interface Catalog { topics: TopicInfo[]; cases: CaseInfo[] }
interface SessionRow { code: string; title: string; status: 'open' | 'closed'; created_at: string; cases: number; players: number }
interface Player { n: number; name: string; score: number; done: number; results: Record<string, number> }
export interface Board { title: string; status: 'open' | 'closed'; entry_closed?: boolean; keys: string[]; players: Player[] }

export const GAME_PATH = '/games/priem-patsienta/index.html';
export const joinUrl = (code: string) => `${window.location.origin}${GAME_PATH}?c=${code}`;
/** Пробный проход учителя: те же случаи, без имени и без отправки баллов (class.js, параметр demo) */
export const demoUrl = (keys: string[], modes?: string[]) =>
  `${GAME_PATH}?demo=${keys.join(',')}${modes && modes.length === 1 ? `&m=${modes[0]}` : ''}`;
const MODES = [
  { id: 'norm', name: '🩺 Обычный', hint: 'Подсказки сразу: полезный шаг светится зелёным, ошибка — красным, баллы видны.', hc: false },
  { id: 'hard', name: '💀 Хардкор', hint: 'Как в настоящей больнице: никаких подсказок до конца приёма. Баллы ×2.', hc: true },
];

export const useCatalog = () => useQuery({
  queryKey: ['clinic-catalog'],
  queryFn: async (): Promise<Catalog> => (await fetch('/games/priem-patsienta/cases.json')).json(),
  staleTime: 60 * 60 * 1000,
});

const Top: React.FC<{ title: React.ReactNode; sub?: string; children?: React.ReactNode }> = ({ title, sub, children }) => (
  <div className="cl-top">
    <h3>{title}{sub && <small>{sub}</small>}</h3>
    {children}
  </div>
);

/** Таблица мест: общая для экрана учителя и экрана проектора */
export const PlacesBox: React.FC<{ b?: Board; loading: boolean; failed: boolean; titleOf: (key: string) => string; big?: boolean; hideTitles?: boolean }> = ({ b, loading, failed, titleOf, big, hideTitles }) => (
  <>
    <div className={`cl-box ${big ? 'big' : ''}`}>
        <h4>Участники: {b?.players.length ?? 0} · случаев в занятии: {b?.keys.length ?? 0} · обновляется само</h4>
        {loading ? (
          <div className="cl-empty">Загрузка…</div>
        ) : failed ? (
          <div className="cl-empty cl-err">Не удалось загрузить табло. Проверьте связь и обновите страницу.</div>
        ) : !b || b.players.length === 0 ? (
          <div className="cl-empty"><b>Пока никого нет</b>Ординаторы открывают ссылку или QR-код, вводят имя и сразу появляются здесь.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cl-table">
              <thead>
                <tr>
                  <th>Место</th><th>Имя</th><th>Пройдено</th>
                  {b.keys.map((k, i) => <th key={k} className="cl-c" title={hideTitles ? undefined : titleOf(k)}>№{i + 1}</th>)}
                  <th style={{ textAlign: 'right' }}>Баллы</th>
                </tr>
              </thead>
              <tbody>
                {b.players.map((p, i) => {
                  const place = b.players.findIndex((x) => x.score === p.score) + 1 || i + 1;
                  return (
                    <tr key={p.n}>
                      <td className="cl-pl">{place <= 3 ? ['🥇', '🥈', '🥉'][place - 1] : place}</td>
                      <td className="cl-nm">{p.name}</td>
                      <td style={{ minWidth: 110 }}>
                        <div className="cl-bar"><i style={{ width: `${b.keys.length ? (p.done / b.keys.length) * 100 : 0}%` }} /></div>
                        <small className="cl-hint">{p.done} из {b.keys.length}</small>
                      </td>
                      {b.keys.map((k) => {
                        const v = p.results[k];
                        return <td key={k} className={`cl-c ${v === undefined ? '' : v < 0 ? 'neg' : 'ok'}`}>{v === undefined ? '·' : v}</td>;
                      })}
                      <td className="cl-sc">{p.score}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
    {b && !hideTitles && <div className="cl-key">{b.keys.map((k, i) => `№${i + 1} — ${titleOf(k)}`).join(' · ')}</div>}
  </>
);

/** Экран занятия: код, QR, места участников в реальном времени */
const LiveBoard: React.FC<{ code: string; onBack: () => void; onDeleted: () => void }> = ({ code, onBack, onDeleted }) => {
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

  const lock = useMutation({
    mutationFn: async (closed: boolean) => {
      const { error } = await supabase.rpc('clinic_lock', { p_code: code, p_closed: closed });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic-board', code] }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('clinic_delete', { p_code: code });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clinic-sessions'] }); onDeleted(); },
  });
  const askDelete = async () => {
    const n = board.data?.players.length ?? 0;
    const ok = await confirmAction({
      title: 'Удалить занятие?',
      message: 'Занятие, участники и их баллы исчезнут без возможности вернуть. Ссылка и код перестанут работать.',
      details: [`Код: ${code}`, `Участников: ${n}`],
      confirmLabel: 'Удалить занятие',
      cancelLabel: 'Оставить',
      tone: 'danger',
    });
    if (ok) remove.mutate();
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* буфер недоступен */ }
  };

  const b = board.data;
  const titleOf = (key: string) => catalog.data?.cases.find((c) => c.key === key)?.title ?? key;
  const open = b?.status === 'open';
  const locked = !!b?.entry_closed;

  return (
    <>
      <Top title="🩺 Занятие" sub={b?.title || 'Приём пациента'}>
        <button className="cl-btn" type="button" onClick={onBack}>← К занятиям</button>
      </Top>
      <div className="cl-gap">
        <div className="cl-box">
          <div className="cl-head">
            {qr && <img src={qr} alt="QR-код для входа" className="cl-qr" />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="cl-lbl">Код занятия</span>
              <div className="cl-code">{code}</div>
              <div className="cl-link-url">{url}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <a className="cl-btn sm" href={`/clinic/${code}`} target="_blank" rel="noopener">📽 Проектор</a>
                {b && b.keys.length > 0 && (
                  <a className="cl-btn sm" href={demoUrl(b.keys)} target="_blank" rel="noopener" title="Пройти случаи занятия самому: без имени, баллы на табло не попадают">🎓 Пройти самому</a>
                )}
                <button className="cl-btn sm" type="button" onClick={copy}>{copied ? '✓ Скопировано' : '📋 Скопировать ссылку'}</button>
                {open && <button className={`cl-btn sm ${locked ? '' : 'primary'}`} type="button" onClick={() => lock.mutate(!locked)} disabled={!b || lock.isPending}>{locked ? '🔓 Открыть вход' : '🔒 Вход закрыт — все зашли'}</button>}
                <button className={`cl-btn sm ${open ? '' : 'primary'}`} type="button" onClick={() => toggle.mutate(!open)} disabled={!b || toggle.isPending}>
                  {open ? '■ Завершить занятие' : '▶ Открыть снова'}
                </button>
                <button className="cl-btn sm danger" type="button" onClick={askDelete} disabled={!b || remove.isPending}>🗑 Удалить занятие</button>
              </div>
              {open && locked && <div className="cl-end">Вход закрыт: новые участники не заходят, уже вошедшие играют. На проекторе остаётся только таблица лидеров.</div>}
              {!open && b && <div className="cl-end">Занятие завершено: новые участники не входят, баллы не принимаются.</div>}
            </div>
          </div>
        </div>

        <PlacesBox b={b} loading={board.isLoading} failed={board.isError} titleOf={titleOf} />
      </div>
    </>
  );
};

/** Выбор случаев и режимов, создание занятия */
const NewSession: React.FC<{ onCreated: (code: string) => void; onBack: () => void }> = ({ onCreated, onBack }) => {
  const catalog = useCatalog();
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [modes, setModes] = useState<string[]>(['norm', 'hard']);
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await supabase.rpc('clinic_create', { p_title: title.trim(), p_keys: picked, p_modes: modes });
      if (err) throw err;
      return data as string;
    },
    onSuccess: (code) => onCreated(code),
    onError: (e: Error) => setError(plainError(e)),
  });

  const flipMode = (m: string) => setModes((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));
  const flip = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  const cat = catalog.data;
  const topicKeys = (id: string) => (cat?.cases ?? []).filter((c) => c.topic === id).map((c) => c.key);
  const flipTopic = (id: string) => {
    const ks = topicKeys(id);
    setPicked((p) => (ks.every((k) => p.includes(k)) ? p.filter((k) => !ks.includes(k)) : [...p, ...ks.filter((k) => !p.includes(k))]));
  };

  return (
    <>
      <Top title="🩺 Новое занятие" sub="Выберите режимы и случаи — ординаторы войдут по коду">
        <button className="cl-btn" type="button" onClick={onBack}>← К занятиям</button>
      </Top>
      <div className="cl-gap">
        <div className="cl-box">
          <label className="cl-lbl" htmlFor="clTitle">Название занятия</label>
          <input id="clTitle" className="cl-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Например: Эндокринология, 2 курс" />
        </div>

        <div>
          <div className="cl-hint" style={{ margin: '0 4px 8px' }}>Режимы игры, из которых выберет участник. Если выбран один — играют сразу в нём.</div>
          <div className="cl-modes">
            {MODES.map((m) => (
              <button key={m.id} type="button" className={`cl-mode ${m.hc ? 'hc' : ''} ${modes.includes(m.id) ? 'on' : ''}`} onClick={() => flipMode(m.id)}>
                <b>{m.name}{modes.includes(m.id) ? ' ✓' : ''}</b><span>{m.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="cl-hint" style={{ margin: '0 4px 8px' }}>Какие случаи пройдут ординаторы: выбрано {picked.length}. Кнопка «Пройти самому» внизу откроет их для вас без занятия — например, для презентации.</div>
          <div className="cl-dirs">
            {!cat ? <div className="cl-empty">Загрузка…</div> : cat.topics.map((t) => {
              const ks = topicKeys(t.id);
              const all = ks.length > 0 && ks.every((k) => picked.includes(k));
              return (
                <div key={t.id} className="cl-dir">
                  <div className="cl-dir-h">
                    <div><b>{t.name}</b><small>{t.sec}</small></div>
                    <button type="button" className="cl-link" onClick={() => flipTopic(t.id)}>{all ? 'Снять все' : 'Выбрать все'}</button>
                  </div>
                  {cat.cases.filter((c) => c.topic === t.id).map((c) => (
                    <button key={c.key} type="button" className={`cl-pick ${picked.includes(c.key) ? 'on' : ''}`} onClick={() => flip(c.key)}>
                      {c.title}{c.emer ? ' ⚡' : ''}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {error && <div className="cl-err">{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          {picked.length > 0 && modes.length > 0 ? (
            <a className="cl-btn" href={demoUrl(picked, modes)} target="_blank" rel="noopener" title="Пройти выбранные случаи самому, например для презентации: занятие не создаётся, баллы никуда не отправляются">🎓 Пройти самому</a>
          ) : (
            <button className="cl-btn" type="button" disabled>🎓 Пройти самому</button>
          )}
          <button className="cl-btn primary" type="button" disabled={picked.length === 0 || modes.length === 0 || create.isPending}
            onClick={() => { setError(''); create.mutate(); }}>
            ▶ Начать занятие
          </button>
        </div>
      </div>
    </>
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

  let body: React.ReactNode;
  if (view.t === 'new') {
    body = <NewSession onBack={() => setView({ t: 'list' })} onCreated={(code) => setView({ t: 'board', code })} />;
  } else if (view.t === 'board') {
    body = <LiveBoard code={view.code} onBack={() => { sessions.refetch(); setView({ t: 'list' }); }} onDeleted={() => setView({ t: 'list' })} />;
  } else {
    body = (
      <>
        <Top title="🩺 Занятия" sub="Приём пациента: ординаторы проходят случаи на своих телефонах">
          <button className="cl-btn primary" type="button" onClick={() => setView({ t: 'new' })}>＋ Новое занятие</button>
        </Top>
        <div className="cl-gap">
          {sessions.isLoading ? (
            <div className="cl-empty">Загрузка…</div>
          ) : sessions.isError ? (
            <div className="cl-box cl-err">Не удалось загрузить занятия. {plainError(sessions.error)} <button className="cl-btn" type="button" onClick={() => sessions.refetch()}>Повторить</button></div>
          ) : (sessions.data ?? []).length === 0 ? (
            <div className="cl-box cl-empty"><b>Занятий пока нет</b>Нажмите «Новое занятие», выберите режимы и случаи — ординаторы войдут по коду со своих телефонов.</div>
          ) : (
            (sessions.data ?? []).map((s) => (
              <button key={s.code} type="button" className="cl-ses" onClick={() => setView({ t: 'board', code: s.code })}>
                <div style={{ minWidth: 0 }}>
                  <b>{s.title || 'Без названия'}</b>
                  <small>{new Date(s.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} · случаев: {s.cases} · участников: {s.players}</small>
                </div>
                <div className="code">{s.code}<em className={s.status === 'open' ? '' : 'off'}>{s.status === 'open' ? 'идёт' : 'закончено'}</em></div>
              </button>
            ))
          )}
        </div>
      </>
    );
  }

  return <div className="cl-app">{body}</div>;
};
