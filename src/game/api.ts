import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';

export type Lang = 'both' | 'ru' | 'tj';

export interface GameTeam { n: number; name: string }
export interface GameBuzz {
  n: number;
  /** Момент нажатия по серверным часам (мс): по нему строится очередь */
  t: number;
  /** номер вопроса, к которому относится нажатие */
  s?: number;
  /** Когда нажатие дошло до сервера (мс) */
  a?: number;
  /** Погрешность часов телефона в момент нажатия (мс) */
  e?: number;
}
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
  /** Текст вопроса скрыт (кот, аукцион): его знает только ведущий, в общие данные он попадает после ставок/передачи */
  hidden?: boolean;
  /** Номер открытия вопроса: нажатия, ставки и «кот» прошлых вопросов к нему не относятся */
  seq?: number;
  /** Команда, ответившая верно: вопрос ещё открыт, чтобы показать ответ классу */
  won?: number | null;
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
  /** Ведущий закрыл вход: новые команды не могут присоединиться (вернуться по коду можно) */
  joinClosed?: boolean;
  /** Версия табло и вкладка, которая его записала: нужны, чтобы несколько вкладок ведущего (ноутбук + телефон) не затирали друг друга */
  rev?: number;
  by?: string;
  /** Номер слайда мини-презентации перед QR-кодом (null — презентация закончена) */
  intro: number | null;
  /** Где в этой игре «Кот в мешке» и «Аукцион»: уровень → «ci-qi» → вид. Выбирается случайно при каждой новой игре. */
  specials: Record<string, Record<string, 'cat' | 'auction'>>;
  log: LogEntry[];
}
export interface GameInput { seq?: number; cat?: number; bidders?: number[]; fs?: number[] }
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
/** Отсчёт «3-2-1» перед приёмом ответов: все устройства успевают получить старт заранее */
export const START_COUNTDOWN_MS = 3000;
/** Сколько ждём запоздавших нажатий, прежде чем объявить, кто первый */
export const SETTLE_MS = 800;
/** Запас на задержку сенсорного экрана (мс на каждую из двух команд) при сравнении нажатий */
export const TOUCH_MS = 15;

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
    intro: null,
    specials: {},
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
    board: { ...base, ...b, specials: b.specials && typeof b.specials === 'object' ? b.specials : {}, lobby: b.lobby ?? Object.keys(b).length === 0, intro: b.intro !== undefined ? b.intro : Object.keys(b).length === 0 ? 0 : null, q: b.q && b.q.text ? b.q : null, log: Array.isArray(b.log) ? b.log : [], layout: Array.isArray(b.layout) ? b.layout : [], used: { ...base.used, ...(b.used || {}) }, timer: { ...base.timer, ...(b.timer || {}) } },
  };
}

export const playUrl = (code: string) => `${window.location.origin}/play/${code}`;
export const screenUrl = (code: string) => `${window.location.origin}/game/screen/${code}`;

// --- Единые часы: у всех устройств «сейчас» — это время сервера ---
// Системные часы телефона не используются: поправка к серверу вычисляется по нескольким пробам (берём самую быструю,
// у неё наименьшая погрешность), а ход времени между пробами считается по монотонным часам performance.now().

export interface ClockSample {
  /** Задержка запроса туда и обратно, мс */
  rtt: number;
  /** Время сервера в середине пробы, мс */
  server: number;
  /** performance.now() в середине пробы, мс */
  perf: number;
}
export interface ClockEstimate { server: number; perf: number; rtt: number }

export const CLOCK_PROBES = 7;
/** Пробы медленнее этого не вытесняют уже имеющуюся оценку */
export const MAX_GOOD_RTT_MS = 2000;
/** Запас на уход монотонных часов: 100 ppm = 0,1 мс на каждую секунду */
export const CLOCK_DRIFT_MS_PER_S = 0.1;

/** Самая быстрая проба */
export function bestSample(samples: ClockSample[]): ClockSample | null {
  let best: ClockSample | null = null;
  for (const s of samples) if (s.rtt >= 0 && (!best || s.rtt < best.rtt)) best = s;
  return best;
}
export const estimateAt = (e: ClockEstimate, perfNow: number) => e.server + (perfNow - e.perf);
/** Погрешность оценки: половина задержки пробы плюс уход часов с момента пробы */
export const estimateError = (e: ClockEstimate, perfNow: number) => e.rtt / 2 + (Math.max(0, perfNow - e.perf) / 1000) * CLOCK_DRIFT_MS_PER_S;
/** Новая оценка заменяет прежнюю, только если она точнее (или прежняя недействительна) */
export function mergeEstimate(prev: ClockEstimate | null, cand: ClockSample | null, perfNow: number, force = false): ClockEstimate | null {
  if (!cand) return prev;
  const next: ClockEstimate = { server: cand.server, perf: cand.perf, rtt: cand.rtt };
  if (!prev || force) return next;
  if (cand.rtt > MAX_GOOD_RTT_MS) return prev;
  return estimateError(next, perfNow) <= estimateError(prev, perfNow) ? next : prev;
}

