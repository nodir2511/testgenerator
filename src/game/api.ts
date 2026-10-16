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
/** Итог сыгранного вопроса для разбора после игры (ответов здесь нет) */
export interface LogEntry { r: string; ci: number; qi: number; v: number; res: 'ok' | 'none'; n?: number; wrong: number[] }
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
  /** Ожидание команд перед началом: ведущий и проектор показывают QR, команды читают правила */
  lobby: boolean;
  log: LogEntry[];
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
    lobby: false,
    log: [],
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
    board: { ...base, ...b, lobby: b.lobby ?? Object.keys(b).length === 0, q: b.q && b.q.text ? b.q : null, log: Array.isArray(b.log) ? b.log : [], layout: Array.isArray(b.layout) ? b.layout : [], used: { ...base.used, ...(b.used || {}) }, timer: { ...base.timer, ...(b.timer || {}) } },
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
  const [connected, setConnected] = useState(true);

  const refetch = useCallback(async () => {
    if (!code) return;
    try {
      const { data, error } = await supabase.from('game_sessions').select('*').eq('code', code).maybeSingle();
      if (error) { setConnected(false); return; }
      setConnected(true);
      if (data) { setSession(normalize(data)); setState('ready'); }
      else setState((s) => (s === 'ready' ? s : 'missing'));
    } catch { setConnected(false); }
  }, [code]);

  // браузер сообщил о потере/возврате сети — проверяем сразу
  useEffect(() => {
    const off = () => setConnected(false);
    const on = () => { refetch(); };
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => { window.removeEventListener('offline', off); window.removeEventListener('online', on); };
  }, [refetch]);

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

  return { session, state, refetch, connected };
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

/** Не даёт экрану погаснуть, пока открыта страница игры (Wake Lock; где не поддерживается — просто ничего не делает) */
export function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let dead = false;
    const take = async () => {
      try {
        const wl = (navigator as any).wakeLock;
        if (!wl || document.visibilityState !== 'visible' || lock) return;
        lock = await wl.request('screen');
        if (dead) { lock?.release(); lock = null; return; }
        (lock as any).addEventListener?.('release', () => { lock = null; });
      } catch { /* ignore */ }
    };
    take();
    const onVis = () => { if (document.visibilityState === 'visible') take(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { dead = true; document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => undefined); };
  }, []);
}

/** Цвета команд: один и тот же на телефоне, проекторе, в очереди и на пьедестале */
export const TEAM_COLORS = ['#E5484D', '#2F9E44', '#3B82F6', '#F59F00', '#9C36B5', '#0CA8A8'];
export const teamColor = (n: number) => TEAM_COLORS[(Math.max(1, n) - 1) % TEAM_COLORS.length];

// --- звуки проектора ---
type Tone = { f: number; d: number; at?: number; type?: OscillatorType; v?: number };
function playTones(tones: Tone[]) {
  try {
    unlockAudio();
    if (!audio) return;
    const t0 = audio.currentTime;
    tones.forEach((t) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      const start = t0 + (t.at ?? 0);
      o.type = t.type ?? 'sine';
      o.frequency.value = t.f;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(t.v ?? 0.2, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + t.d);
      o.connect(g); g.connect(audio!.destination);
      o.start(start); o.stop(start + t.d + 0.05);
    });
  } catch { /* ignore */ }
}
export type SoundKind = 'open' | 'tick' | 'gong' | 'fanfare' | 'buzz';
export function playSound(kind: SoundKind) {
  if (kind === 'open') playTones([{ f: 523, d: 0.25, type: 'triangle' }, { f: 659, d: 0.25, at: 0.15, type: 'triangle' }, { f: 784, d: 0.5, at: 0.3, type: 'triangle' }]);
  else if (kind === 'tick') playTones([{ f: 1500, d: 0.06, type: 'square', v: 0.08 }]);
  else if (kind === 'gong') playTones([{ f: 196, d: 1.8, v: 0.3 }, { f: 294, d: 1.4, v: 0.15 }, { f: 98, d: 2, v: 0.2 }]);
  else if (kind === 'buzz') playTones([{ f: 880, d: 0.18, type: 'square', v: 0.12 }]);
  else playTones([523, 659, 784, 1047].map((f, i) => ({ f, d: 0.35, at: i * 0.18, type: 'triangle' as OscillatorType })).concat([{ f: 1047, d: 1.2, at: 0.8, type: 'triangle' }, { f: 784, d: 1.2, at: 0.8, type: 'triangle' }, { f: 659, d: 1.2, at: 0.8, type: 'triangle' }]));
}
