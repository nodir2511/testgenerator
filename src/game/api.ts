import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export type Lang = 'both' | 'ru' | 'tj';

export interface GameTeam { n: number; name: string }
export interface GameBuzz { n: number; t: number }
export interface GameQ { r: string; ci: number; qi: number; shown: boolean; pts: number; wrong: number[] }
export interface GameTimer { running: boolean; left: number; endsAt: number | null }
export interface GameBoard {
  round: string;
  lang: Lang;
  used: Record<string, Record<string, true>>;
  scores: Record<string, number>;
  q: GameQ | null;
  timer: GameTimer;
  showLink: boolean;
}
export interface GameSession {
  code: string;
  host_id: string;
  teams: GameTeam[];
  board: GameBoard;
  buzz: GameBuzz[];
  created_at: string;
}

export const QUESTION_SECONDS = 30;
export const MAX_TEAMS = 6;

export function freshBoard(keep?: Partial<GameBoard>): GameBoard {
  return {
    round: keep?.round ?? 'r1',
    lang: keep?.lang ?? 'both',
    used: { r1: {}, r2: {} },
    scores: {},
    q: null,
    timer: { running: false, left: QUESTION_SECONDS, endsAt: null },
    showLink: false,
  };
}

function normalize(row: any): GameSession {
  const b = row.board && typeof row.board === 'object' ? row.board : {};
  const base = freshBoard();
  return {
    code: row.code,
    host_id: row.host_id,
    created_at: row.created_at,
    teams: Array.isArray(row.teams) ? row.teams : [],
    buzz: Array.isArray(row.buzz) ? row.buzz : [],
    board: { ...base, ...b, used: { ...base.used, ...(b.used || {}) }, timer: { ...base.timer, ...(b.timer || {}) } },
  };
}

export const playUrl = (code: string) => `${window.location.origin}/play/${code}`;
export const screenUrl = (code: string) => `${window.location.origin}/game/screen/${code}`;

/** Серверные часы: возвращает функцию «сейчас по серверу, мс». Синхронизация по game_time(). */
export function useServerClock(): () => number {
  const offset = useRef(0);
  useEffect(() => {
    let dead = false;
    const sync = async () => {
      const t0 = Date.now();
      const { data, error } = await supabase.rpc('game_time');
      const t1 = Date.now();
      if (dead || error || typeof data !== 'number') return;
      offset.current = data - (t0 + t1) / 2;
    };
    sync();
    const id = setInterval(sync, 60000);
    return () => { dead = true; clearInterval(id); };
  }, []);
  return useCallback(() => Date.now() + offset.current, []);
}

/** Строка игры по коду: загрузка + realtime + подстраховка опросом. */
export function useGameSession(code: string | null) {
  const [session, setSession] = useState<GameSession | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');

  const refetch = useCallback(async () => {
    if (!code) return;
    const { data } = await supabase.from('game_sessions').select('*').eq('code', code).maybeSingle();
    if (data) { setSession(normalize(data)); setState('ready'); }
    else setState((s) => (s === 'ready' ? s : 'missing'));
  }, [code]);

  useEffect(() => {
    if (!code) return;
    setSession(null); setState('loading');
    refetch();
    const ch = supabase
      .channel(`game-${code}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_sessions', filter: `code=eq.${code}` }, (payload: any) => {
        if (payload.eventType === 'DELETE') { setState('missing'); return; }
        if (payload.new && payload.new.board !== undefined) { setSession(normalize(payload.new)); setState('ready'); }
        else refetch();
      })
      .subscribe();
    const poll = setInterval(refetch, 4000);
    return () => { clearInterval(poll); supabase.removeChannel(ch); };
  }, [code, refetch]);

  return { session, state, refetch };
}

/** Секунд до конца таймера (по серверным часам), обновляется 4 раза в секунду. */
export function useTimerLeft(timer: GameTimer, now: () => number): number {
  const calc = () => (timer.running && timer.endsAt ? Math.max(0, Math.ceil((timer.endsAt - now()) / 1000)) : timer.left);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!timer.running) return;
    const id = setInterval(() => setLeft(calc()), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.running, timer.endsAt, timer.left]);
  return left;
}

/** Очередь на ответ: порядок нажатий без команд, уже ответивших неверно */
export function queueOf(buzz: GameBuzz[], q: GameQ | null): GameBuzz[] {
  const wrong = q?.wrong ?? [];
  return buzz.filter((b) => !wrong.includes(b.n));
}

export const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export const signed = (n: number) => (n < 0 ? '−' : '') + Math.abs(n);

export function beep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.15;
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.22);
    setTimeout(() => { try { ac.close(); } catch { /* ignore */ } }, 400);
  } catch { /* ignore */ }
}