export interface ClockInfo {
  synced: boolean;
  /** Задержка лучшей пробы, мс */
  rtt: number | null;
  /** Погрешность часов, мс */
  err: number | null;
}

let clockEst: ClockEstimate | null = null;
let clockInfo: ClockInfo = { synced: false, rtt: null, err: null };
let clockForce = false;
let clockUsers = 0;
let clockBusy = false;
let clockRounds = 0;
let clockTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenAt = 0;
const clockListeners = new Set<() => void>();

function publishClock() {
  clockInfo = clockEst
    ? { synced: true, rtt: Math.round(clockEst.rtt), err: Math.round(estimateError(clockEst, performance.now())) }
    : { synced: false, rtt: null, err: null };
  clockListeners.forEach((f) => f());
}

/** Сейчас по серверу, мс (до первой синхронизации — по системным часам) */
export const serverNow = (): number => (clockEst ? estimateAt(clockEst, performance.now()) : Date.now());

/** Серверное время для метки события (event.timeStamp на шкале performance.now); null, если часы ещё не синхронизированы */
export function serverTimeOfEvent(ts?: number): number | null {
  if (!clockEst) return null;
  const p = performance.now();
  const stamp = typeof ts === 'number' && ts > 0 && p - ts >= 0 && p - ts <= 1000 ? ts : p;
  return Math.round(estimateAt(clockEst, stamp));
}

async function clockRound() {
  if (clockBusy) return;
  clockBusy = true;
  try {
    const samples: ClockSample[] = [];
    for (let i = 0; i < CLOCK_PROBES; i++) {
      const p0 = performance.now();
      let value: unknown = null;
      try { const { data, error } = await supabase.rpc('game_time'); value = error ? null : data; } catch { value = null; }
      const p1 = performance.now();
      if (typeof value !== 'number') continue;
      samples.push({ rtt: p1 - p0, server: value, perf: (p0 + p1) / 2 });
      // хватит, если уже есть быстрая проба
      if (samples.length >= 3 && Math.min(...samples.map((x) => x.rtt)) < 40) break;
    }
    clockEst = mergeEstimate(clockEst, bestSample(samples), performance.now(), clockForce);
    if (samples.length) clockForce = false;
    publishClock();
  } finally {
    clockBusy = false;
  }
}

function scheduleClock() {
  if (clockTimer) clearTimeout(clockTimer);
  // первые минуты проверяем чаще, потом раз в 30 с
  clockTimer = setTimeout(async () => { await clockRound(); clockRounds++; scheduleClock(); }, clockRounds < 3 ? 8000 : 30000);
}
const onClockVisibility = () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  // после сна монотонные часы могли остановиться — прежнюю оценку не жалеем
  if (hiddenAt && Date.now() - hiddenAt > 5000) clockForce = true;
  hiddenAt = 0;
  clockRound();
};
const onClockOnline = () => { clockRound(); };

function startClock() {
  clockUsers++;
  if (clockUsers === 1) {
    clockRounds = 0;
    clockRound().then(scheduleClock);
    document.addEventListener('visibilitychange', onClockVisibility);
    window.addEventListener('online', onClockOnline);
  }
  return () => {
    clockUsers--;
    if (clockUsers === 0) {
      if (clockTimer) clearTimeout(clockTimer);
      clockTimer = null;
      document.removeEventListener('visibilitychange', onClockVisibility);
      window.removeEventListener('online', onClockOnline);
    }
  };
}

/** Серверные часы: возвращает функцию «сейчас по серверу, мс». Одна синхронизация на всю страницу. */
export function useServerClock(): () => number {
  useEffect(() => startClock(), []);
  return serverNow;
}

/** Состояние часов (задержка и погрешность) — обновляется после каждой синхронизации */
export function useClockInfo(): ClockInfo {
  return useSyncExternalStore(
    (cb) => { clockListeners.add(cb); return () => { clockListeners.delete(cb); }; },
    () => clockInfo,
  );
}

