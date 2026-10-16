import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { AuthModal } from '../components/AuthModal';
import { FormattedText } from '../components/FormulaEditor';
import { GameRound, INTRO_SLIDES, RULES, SPECIAL } from './content';
import { buildReview, exportXlsx, resultText, standingsRows, type ReviewRow } from './review';
import {
  GameBoard, GameQ, GameSession, GameTeam, Lang, LayoutRound, QMode, TIMER_CHOICES, beep, freshBoard, inputOf, pickSpecials, queueOf,
  screenUrl, signed, standings, useGameSession, useServerClock, useTimerLeft,
} from './api';
import {
  Bi, BoardGrid, BuzzQueue, GameShell, GameTitle, IntroOverlay, LinkOverlay, ModeStatus, Podium, QuestionBody, TeamGrid, TimerView, WonBanner,
  fmt, layoutRound, pick, tc, teamName, useLang,
} from './ui';

type View = string; // id уровня, 'rules', 'host' или 'history'
const PACK_ID = 'chem-1';

/** Вход ведущего: проверка роли, поиск/создание игры, загрузка пакета вопросов */
export const GameHost: React.FC = () => {
  const { user, isAdmin, isOwner, isLoading } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [pack, setPack] = useState<GameRound[] | null>(null);
  const [looking, setLooking] = useState(true);
  const [error, setError] = useState('');
  const allowed = !!user && (isAdmin || isOwner);

  useEffect(() => {
    if (!allowed || !user) { setLooking(false); return; }
    let dead = false;
    (async () => {
      const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
      const [{ data }, { data: p, error: pe }] = await Promise.all([
        supabase.from('game_sessions').select('code').eq('host_id', user.id)
          .gte('created_at', since).order('created_at', { ascending: false }).limit(1),
        supabase.from('game_packs').select('content').eq('id', PACK_ID).maybeSingle(),
      ]);
      if (dead) return;
      if (pe || !p) setError('Не найден пакет вопросов игры. Примените supabase/sql/game_pack_chemistry.sql.');
      else setPack((p.content as { rounds: GameRound[] }).rounds);
      setCode(data?.[0]?.code ?? null);
      setLooking(false);
    })();
    return () => { dead = true; };
  }, [allowed, user?.id]);

  const create = async () => {
    setError('');
    const { data, error: e } = await supabase.rpc('game_create');
    if (e) { setError(e.message); return; }
    setCode(data as string);
  };

  if (!isLoading && !looking && allowed && code && pack) {
    return <HostGame code={code} pack={pack} onNewCode={() => setCode(null)} />;
  }
  let body: React.ReactNode;
  if (isLoading || looking) body = <p>Загрузка…</p>;
  else if (!user) body = <AuthModal isOpen />;
  else if (!allowed) {
    body = (
      <div className="gate">
        <h1>Своя игра</h1>
        <p>Вести игру могут только администраторы.</p>
        <a className="btn" href="/">На сайт</a>
      </div>
    );
  } else if (!pack) {
    body = <div className="gate"><h1>Своя игра</h1><p className="gate-err">{error}</p></div>;
  } else {
    body = (
      <div className="gate">
        <h1><Bi ru="Своя игра по химии" tj="Викторинаи «Своя игра» аз химия" /></h1>
        <p>Создайте игру: команды зайдут по ссылке, а на проектор можно вывести отдельный экран.</p>
        <button className="btn primary" onClick={create}>Начать игру</button>
        {error && <p className="gate-err">{error}</p>}
      </div>
    );
  }
  return <GameShell lang="ru">{body}</GameShell>;
};

const HostGame: React.FC<{ code: string; pack: GameRound[]; onNewCode: () => void }> = ({ code, pack, onNewCode }) => {
  const { session, state, connected } = useGameSession(code);
  if (state === 'missing') {
    return <GameShell lang="ru"><div className="gate"><p>Игра не найдена или устарела.</p><button className="btn primary" onClick={onNewCode}>Создать новую</button></div></GameShell>;
  }
  if (!session) return <GameShell lang="ru"><p>Загрузка…</p></GameShell>;
  return <HostBoard session={session} pack={pack} connected={connected} />;
};

const layoutOf = (pack: GameRound[]): LayoutRound[] => pack.map((r) => ({
  id: r.id, tab: r.tab, tabt: r.tabt, sub: r.sub, subt: r.subt,
  cats: r.cats.map((c) => ({ name: c.name, nt: c.nt, values: c.qs.map((q) => q.v) })),
}));

