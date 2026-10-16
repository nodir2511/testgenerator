import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export type Lang = 'both' | 'ru' | 'tj';

export interface GameTeam { n: number; name: string }
export interface GameBuzz { n: number; t: number }
export type QMode = 'buzz' | 'cat' | 'bids' | 'answer';
/** Публичная раскладка табло (без вопросов и ответов) */
export interface LayoutCat { name: string; nt: string; values: number[] }
export interface LayoutRound { id: string; tab: string; tabt: string; sub: string; subt: string; cats: LayoutCat[] }
/** Текст вопроса для экранов; bank — вопрос из банка сайта (своя разметка формул) */
export interface QText { q: string; qt: string; options?: { ru: string; tj: string }[]; image?: string | null; bank?: boolean }
export interface GameQ {
  r: string; ci: number; qi: number; v: number; pts: number;
  cat: string; catt: string; tag?: string;
  text: QText;
  /** Ответ — только после «Показать ответ» */
  ans?: { a: string; at: string } | null;
  shown: boolean;
  wrong: number[];
  mode: QMode;
  /** «Кот в мешке»: кто передаёт вопрос */
  chooser?: number | null;
  /** Кто отвечает (кот, аукцион) */
  answerer?: number | null;
  /** Ставки аукциона, открываются после подведения */
  bids?: { n: number; amount: number }[] | null;
  /** Доп. вопрос: отвечать могут только эти команды */
  only?: number[] | null;
  extra?: boolean;
}
export interface GameTimer { running: boolean; left: number; endsAt: number | null; startedAt?: number | null }
export interface GameBoard {
  round: string;
  lang: Lang;
  layout: LayoutRound[];
  used: Record<string, Record<string, true>>;
  scores: Record<string, number>;
  /** Чья очередь выбирать вопрос */
  chooser: number | null;
  q: GameQ | null;
  timer: GameTimer;
  secs: number;
  showLink: boolean;
  final: boolean;
}
export interface GameInput { cat?: number; bidders?: number[]; fs?: number[] }
export interface GameSession {
  code: string;
  host_id: string;
  teams: GameTeam[];
  board: GameBoard;
  buzz: GameBuzz[];
  input: GameInput;
  created_at: string;
}

export const QUESTION_SECONDS = 30;
export const TIMER_CHOICES = [15, 30, 60];
export const MAX_TEAMS = 6;
export const FALSE_START_MS = 1500;

export function freshBoard(keep?: Partial<GameBoard>): GameBoard {
  return {
    round: keep?.round ?? 'r1',
    lang: keep?.lang ?? 'both',
    layout: keep?.layout ?? [],
    used: {},
    scores: {},
    chooser: null,
    q: null,
    timer: { running: false, left: keep?.secs ?? QUESTION_SECONDS, endsAt: null },
    secs: keep?.secs ?? QUESTION_SECONDS,
    showLink: false,
    final: false,
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
    input: row.input && typeof row.input === 'object' ? row.input : {},
    board: { ...base, ...b, q: b.q && b.q.text ? b.q : null, layout: Array.isArray(b.layout) ? b.layout : [], used: { ...base.used, ...(b.used || {}) }, timer: { ...base.timer, ...(b.timer || {}) } },
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
  return buzz.filter((b) => !wrong.includes(b.n) && (!q?.only || q.only.includes(b.n)));
}

/** Места: одинаковые очки — одно место */
export function standings(teams: GameTeam[], scores: Record<string, number>) {
  const list = teams.map((t) => ({ ...t, score: scores[t.n] ?? 0 })).sort((a, b) => b.score - a.score || a.n - b.n);
  return list.map((t) => ({ ...t, place: 1 + list.filter((x) => x.score > t.score).length }));
}

export const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export const signed = (n: number) => (n < 0 ? '−' : '') + Math.abs(n);

// Звук: один AudioContext, разблокируется первым касанием (иначе телефоны молчат)
let audio: AudioContext | null = null;
export function unlockAudio() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!audio) audio = new Ctx();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* ignore */ }
}
export function beep(freq = 880, ms = 220) {
  try {
    unlockAudio();
    if (!audio) return;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.15;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + ms / 1000);
  } catch { /* ignore */ }
}