// --- Отсчёт «3-2-1» ---
/** Секунд до начала приёма (по серверным часам); 0 — приём идёт или таймер не запущен */
export function countdownLeft(timer: GameTimer, nowMs: number): number {
  if (!timer.running || !timer.startedAt || timer.startedAt <= nowMs) return 0;
  // отсчёт короче START_COUNTDOWN_MS: большие значения — это ещё не синхронизированные часы устройства
  return Math.min(Math.ceil(START_COUNTDOWN_MS / 1000), Math.ceil((timer.startedAt - nowMs) / 1000));
}
export function useCountdown(timer: GameTimer, now: () => number): number {
  const [v, setV] = useState(() => countdownLeft(timer, now()));
  useEffect(() => {
    const c = countdownLeft(timer, now());
    setV(c);
    if (c === 0) return;
    const id = setInterval(() => {
      const x = countdownLeft(timer, now());
      setV(x);
      if (x === 0) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.running, timer.startedAt]);
  return v;
}

// --- Порядок нажатий ---
/** Сколько ещё ждать запоздавших нажатий (мс), пока первое нажатие «свежее»; 0 — порядок можно объявлять */
export function settleLeft(queue: GameBuzz[], nowMs: number): number {
  const a = queue[0]?.a;
  // не больше SETTLE_MS, даже если часы устройства ещё не синхронизированы и «сейчас» сильно отстаёт
  return a == null ? 0 : Math.min(SETTLE_MS, Math.max(0, a + SETTLE_MS - nowMs));
}
/** true, когда порядок нажатий можно показывать (запоздавшие пакеты успели дойти) */
export function useSettled(queue: GameBuzz[], now: () => number): boolean {
  const [, force] = useState(0);
  const left = settleLeft(queue, now());
  const key = queue[0] ? `${queue[0].n}-${queue[0].a}` : '';
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => force((x) => x + 1), left + 30);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, left > 0]);
  return left <= 0;
}

export interface CloseCall { a: number; b: number; gap: number; margin: number }
/** Первые два нажатия «почти одновременны»: разница меньше суммы погрешностей часов и запаса на сенсор */
export function closeCall(queue: GameBuzz[]): CloseCall | null {
  if (queue.length < 2) return null;
  const [x, y] = queue;
  const gap = y.t - x.t;
  const margin = (x.e ?? 0) + (y.e ?? 0) + 2 * TOUCH_MS;
  return gap < margin ? { a: x.n, b: y.n, gap, margin } : null;
}

// --- Связь команд (для ведущего) ---
export interface TeamNet { rtt: number; err: number; /** секунд с последнего отчёта */ age: number }
export type NetLevel = 'good' | 'fair' | 'bad' | 'none';
export function netLevel(n: TeamNet | undefined): NetLevel {
  if (!n || n.age > 90) return 'none';
  if (n.err > 250 || n.rtt > 500) return 'bad';
  if (n.err > 80 || n.rtt > 200) return 'fair';
  return 'good';
}
/** Связь команд: ведущий опрашивает сервер раз в 5 с */
export function useTeamNet(code: string): Record<string, TeamNet> {
  const [net, setNet] = useState<Record<string, TeamNet>>({});
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('game_net_get', { p_code: code });
        if (!dead && !error && data && typeof data === 'object') setNet(data as Record<string, TeamNet>);
      } catch { /* связь вернётся — обновимся */ }
    };
    load();
    const id = setInterval(load, 5000);
    return () => { dead = true; clearInterval(id); };
  }, [code]);
  return net;
}

/** Строка игры по коду: загрузка + realtime + подстраховка опросом. */
export function useGameSession(code: string | null) {
  const [session, setSession] = useState<GameSession | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [connected, setConnected] = useState(true);
  const fails = useRef(0);
  const failed = () => { fails.current += 1; if (fails.current >= 2) setConnected(false); };

  const refetch = useCallback(async () => {
    if (!code) return;
    try {
      const { data, error } = await supabase.from('game_sessions').select('*').eq('code', code).maybeSingle();
      if (error) { failed(); return; }
      fails.current = 0;
      setConnected(true);
      if (data) { setSession(normalize(data)); setState('ready'); }
      else setState((s) => (s === 'ready' ? s : 'missing'));
    } catch { failed(); }
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
  const calc = () => {
    if (!timer.running || !timer.endsAt) return timer.left;
    const t = now();
    if (timer.startedAt && t < timer.startedAt) return timer.left; // идёт отсчёт «3-2-1»: время вопроса ещё не пошло
    return Math.max(0, Math.ceil((timer.endsAt - t) / 1000));
  };
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
  if (!q) return [];
  const wrong = q.wrong ?? [];
  return buzz.filter((b) => (q.seq == null || b.s === q.seq) && !wrong.includes(b.n) && (!q.only || q.only.includes(b.n)));
}

/** Действия команд (кот, ставки, фальстарты) — только если они относятся к открытому сейчас вопросу */
export function inputOf(input: GameInput, q: GameQ | null): GameInput {
  if (!q) return {};
  if (q.seq != null && input.seq !== q.seq) return {};
  return input;
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

/** Случайно выбирает на каждом уровне по одной клетке «Кот в мешке» и «Аукцион» (не занятые уже сыгранными) */
export function pickSpecials(layout: LayoutRound[], used: GameBoard['used'] = {}): GameBoard['specials'] {
  const out: GameBoard['specials'] = {};
  for (const r of layout) {
    const cells: string[] = [];
    r.cats.forEach((c, ci) => c.values.forEach((_v, qi) => { if (!used[r.id]?.[ci + '-' + qi]) cells.push(ci + '-' + qi); }));
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    out[r.id] = {};
    if (cells[0]) out[r.id][cells[0]] = 'cat';
    if (cells[1]) out[r.id][cells[1]] = 'auction';
  }
  return out;
}