const HostBoard: React.FC<{ session: GameSession; pack: GameRound[]; connected: boolean }> = ({ session, pack, connected }) => {
  const code = session.code;
  const now = useServerClock();
  const [board, setBoardState] = useState<GameBoard>(session.board);
  const boardRef = useRef<GameBoard>(session.board);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const clientId = useRef(Math.random().toString(36).slice(2, 10));
  const undoStack = useRef<GameBoard[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const extraKey = `game_extra_${session.code}`;
  const extraAns = useRef<{ a: string; at: string } | null>((() => { try { return JSON.parse(sessionStorage.getItem(extraKey) || 'null'); } catch { return null; } })());
  const [saveErr, setSaveErr] = useState('');
  const [view, setView] = useState<View>(session.board.round || pack[0]?.id || 'r1');
  const [confirmReset, setConfirmReset] = useState(false);
  const [tiePanel, setTiePanel] = useState<number[] | null>(null);
  const [fs, setFs] = useState(false);
  const [fsNote, setFsNote] = useState(false);

  // teams, buzz и input приходят с сервера; board пишем только мы
  const { teams, buzz } = session;
  const input = inputOf(session.input, board.q);
  const lang = board.lang;

  // коды команд для возврата — видит только ведущий
  const [pins, setPins] = useState<Record<string, string>>({});
  const teamKey = teams.map((t) => t.n).join(',');
  useEffect(() => {
    supabase.rpc('game_team_pins', { p_code: code }).then(({ data }) => setPins((data as Record<string, string>) || {}));
  }, [teamKey, code]);

  const commit = useCallback((fn: (b: GameBoard) => GameBoard, undoable = false) => {
    const prev = boardRef.current;
    const changed = fn(prev);
    if (changed === prev) return;
    const next: GameBoard = { ...changed, rev: (prev.rev ?? 0) + 1, by: clientId.current };
    if (undoable) { undoStack.current = [...undoStack.current.slice(-19), prev]; setCanUndo(true); }
    boardRef.current = next;
    setBoardState(next);
    writes.current = writes.current.then(() => pushBoard());
  }, [code]);

  // запись табло: всегда последняя версия; при сбое сети — повтор, пока не получится
  const pushBoard = async () => {
    for (let attempt = 0; ; attempt++) {
      const b = boardRef.current;
      const { data, error } = await supabase.from('game_sessions').update({ board: b }).eq('code', code).select('code');
      if (!error && data && data.length) { setSaveErr(''); return; }
      setSaveErr(error ? 'Нет связи с сервером — изменения сохранятся, когда связь вернётся' : 'Нет доступа к игре — войдите на сайт заново');
      if (!error) return; // 0 строк: вход истёк, повтор не поможет
      await new Promise((r) => setTimeout(r, Math.min(1000 * (attempt + 1), 5000)));
      if (boardRef.current !== b) continue; // за это время появились новые изменения — отправим их
    }
  };

  // вторая вкладка ведущего (телефон) изменила табло — берём её версию; последняя запись побеждает
  useEffect(() => {
    const inc = session.board;
    const cur = boardRef.current;
    if (!inc.by || inc.by === clientId.current) return;
    if ((inc.rev ?? 0) < (cur.rev ?? 0)) return;
    if (inc.rev === cur.rev && inc.by === cur.by) return;
    boardRef.current = inc;
    setBoardState(inc);
    undoStack.current = []; // «Отменить» не должна затирать изменения с другого устройства
    setCanUndo(false);
  }, [session.board]);

  const undo = () => {
    const prev = undoStack.current.pop();
    setCanUndo(undoStack.current.length > 0);
    if (prev) commit(() => prev);
  };

  // раскладка табло (без ответов) — для проектора
  useEffect(() => {
    const layout = layoutOf(pack);
    const cur = boardRef.current;
    const noSpecials = layout.some((r) => !cur.specials[r.id]);
    if (JSON.stringify(layout) !== JSON.stringify(cur.layout) || noSpecials) {
      commit((b) => ({ ...b, layout, specials: noSpecials ? pickSpecials(layout, b.used) : b.specials }));
    }
  }, [pack, commit]);

  const left = useTimerLeft(board.timer, now);
  // запрос Supabase уходит только после then/await — поэтому всегда вызываем then
  const rpc = (fn: string, args: Record<string, unknown>) =>
    supabase.rpc(fn, args).then((res) => { if (res.error) console.error(fn, res.error.message); return res; });

  const runTimer = (b: GameBoard, secs?: number): GameBoard => {
    const s = secs ?? (b.timer.left > 0 ? b.timer.left : b.secs);
    const t = Math.round(now());
    const resumed = b.timer.left < b.secs && !!b.timer.startedAt; // продолжение после паузы — блокировку фальстарта не повторяем
    return { ...b, timer: { running: true, left: s, endsAt: t + s * 1000, startedAt: resumed ? b.timer.startedAt : t } };
  };
  const stoppedTimer = (b: GameBoard) => ({ running: false, left: b.secs, endsAt: null, startedAt: null });

  // таймер дошёл до нуля
  useEffect(() => {
    if (!(board.timer.running && left <= 0)) return;
    const id = setTimeout(() => {
      if (!boardRef.current.timer.running) return;
      commit((b) => ({ ...b, timer: { running: false, left: 0, endsAt: null, startedAt: null } }));
      beep(440, 400);
    }, 150 + Math.random() * 500);
    return () => clearTimeout(id);
  }, [left, board.timer.running, commit]);

  // звук, когда появилось первое нажатие
  const firstSeen = useRef(0);
  const queue = queueOf(buzz, board.q);
  useEffect(() => {
    const n = queue[0]?.n ?? 0;
    if (n && n !== firstSeen.current) beep();
    firstSeen.current = n;
  }, [queue[0]?.n]);

  // «Кот в мешке»: команда выбрала, кому передать — отвечает она, запускаем таймер
  useEffect(() => {
    if (board.q?.mode !== 'cat' || input.cat == null) return;
    const id = setTimeout(() => {
      if (boardRef.current.q?.mode !== 'cat') return;
      commit((b) => (b.q ? runTimer({ ...b, q: revealQ({ ...b.q, mode: 'answer', answerer: input.cat ?? null }) }, b.secs) : b));
      beep();
    }, 150 + Math.random() * 500);
    return () => clearTimeout(id);
  }, [input.cat, board.q?.mode]);

  // «Аукцион»: все поставили — подводим итог
  const closingBids = useRef(false);
  const closeBids = async () => {
    if (closingBids.current || boardRef.current.q?.mode !== 'bids') return;
    closingBids.current = true;
    const { data } = await rpc('game_bids_get', { p_code: code });
    closingBids.current = false;
    const list = (Array.isArray(data) ? data : []) as { n: number; amount: number }[];
    const win = list.find((x) => x.amount > 0) ?? null;
    commit((b) => {
      if (!b.q || b.q.mode !== 'bids') return b;
      return runTimer({
        ...b,
        q: revealQ({ ...b.q, mode: 'answer', answerer: win?.n ?? null, pts: win?.amount ?? b.q.v, bids: list.map(({ n, amount }) => ({ n, amount })) }),
      }, b.secs);
    });
    beep();
  };
  useEffect(() => {
    if (board.q?.mode !== 'bids' || !teams.length) return;
    const bidders = input.bidders ?? [];
    if (!teams.every((t) => bidders.includes(t.n))) return;
    const id = setTimeout(() => closeBids(), 150 + Math.random() * 500);
    return () => clearTimeout(id);
  }, [input.bidders?.length, board.q?.mode, teams.length]);

  const findItem = (q: GameQ) => pack.find((r) => r.id === q.r)?.cats[q.ci]?.qs[q.qi];
  /** Вопрос «кота»/«аукциона» становится общим, когда ясно, кто отвечает */
  const revealQ = (q: GameQ): GameQ => {
    const it = q.hidden ? findItem(q) : null;
    return it ? { ...q, hidden: false, text: { q: it.q, qt: it.qt } } : q;
  };

  const openQ = (ci: number, qi: number) => {
    const r = pack.find((x) => x.id === view) ?? pack[0];
    const c = r.cats[ci];
    const item = c.qs[qi];
    const tag = boardRef.current.specials[r.id]?.[ci + '-' + qi];
    const mode: QMode = tag === 'cat' ? 'cat' : tag === 'auction' ? 'bids' : 'buzz';
    commit((b) => ({
      ...b,
      chooser: b.chooser ?? nextChooser(null),
      round: r.id,
      q: {
        r: r.id, ci, qi, v: item.v, pts: item.v, cat: c.name, catt: c.nt, tag, seq: Math.round(now()),
        text: mode === 'buzz' ? { q: item.q, qt: item.qt } : { q: '', qt: '' }, hidden: mode !== 'buzz', ans: null, shown: false, wrong: [], mode,
        chooser: mode === 'cat' ? b.chooser ?? nextChooser(null) : null, answerer: null, bids: null,
      },
      timer: stoppedTimer(b),
    }));
    rpc('game_buzz_clear', { p_code: code });
  };

  // очередь выбора вопроса: команды по кругу в порядке номеров
  const teamsRef = useRef(teams);
  teamsRef.current = teams;
  const nextChooser = (cur: number | null): number | null => {
    const ns = teamsRef.current.map((t) => t.n).sort((x, y) => x - y);
    if (!ns.length) return null;
    if (cur == null) return ns[0];
    return ns.find((n) => n > cur) ?? ns[0];
  };

  // первой выбирает команда с наименьшим номером
  useEffect(() => {
    if (teams.length && (boardRef.current.chooser == null || !teams.some((t) => t.n === boardRef.current.chooser))) {
      commit((b) => ({ ...b, chooser: nextChooser(null) }));
    }
  }, [teamKey]);

  const closedBoard = (b: GameBoard, markUsed: boolean): GameBoard => {
    const q = b.q;
    const winner = q?.won ?? undefined;
    const used = { ...b.used };
    let log = b.log;
    if (q && markUsed && !q.extra) {
      used[q.r] = { ...(used[q.r] || {}), [q.ci + '-' + q.qi]: true };
      log = [...b.log, { r: q.r, ci: q.ci, qi: q.qi, v: q.v, res: winner != null ? 'ok' : 'none', n: winner, wrong: q.wrong }];
    }
    const chooser = q && markUsed && !q.extra ? nextChooser(b.chooser) : b.chooser;
    return { ...b, used, log, chooser, q: null, timer: stoppedTimer(b), final: q?.extra ? true : b.final };
  };
  const afterClose = (wasExtra: boolean) => {
    rpc('game_buzz_clear', { p_code: code });
    if (wasExtra) saveResults();
  };
  const backToBoard = () => {
    const q = boardRef.current.q; if (!q) return;
    const started = boardRef.current.timer.running || boardRef.current.timer.left < boardRef.current.secs || queue.length > 0 || q.wrong.length > 0 || q.won != null;
    if (started && !window.confirm('Вернуть вопрос на табло? Нажатия команд сбросятся, а вопрос можно будет открыть заново.')) return;
    closeQ(false);
  };
  const closeQ = (markUsed: boolean) => {
    const wasExtra = !!boardRef.current.q?.extra;
    commit((b) => closedBoard(b, markUsed), markUsed);
    afterClose(wasExtra);
  };

  const patchQ = (p: Partial<GameQ>) => commit((b) => (b.q ? { ...b, q: { ...b.q, ...p } } : b));

  const answerOf = (q: GameQ) => {
    if (q.extra) return extraAns.current;
    const item = findItem(q);
    return item ? { a: item.a, at: item.at } : null;
  };
  const reveal = () => {
    const q = boardRef.current.q; if (!q) return;
    patchQ({ shown: true, ans: answerOf(q) });
  };

  const startTimer = () => commit((b) => runTimer(b));
  const pauseTimer = () => commit((b) => ({ ...b, timer: { running: false, left: Math.max(left, 0), endsAt: null, startedAt: b.timer.startedAt ?? null } }));
  const resetTimer = () => commit((b) => ({ ...b, timer: stoppedTimer(b) }));
  const setSecs = (s: number) => commit((b) => ({ ...b, secs: s, timer: b.timer.running ? b.timer : { running: false, left: s, endsAt: null, startedAt: null } }));

  const judge = (n: number, ok: boolean) => {
    const q = boardRef.current.q; if (!q) return;
    if (q.won != null) return;
    if (ok) {
      commit((b) => (b.q ? {
        ...b,
        scores: { ...b.scores, [n]: (b.scores[n] ?? 0) + b.q.pts },
        timer: { running: false, left: Math.max(left, 0), endsAt: null, startedAt: b.timer.startedAt ?? null },
        q: { ...revealQ(b.q), won: n, shown: true, ans: answerOf(b.q) },
      } : b), true);
    } else {
      commit((b) => ({
        ...b,
        scores: { ...b.scores, [n]: (b.scores[n] ?? 0) - q.pts },
        q: b.q ? { ...b.q, wrong: [...b.q.wrong, n] } : b.q,
      }), true);
      rpc('game_buzz_drop', { p_code: code, p_n: n });
    }
  };

  // «Кот в мешке» без телефона: ведущий отмечает, кто выбрал, или сразу кому передан
  const catChooser = (n: number) => commit((b) => (b.q ? { ...b, chooser: n, q: { ...b.q, chooser: n } } : b));
  const catGive = (n: number) => commit((b) => (b.q ? runTimer({ ...b, q: revealQ({ ...b.q, mode: 'answer', answerer: n }) }, b.secs) : b));
  const auctionGive = (n: number) => commit((b) => (b.q ? runTimer({ ...b, q: revealQ({ ...b.q, mode: 'answer', answerer: n }) }, b.secs) : b));

  const adjust = (n: number, d: number) => commit((b) => ({ ...b, scores: { ...b.scores, [n]: (b.scores[n] ?? 0) + d } }), true);
  const rename = (n: number, name: string) => { rpc('game_rename', { p_code: code, p_n: n, p_name: name }); };
  const setChooser = (n: number) => commit((b) => ({ ...b, chooser: n }));
  const removeTeam = (n: number) => {
    if (!window.confirm('Убрать команду из игры?')) return;
    rpc('game_remove_team', { p_code: code, p_n: n });
    commit((b) => {
      const scores = { ...b.scores }; delete scores[n];
      return { ...b, scores, chooser: b.chooser === n ? null : b.chooser };
    });
  };
  const resetGame = () => {
    // новая игра начинается с презентации и QR (команды остаются в списке)
    commit((b) => ({ ...freshBoard({ round: b.round, lang: b.lang, layout: b.layout, secs: b.secs }), specials: pickSpecials(b.layout), lobby: true, intro: 0 }), true);
    rpc('game_buzz_clear', { p_code: code });
    setConfirmReset(false);
  };

  const saveResults = async () => {
    const b = boardRef.current;
    const rows = standings(teams, b.scores).map((t) => ({ name: t.name, score: t.score, place: t.place }));
    if (!rows.length) return;
    const row = { code, session_started: session.created_at, round: b.round, title: layoutRound(b)?.tab ?? b.round, teams: rows, finished_at: new Date().toISOString() };
    const { error } = await supabase.from('game_results').upsert({ ...row, review: buildReview(b, pack, teams) }, { onConflict: 'code,session_started,round' });
    // если в базе ещё нет колонки review — сохраняем хотя бы результаты
    if (error) await supabase.from('game_results').upsert(row, { onConflict: 'code,session_started,round' });
  };
  const showFinal = () => { commit((b) => ({ ...b, final: true, showLink: false })); saveResults(); };

  // доп. вопрос из банка сайта
  const askExtra = (only: number[], text: GameQ['text'], ans: { a: string; at: string }) => {
    extraAns.current = ans;
    try { sessionStorage.setItem(extraKey, JSON.stringify(ans)); } catch { /* ignore */ }
    commit((b) => ({
      ...b,
      final: false,
      q: { r: 'extra', ci: -1, qi: -1, v: 100, pts: 100, cat: 'Дополнительный вопрос', catt: 'Саволи иловагӣ', text, ans: null, shown: false, wrong: [], mode: 'buzz', only, extra: true, seq: Math.round(now()) },
      timer: stoppedTimer(b),
    }));
    rpc('game_buzz_clear', { p_code: code });
    setTiePanel(null);
  };

  // клавиши: 1–6 — нажать за команду, Esc — вернуть вопрос на табло
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const b = boardRef.current;
      // презентация: стрелки и пробел листают слайды
      if (b.lobby && b.intro != null) {
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); commit((x) => ({ ...x, intro: (x.intro ?? 0) + 1 >= INTRO_SLIDES.length ? null : (x.intro ?? 0) + 1 })); }
        else if (e.key === 'ArrowLeft') commit((x) => ({ ...x, intro: Math.max(0, (x.intro ?? 0) - 1) }));
        return;
      }
      if (!b.q || e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key.length !== 1 || e.key < '1' || e.key > '6') return;
      const n = parseInt(e.key, 10);
      if (!teams.some((t) => t.n === n)) return;
      rpc('game_buzz', { p_code: code, p_n: n, p_secret: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // полный экран
  useEffect(() => {
    const on = () => setFs(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => { document.removeEventListener('fullscreenchange', on); document.removeEventListener('webkitfullscreenchange', on); };
  }, []);
  const toggleFs = () => {
    setFsNote(false);
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    const d = document.documentElement as any;
    const req = d.requestFullscreen || d.webkitRequestFullscreen;
    if (!req) { setFsNote(true); return; }
    try { const p = req.call(d); p?.catch?.(() => setFsNote(true)); } catch { setFsNote(true); }
  };

  const setLang = (l: Lang) => commit((b) => ({ ...b, lang: l }));
  const setRound = (id: string) => { commit((b) => ({ ...b, round: id })); setView(id); };
  const q = board.q;
  const viewBoard: GameBoard = q?.hidden ? (() => { const it = findItem(q); return it ? { ...board, q: { ...q, text: { q: it.q, qt: it.qt } } } : board; })() : board;
  const sortedTeams = [...teams].sort((a, b) => a.n - b.n);
  const first = queue[0]?.n;
  // «Показать ответ» появляется, когда кто-то ответил (нажал кнопку или ошибся) или время вышло
  const timerStarted = board.timer.running || left < board.secs;
  const canReveal = !!q && (queue.length > 0 || q.wrong.length > 0 || left <= 0 || (q.mode === 'answer' && timerStarted));
  const firstName = q?.mode === 'buzz' ? teamName(teams, first) : '';
  const isRound = pack.some((r) => r.id === view);
  const curRound = pack.find((r) => r.id === view);
  const roundUsed = curRound ? Object.keys(board.used[curRound.id] || {}).length : 0;
  const roundTotal = curRound ? curRound.cats.reduce((s, c) => s + c.qs.length, 0) : 0;
  const ties = tieGroups(teams, board.scores);

  return (
    <GameShell lang={lang} fs={fs}>
      <div className="app host-app">
        <header className="top">
          <div>
            <p className="eyebrow">
              {view === 'rules' ? <Bi ru="Как играть" tj="Тарзи бозӣ" /> : view === 'host' ? <Bi ru="Вопросы с ответами" tj="Саволҳо бо ҷавобҳо" /> :
                view === 'history' ? <Bi ru="Прошлые игры" tj="Бозиҳои гузашта" /> : view === 'review' ? <Bi ru="Разбор этой игры" tj="Таҳлили ин бозӣ" /> :
                curRound && <Bi ru={`${curRound.tab} · ${curRound.sub}`} tj={`${curRound.tabt} · ${curRound.subt}`} />}
            </p>
            <GameTitle />
          </div>
          <div className="top-ctl">
            <nav className="tabs" role="tablist">
              {pack.map((r) => (
                <button key={r.id} className="tab" role="tab" aria-selected={view === r.id} onClick={() => setRound(r.id)}><Bi ru={r.tab} tj={r.tabt} /></button>
              ))}
              <button className="tab" role="tab" aria-selected={view === 'rules'} onClick={() => setView('rules')}><Bi ru="Правила" tj="Қоидаҳо" /></button>
              <button className="tab" role="tab" aria-selected={view === 'host'} onClick={() => setView('host')}><Bi ru="Лист ведущего" tj="Варақаи пешбар" /></button>
              <button className="tab" role="tab" aria-selected={view === 'review'} onClick={() => setView('review')}><Bi ru="Разбор" tj="Таҳлил" /></button>
              <button className="tab" role="tab" aria-selected={view === 'history'} onClick={() => setView('history')}><Bi ru="История" tj="Таърих" /></button>
            </nav>
            <div className="seg" role="group">
              {([['both', 'RU + TJ'], ['ru', 'RU'], ['tj', 'TJ']] as [Lang, string][]).map(([l, t]) => (
                <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{t}</button>
              ))}
            </div>
            <button className="btn primary" onClick={() => commit((b) => ({ ...b, showLink: true }))}><Bi ru="Ссылка для команд" tj="Истинод барои дастаҳо" /></button>
            <a className="btn hide-phone" href={screenUrl(code)} target="_blank" rel="noreferrer"><Bi ru="Экран для проектора" tj="Экран барои проектор" /></a>
            <button className="btn hide-phone" onClick={toggleFs}>{fs ? <Bi ru="Выйти из полного экрана" tj="Аз экрани пурра баромадан" /> : <Bi ru="На весь экран" tj="Экрани пурра" />}</button>
          </div>
        </header>
        {(!connected || saveErr) && <p className="offline-note" role="alert">⚠ {saveErr || 'Нет связи с сервером — проверьте интернет'}</p>}
        {fsNote && <p className="host-note"><Bi ru="Браузер не разрешил полноэкранный режим. Нажмите F11." tj="Браузер экрани пурраро иҷозат надод. F11-ро пахш кунед." /></p>}

        <main>
          {isRound && <BoardGrid board={board} roundId={view} onPick={openQ} teams={teams} />}
          {isRound && roundTotal > 0 && roundUsed >= roundTotal && !board.final && (
            <p className="host-note done-note">
              <Bi ru="Все вопросы уровня сыграны." tj="Ҳамаи саволҳои сатҳ бозида шуданд." />{' '}
              <button className="btn primary" onClick={showFinal}><Bi ru="Показать итоги" tj="Натиҷаҳоро нишон диҳед" /></button>
            </p>
          )}
          {view === 'rules' && <RulesView />}
          {view === 'host' && <HostSheet pack={pack} specials={board.specials} />}
          {view === 'review' && <ReviewView rows={buildReview(board, pack, teams)} onExport={(rows) => exportXlsx('Игра', standingsRows(teams, board.scores), rows, `igra-${code}`)} />}
          {view === 'history' && <HistoryView />}
        </main>

        <section className="teams" aria-label="Команды">
          <div className="teams-head">
            <h2><Bi ru="Команды" tj="Дастаҳо" /> <span className="code-chip">{code}</span></h2>
            <div className="ctl">
              <button className="btn" onClick={undo} disabled={!canUndo}><Bi ru="↶ Отменить" tj="↶ Бекор кардан" /></button>
              <button className={`btn${board.joinClosed ? ' danger' : ''}`} onClick={() => commit((b) => ({ ...b, joinClosed: !b.joinClosed }))}>
                {board.joinClosed ? <Bi ru="🔒 Вход закрыт — открыть" tj="🔒 Воридшавӣ баста — кушодан" /> : <Bi ru="Закрыть вход" tj="Воридшавиро бастан" />}
              </button>
              <button className="btn" onClick={showFinal} disabled={!teams.length}><Bi ru="Итоги" tj="Натиҷаҳо" /></button>
              {confirmReset ? (
                <>
                  <span><Bi ru="Сбросить очки и табло?" tj="Холҳо ва ҷадвалро барқарор мекунед?" /></span>
                  <button className="btn danger" onClick={resetGame}><Bi ru="Да, начать заново" tj="Ҳа, аз нав оғоз" /></button>
                  <button className="btn" onClick={() => setConfirmReset(false)}><Bi ru="Отмена" tj="Бекор" /></button>
                </>
              ) : (
                <button className="btn" onClick={() => setConfirmReset(true)}><Bi ru="Новая игра" tj="Бозии нав" /></button>
              )}
            </div>
          </div>
          {teams.length === 0 ? (
            <p className="queue-empty"><Bi ru="Пока ни одна команда не зашла. Нажмите «Ссылка для команд» и покажите её классу." tj="Ҳоло ягон даста надаромадааст. «Истинод барои дастаҳо»-ро пахш карда, ба синф нишон диҳед." /></p>
          ) : (
            <TeamGrid teams={teams} scores={board.scores} chooser={board.chooser} pins={pins} editable={{ onRename: rename, onAdjust: adjust, onRemove: removeTeam, onChooser: setChooser }} />
          )}
        </section>
      </div>

      {q && (
        <div className="scrim">
          <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title" tabIndex={-1}>
            <QuestionBody board={viewBoard} />
            <WonBanner board={board} teams={teams} />
            {q.won != null && (
              <div className="start-zone">
                <button className="btn start-btn" onClick={() => closeQ(true)}><Bi ru="Закрыть вопрос →" tj="Саволро пӯшед →" /></button>
              </div>
            )}
            {q.won == null && (q.mode === 'buzz' || q.mode === 'answer') && (
              <>
              <div className="start-zone">
                <TimerView left={left} big />
                {board.timer.running
                  ? <button className="btn start-btn pause" onClick={pauseTimer}><Bi ru="Пауза" tj="Таваққуф" /></button>
                  : <button className="btn start-btn" onClick={startTimer} disabled={left <= 0 || (q.mode === 'answer' && !q.answerer)}>
                      {left === board.secs ? <Bi ru={q.mode === 'buzz' ? 'СТАРТ · приём ответов' : 'СТАРТ'} tj={q.mode === 'buzz' ? 'ОҒОЗ · қабули ҷавоб' : 'ОҒОЗ'} /> : <Bi ru="Продолжить" tj="Давом додан" />}
                    </button>}
                {!q.shown && canReveal && <button className="btn primary reveal-btn" onClick={reveal}><Bi ru="Показать ответ" tj="Ҷавобро нишон диҳед" /></button>}
              </div>
              <div className="tools">
                <button className="btn" onClick={resetTimer}><Bi ru="Сбросить таймер" tj="Таймерро аз нав кунед" /></button>
                <span className="seg secs" role="group" aria-label="Время на вопрос">
                  {TIMER_CHOICES.map((s) => <button key={s} aria-pressed={board.secs === s} onClick={() => setSecs(s)} disabled={board.timer.running}>{s} с</button>)}
                </span>
                <label className="pts"><Bi ru="Баллы" tj="Холҳо" />
                  <input type="number" step={100} value={q.pts} onChange={(e) => { const n = parseInt(e.target.value, 10); patchQ({ pts: isNaN(n) || n < 0 ? 0 : n }); }} />
                </label>
              </div>
              </>
            )}
            {q.mode !== 'buzz' && <ModeStatus board={board} teams={teams} bidders={input.bidders} />}
            {q.mode === 'cat' && (
              <div className="host-pick">
                {!q.chooser && <><span className="lab"><Bi ru="Кто выбрал этот вопрос?" tj="Ин саволро кӣ интихоб кард?" /></span>
                  <div className="chips-btn">{sortedTeams.map((t) => <button className="btn" key={t.n} onClick={() => catChooser(t.n)}>{t.name}</button>)}</div></>}
                <span className="lab"><Bi ru="Или сразу передать команде (если у неё нет телефона):" tj="Ё фавран ба даста диҳед (агар телефон надошта бошад):" /></span>
                <div className="chips-btn">{sortedTeams.filter((t) => t.n !== q.chooser).map((t) => <button className="btn" key={t.n} onClick={() => catGive(t.n)}>{t.name}</button>)}</div>
              </div>
            )}
            {q.mode === 'bids' && (
              <div className="host-pick">
                <div className="chips-btn">
                  {sortedTeams.map((t) => <span key={t.n} className={`bid-chip${(input.bidders ?? []).includes(t.n) ? ' done' : ''}`} style={tc(t.n)}>{t.name}{(input.bidders ?? []).includes(t.n) ? ' ✓' : ''}</span>)}
                </div>
                <button className="btn primary" onClick={closeBids}><Bi ru="Подвести ставки" tj="Ҷамъбасти нархҳо" /></button>
              </div>
            )}
            {q.mode === 'answer' && !q.answerer && (
              <div className="host-pick">
                <span className="lab"><Bi ru="Кто отвечает?" tj="Кӣ ҷавоб медиҳад?" /></span>
                <div className="chips-btn">{sortedTeams.map((t) => <button className="btn" key={t.n} onClick={() => auctionGive(t.n)}>{t.name}</button>)}</div>
              </div>
            )}
            {q.mode === 'buzz' && q.won == null && board.timer.running && <p className="armed" role="status"><Bi ru="Приём ответов открыт: команды видят кнопку «Ответить»" tj="Қабули ҷавоб кушода аст: дастаҳо тугмаи «Ҷавоб додан»-ро мебинанд" /></p>}
            {q.mode === 'buzz' && (input.fs ?? []).length > 0 && (
              <p className="fs-note"><Bi ru={<>Фальстарт: {(input.fs ?? []).map((n) => teamName(teams, n)).join(', ')}</>} tj={<>Пеш аз вақт: {(input.fs ?? []).map((n) => teamName(teams, n)).join(', ')}</>} /></p>
            )}
            {firstName && q.won == null && <p className="buzz" role="status"><Bi ru={<>Первой отвечает: <b>{firstName}</b></>} tj={<>Аввал ҷавоб медиҳад: <b>{firstName}</b></>} /></p>}
            {q.mode === 'buzz' && q.won == null && <BuzzQueue board={board} teams={teams} buzz={buzz} />}
            <div className="judge">
              {sortedTeams.filter((t) => !q.only || q.only.includes(t.n)).map((t) => {
                const w = q.wrong.includes(t.n);
                const hot = q.mode === 'answer' ? q.answerer === t.n : first === t.n;
                return (
                  <div className={`judge-row${w ? ' done' : ''}${hot ? ' first' : ''}`} key={t.n} style={tc(t.n)}>
                    <div className="jn"><kbd>{t.n}</kbd><span className="nm">{t.name}</span></div>
                    <div className="jb">
                      <button className="ok" disabled={w || q.won != null} onClick={() => judge(t.n, true)}>✓ +{q.pts}</button>
                      <button className="no" disabled={w || q.won != null} onClick={() => judge(t.n, false)}>✗ −{q.pts}</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="dlg-foot">
              <button className="btn" onClick={backToBoard}><Bi ru="Вернуть на табло" tj="Ба ҷадвал баргардонед" /></button>
              {canUndo && <button className="btn" onClick={undo}><Bi ru="↶ Отменить" tj="↶ Бекор кардан" /></button>}
              <button className="btn primary" onClick={() => closeQ(true)}>
                {q.won != null || q.shown ? <Bi ru="Закрыть вопрос" tj="Саволро пӯшед" /> : <Bi ru="Никто не ответил, закрыть" tj="Касе ҷавоб надод, пӯшед" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {board.final && !q && (
        <div className="scrim">
          <div className="dlg">
            <Podium board={board} teams={teams} />
            {ties.length > 0 && !tiePanel && (
              <div className="host-pick">
                <span className="lab"><Bi ru="Одинаковые очки — можно задать дополнительный вопрос из банка сайта:" tj="Холҳо баробаранд — аз бонки саволҳои сайт саволи иловагӣ додан мумкин:" /></span>
                <div className="chips-btn">
                  {ties.map((g) => (
                    <button className="btn primary" key={g.join('-')} onClick={() => setTiePanel(g)}>
                      {g.map((n) => teamName(teams, n)).join(' — ')} ({signed(board.scores[g[0]] ?? 0)})
                    </button>
                  ))}
                </div>
              </div>
            )}
            {tiePanel && <TieBreak teams={teams} only={tiePanel} onAsk={askExtra} onCancel={() => setTiePanel(null)} />}
            <div className="dlg-foot">
              <button className="btn" onClick={() => commit((b) => ({ ...b, final: false }))}><Bi ru="Вернуться к табло" tj="Ба ҷадвал баргаштан" /></button>
            </div>
          </div>
        </div>
      )}

      {board.lobby && board.intro != null && (
        <IntroOverlay
          index={board.intro}
          controls={{
            onPrev: () => commit((b) => ({ ...b, intro: Math.max(0, (b.intro ?? 0) - 1) })),
            onNext: () => commit((b) => ({ ...b, intro: (b.intro ?? 0) + 1 >= INTRO_SLIDES.length ? null : (b.intro ?? 0) + 1 })),
            onSkip: () => commit((b) => ({ ...b, intro: null })),
            projectorHref: screenUrl(code),
          }}
        />
      )}
      {board.lobby && board.intro == null && (
        <LinkOverlay
          code={code}
          teams={teams}
          onRemove={removeTeam}
          footer={
            <div className="lobby-actions">
              <button className="btn primary lobby-start" disabled={teams.length < 1} onClick={() => commit((b) => ({ ...b, lobby: false, showLink: false }))}>
                <Bi ru={teams.length ? `Начать игру (команд: ${teams.length})` : 'Ждём команды…'} tj={teams.length ? `Оғози бозӣ (дастаҳо: ${teams.length})` : 'Интизори дастаҳо…'} />
              </button>
              <button className="btn" onClick={() => commit((b) => ({ ...b, intro: 0 }))}><Bi ru="← Презентация" tj="← Муаррифӣ" /></button>
              <button className={`btn${board.joinClosed ? ' danger' : ''}`} onClick={() => commit((b) => ({ ...b, joinClosed: !b.joinClosed }))}>
                {board.joinClosed ? <Bi ru="🔒 Вход закрыт — открыть" tj="🔒 Воридшавӣ баста — кушодан" /> : <Bi ru="Закрыть вход" tj="Воридшавиро бастан" />}
              </button>
              <a className="btn" href={screenUrl(code)} target="_blank" rel="noreferrer"><Bi ru="Экран для проектора" tj="Экран барои проектор" /></a>
            </div>
          }
        />
      )}
      {!board.lobby && board.showLink && <LinkOverlay code={code} teams={teams} onClose={() => commit((b) => ({ ...b, showLink: false }))} />}
    </GameShell>
  );
};

/** Группы команд с одинаковыми очками (от лидеров вниз) */
function tieGroups(teams: GameTeam[], scores: Record<string, number>): number[][] {
  const by = new Map<number, number[]>();
  teams.forEach((t) => { const s = scores[t.n] ?? 0; by.set(s, [...(by.get(s) || []), t.n]); });
  return [...by.entries()].filter(([, ns]) => ns.length > 1).sort((a, b) => b[0] - a[0]).map(([, ns]) => ns.sort((a, b) => a - b));
}

interface BankQuestion {
  id: string; type: 'test' | 'open' | 'matching'; content: string; content_ru: string | null; content_tg: string | null;
  image_url: string | null; correct_numeric_answer: string | number | null;
  options: { text: string; text_ru: string | null; text_tg: string | null; is_correct: boolean | null; order_index: number }[];
}

/** Доп. вопрос из банка сайта: предмет → случайный вопрос (тест или открытый) → задать */
const TieBreak: React.FC<{ teams: GameTeam[]; only: number[]; onAsk: (only: number[], text: GameQ['text'], ans: { a: string; at: string }) => void; onCancel: () => void }> = ({ teams, only, onAsk, onCancel }) => {
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [subject, setSubject] = useState('');
  const [chapters, setChapters] = useState<{ id: string; name: string }[]>([]);
  const [chapter, setChapter] = useState('');
  const [pool, setPool] = useState<BankQuestion[]>([]);
  const [cur, setCur] = useState<BankQuestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.from('subjects').select('id,name').eq('is_deleted', false).order('name').then(({ data }) => setSubjects(data || []));
  }, []);
  useEffect(() => {
    setChapters([]); setChapter(''); setPool([]); setCur(null);
    if (!subject) return;
    supabase.from('chapters').select('id,name').eq('subject_id', subject).eq('is_deleted', false).order('order_index').then(({ data }) => setChapters(data || []));
  }, [subject]);

  const load = async () => {
    setLoading(true); setErr('');
    let query = supabase.from('questions')
      .select('id,type,content,content_ru,content_tg,image_url,correct_numeric_answer,options:question_options(text,text_ru,text_tg,is_correct,order_index)')
      .eq('subject_id', subject).eq('is_deleted', false).in('type', ['test', 'open']).limit(300);
    if (chapter) query = query.eq('chapter_id', chapter);
    const { data, error } = await query;
    setLoading(false);
    if (error) { setErr(error.message); return; }
    const list = ((data || []) as unknown as BankQuestion[]).filter((x) =>
      x.type === 'open' ? x.correct_numeric_answer != null && String(x.correct_numeric_answer) !== '' : x.options?.some((o) => o.is_correct));
    if (!list.length) { setErr('В этом разделе нет подходящих вопросов (тест с верным ответом или открытый с числовым ответом).'); return; }
    setPool(list);
    setCur(list[Math.floor(Math.random() * list.length)]);
  };
  const another = () => { if (pool.length) setCur(pool[Math.floor(Math.random() * pool.length)]); };

  const toGame = (x: BankQuestion) => {
    const opts = [...(x.options || [])].sort((a, b) => a.order_index - b.order_index);
    const text: GameQ['text'] = {
      bank: true,
      q: x.content_ru || x.content,
      qt: x.content_tg || '',
      image: x.image_url,
      options: x.type === 'test' ? opts.map((o) => ({ ru: o.text_ru || o.text, tj: o.text_tg || '' })) : undefined,
    };
    let a = ''; let at = '';
    if (x.type === 'test') {
      const i = opts.findIndex((o) => o.is_correct);
      const o = opts[i];
      a = `${String.fromCharCode(65 + i)}) ${o.text_ru || o.text}`;
      at = o.text_tg ? `${String.fromCharCode(65 + i)}) ${o.text_tg}` : '';
    } else {
      a = String(x.correct_numeric_answer);
    }
    return { text, ans: { a, at } };
  };

  const g = cur ? toGame(cur) : null;
  return (
    <div className="tiebreak">
      <p className="lab"><Bi ru={<>Дополнительный вопрос для: <b>{only.map((n) => teamName(teams, n)).join(', ')}</b></>} tj={<>Саволи иловагӣ барои: <b>{only.map((n) => teamName(teams, n)).join(', ')}</b></>} /></p>
      <div className="tb-row">
        <select value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">— предмет —</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={chapter} onChange={(e) => setChapter(e.target.value)} disabled={!chapters.length}>
          <option value="">все разделы</option>
          {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn" onClick={load} disabled={!subject || loading}>{loading ? '…' : 'Взять вопрос'}</button>
      </div>
      {err && <p className="gate-err">{err}</p>}
      {cur && g && (
        <div className="tb-preview">
          <p className="tb-q"><FormattedText text={g.text.q} /></p>
          {g.text.qt && <p className="tb-q t"><FormattedText text={g.text.qt} /></p>}
          {g.text.options && <ol className="q-opts small">{g.text.options.map((o, i) => <li key={i}><span className="q-opt-l">{String.fromCharCode(65 + i)}</span><FormattedText text={o.ru} /></li>)}</ol>}
          <p className="tb-a"><b>Ответ:</b> <FormattedText text={g.ans.a} /></p>
          <div className="chips-btn">
            <button className="btn primary" onClick={() => onAsk(only, g.text, g.ans)}>Задать этот вопрос</button>
            <button className="btn" onClick={another}>Другой вопрос</button>
          </div>
        </div>
      )}
      <div className="chips-btn"><button className="btn" onClick={onCancel}>Отмена</button></div>
    </div>
  );
};

interface ResultRow { id: string; code: string; title: string | null; round: string; finished_at: string; teams: { name: string; score: number; place: number }[]; review?: ReviewRow[] | null }

const ReviewView: React.FC<{ rows: ReviewRow[]; onExport: (rows: ReviewRow[]) => void }> = ({ rows, onExport }) => {
  const [f, setF] = useState<'all' | 'none' | 'wrong'>('all');
  const shown = rows.filter((r) => f === 'all' || (f === 'none' ? r.res === 'none' : r.wrong.length > 0));
  return (
    <div className="review">
      <div className="review-bar">
        <span className="seg" role="group">
          <button aria-pressed={f === 'all'} onClick={() => setF('all')}>Все ({rows.length})</button>
          <button aria-pressed={f === 'none'} onClick={() => setF('none')}>Без ответа ({rows.filter((r) => r.res === 'none').length})</button>
          <button aria-pressed={f === 'wrong'} onClick={() => setF('wrong')}>Были ошибки ({rows.filter((r) => r.wrong.length > 0).length})</button>
        </span>
        <button className="btn primary" disabled={!rows.length} onClick={() => onExport(rows)}>Выгрузить в Excel</button>
      </div>
      {!rows.length && <p className="queue-empty"><Bi ru="Пока нет сыгранных вопросов" tj="Ҳоло саволи бозидашуда нест" /></p>}
      <ol className="review-list">
        {shown.map((r, i) => (
          <li key={i} className={r.res === 'ok' && !r.wrong.length ? 'ok' : r.res === 'none' ? 'none' : 'mix'}>
            <div className="rv-head"><b>{r.cat}</b><span className="rv-v">{r.v}</span><span className="rv-res">{resultText(r)}</span></div>
            <p className="rv-q">{r.q}</p>
            <p className="rv-a"><b>Ответ:</b> {r.a}</p>
          </li>
        ))}
      </ol>
    </div>
  );
};

const HistoryView: React.FC = () => {
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  useEffect(() => {
    supabase.from('game_results').select('id,code,title,round,finished_at,teams,review').order('finished_at', { ascending: false }).limit(100)
      .then(({ data }) => setRows((data || []) as ResultRow[]));
  }, []);
  if (!rows) return <p>Загрузка…</p>;
  if (!rows.length) return <p className="queue-empty"><Bi ru="Пока нет сохранённых игр. Итоги сохраняются по кнопке «Итоги»." tj="Ҳоло бозиҳои сабтшуда нест. Натиҷаҳо бо тугмаи «Натиҷаҳо» сабт мешаванд." /></p>;
  return (
    <div className="history">
      {rows.map((r) => (
        <article className="hist" key={r.id}>
          <header>
            <b>{new Date(r.finished_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</b>
            <span>{r.title || r.round}</span>
            <span className="code-chip">{r.code}</span>
          </header>
          <ol>
            {r.teams.map((t, i) => <li key={i}><b>{t.place}.</b> {t.name} — {signed(t.score)}</li>)}
          </ol>
          <button className="btn" onClick={() => exportXlsx(r.title || r.round, r.teams, r.review ?? [], `igra-${r.code}-${r.finished_at.slice(0, 10)}`)}>Excel</button>
        </article>
      ))}
    </div>
  );
};

const RulesView: React.FC = () => {
  const lang = useLang();
  const col = (l: 'ru' | 'tj') => {
    const R = RULES[l];
    return (
      <article className="rcol" lang={l === 'tj' ? 'tg' : 'ru'} key={l}>
        <h2>{R.h}</h2>
        {R.blocks.map((b) => {
          const items = (b.ol || b.ul || []).map((x, i) => <li key={i}>{x}</li>);
          return <React.Fragment key={b.t}><h3>{b.t}</h3>{b.ol ? <ol>{items}</ol> : <ul>{items}</ul>}</React.Fragment>;
        })}
      </article>
    );
  };
  if (lang === 'ru') return <div className="rules one">{col('ru')}</div>;
  if (lang === 'tj') return <div className="rules one">{col('tj')}</div>;
  return <div className="rules">{col('ru')}{col('tj')}</div>;
};

const HostSheet: React.FC<{ pack: GameRound[]; specials: GameBoard['specials'] }> = ({ pack, specials }) => {
  const lang = useLang();
  const blk = (ru: React.ReactNode, tj: React.ReactNode) => lang === 'ru' ? <span>{ru}</span> : lang === 'tj' ? <span>{tj}</span> : <><span>{ru}</span><span className="t" lang="tg">{tj}</span></>;
  return (
    <div className="host">
      <p className="host-note"><Bi ru="Этот раздел для ведущего: здесь все вопросы с ответами. Не выводите его на экран для класса." tj="Ин бахш барои пешбар аст: дар ин ҷо ҳамаи саволҳо бо ҷавобҳо ҳастанд. Онро барои синф ба экран набароред." /></p>
      {pack.map((r) => (
        <section key={r.id}>
          <h2><Bi ru={r.tab} tj={r.tabt} /></h2>
          <p className="eyebrow"><Bi ru={r.sub} tj={r.subt} /></p>
          {r.cats.map((c, ci) => (
            <React.Fragment key={c.name}>
              <h3><Bi ru={c.name} tj={c.nt} /></h3>
              <ol>
                {c.qs.map((q, qi) => { const tag = specials[r.id]?.[ci + '-' + qi]; return (
                  <li key={q.v}>
                    <span className="hv">{q.v}</span>
                    <span className="hq">
                      {blk(<><span dangerouslySetInnerHTML={{ __html: fmt(q.q) }} />{tag && <> <span className="badge">{pick(lang, SPECIAL[tag].ru, SPECIAL[tag].tj)}</span></>}</>,
                        <span dangerouslySetInnerHTML={{ __html: fmt(q.qt) }} />)}
                    </span>
                    <span className="ha">
                      {blk(<><b>Ответ:</b> <span dangerouslySetInnerHTML={{ __html: fmt(q.a) }} /></>, <><b>Ҷавоб:</b> <span dangerouslySetInnerHTML={{ __html: fmt(q.at) }} /></>)}
                    </span>
                  </li>
                ); })}
              </ol>
            </React.Fragment>
          ))}
        </section>
      ))}
    </div>
  );
};
