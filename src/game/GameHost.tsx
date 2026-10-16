import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { AuthModal } from '../components/AuthModal';
import { ROUNDS, RULES, SPECIAL } from './data';
import {
  GameBoard, GameQ, Lang, QUESTION_SECONDS, beep, freshBoard, queueOf, screenUrl,
  useGameSession, useServerClock, useTimerLeft, GameSession,
} from './api';
import {
  Bi, BiF, BoardGrid, BuzzQueue, GameShell, GameTitle, LinkOverlay, QuestionBody, TeamGrid, TimerView,
  fmt, pick, roundById, useLang,
} from './ui';

type View = 'r1' | 'r2' | 'rules' | 'host';

/** Вход ведущего: проверка роли и поиск/создание игры */
export const GameHost: React.FC = () => {
  const { user, isAdmin, isOwner, isLoading } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [looking, setLooking] = useState(true);
  const [error, setError] = useState('');
  const allowed = !!user && (isAdmin || isOwner);

  useEffect(() => {
    if (!allowed || !user) { setLooking(false); return; }
    let dead = false;
    (async () => {
      const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
      const { data } = await supabase.from('game_sessions').select('code').eq('host_id', user.id)
        .gte('created_at', since).order('created_at', { ascending: false }).limit(1);
      if (!dead) { setCode(data?.[0]?.code ?? null); setLooking(false); }
    })();
    return () => { dead = true; };
  }, [allowed, user?.id]);

  const create = async () => {
    setError('');
    const { data, error: e } = await supabase.rpc('game_create');
    if (e) { setError(e.message); return; }
    setCode(data as string);
  };

  let body: React.ReactNode;
  if (isLoading || looking) {
    body = <p>Загрузка…</p>;
  } else if (!user) {
    body = <AuthModal isOpen />;
  } else if (!allowed) {
    body = (
      <div className="gate">
        <h1>Своя игра</h1>
        <p>Вести игру могут только администраторы.</p>
        <a className="btn" href="/">На сайт</a>
      </div>
    );
  } else if (!code) {
    body = (
      <div className="gate">
        <h1><Bi ru="Своя игра по химии" tj="Викторинаи «Своя игра» аз химия" /></h1>
        <p>Создайте игру: команды зайдут по ссылке, а на проектор можно вывести отдельный экран.</p>
        <button className="btn primary" onClick={create}>Начать игру</button>
        {error && <p className="gate-err">{error}</p>}
      </div>
    );
  } else {
    body = <HostGame code={code} onNewCode={() => setCode(null)} />;
  }
  return code && allowed && !isLoading && !looking ? <>{body}</> : <GameShell lang="ru">{body}</GameShell>;
};

const HostGame: React.FC<{ code: string; onNewCode: () => void }> = ({ code, onNewCode }) => {
  const { session, state } = useGameSession(code);
  if (state === 'missing') {
    return <div className="gate"><p>Игра не найдена или устарела.</p><button className="btn primary" onClick={onNewCode}>Создать новую</button></div>;
  }
  if (!session) return <p>Загрузка…</p>;
  return <HostBoard session={session} />;
};

const HostBoard: React.FC<{ session: GameSession }> = ({ session }) => {
  const code = session.code;
  const now = useServerClock();
  const [board, setBoardState] = useState<GameBoard>(session.board);
  const boardRef = useRef<GameBoard>(session.board);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const [view, setView] = useState<View>('r1');
  const [confirmReset, setConfirmReset] = useState(false);
  const [fs, setFs] = useState(false);
  const [fsNote, setFsNote] = useState(false);

  // teams и buzz приходят с сервера; board — наш собственный (пишем только мы)
  const teams = session.teams;
  const buzz = session.buzz;
  const lang = board.lang;

  const commit = useCallback((fn: (b: GameBoard) => GameBoard) => {
    const next = fn(boardRef.current);
    boardRef.current = next;
    setBoardState(next);
    writes.current = writes.current.then(() => supabase.from('game_sessions').update({ board: next }).eq('code', code));
  }, [code]);

  const left = useTimerLeft(board.timer, now);

  // таймер дошёл до нуля
  useEffect(() => {
    if (board.timer.running && left <= 0) {
      commit((b) => ({ ...b, timer: { running: false, left: 0, endsAt: null } }));
      beep();
    }
  }, [left, board.timer.running, commit]);

  // звук, когда появилось первое нажатие
  const firstSeen = useRef(0);
  const queue = queueOf(buzz, board.q);
  useEffect(() => {
    const n = queue[0]?.n ?? 0;
    if (n && n !== firstSeen.current) beep();
    firstSeen.current = n;
  }, [queue[0]?.n]);

  const rpc = (fn: string, args: Record<string, unknown>) => supabase.rpc(fn, args);

  const openQ = (ci: number, qi: number) => {
    const r = roundById(board.round);
    commit((b) => ({
      ...b,
      q: { r: r.id, ci, qi, shown: false, pts: r.cats[ci].qs[qi].v, wrong: [] },
      timer: { running: false, left: QUESTION_SECONDS, endsAt: null },
    }));
    rpc('game_buzz_clear', { p_code: code });
  };

  const closeQ = (markUsed: boolean) => {
    commit((b) => {
      const q = b.q;
      const used = { ...b.used };
      if (q && markUsed) used[q.r] = { ...(used[q.r] || {}), [`${q.ci}-${q.qi}`]: true };
      return { ...b, used, q: null, timer: { running: false, left: QUESTION_SECONDS, endsAt: null } };
    });
    rpc('game_buzz_clear', { p_code: code });
  };

  const patchQ = (p: Partial<GameQ>) => commit((b) => (b.q ? { ...b, q: { ...b.q, ...p } } : b));

  const startTimer = () => commit((b) => {
    const secs = b.timer.left > 0 ? b.timer.left : QUESTION_SECONDS;
    return { ...b, timer: { running: true, left: secs, endsAt: Math.round(now()) + secs * 1000 } };
  });
  const pauseTimer = () => commit((b) => ({ ...b, timer: { running: false, left: Math.max(left, 0), endsAt: null } }));
  const resetTimer = () => commit((b) => ({ ...b, timer: { running: false, left: QUESTION_SECONDS, endsAt: null } }));

  const judge = (n: number, ok: boolean) => {
    const q = board.q; if (!q) return;
    if (ok) {
      commit((b) => ({ ...b, scores: { ...b.scores, [n]: (b.scores[n] ?? 0) + q.pts } }));
      closeQ(true);
    } else {
      commit((b) => ({
        ...b,
        scores: { ...b.scores, [n]: (b.scores[n] ?? 0) - q.pts },
        q: b.q ? { ...b.q, wrong: [...b.q.wrong, n] } : b.q,
      }));
      rpc('game_buzz_drop', { p_code: code, p_n: n });
    }
  };

  const adjust = (n: number, d: number) => commit((b) => ({ ...b, scores: { ...b.scores, [n]: (b.scores[n] ?? 0) + d } }));
  const rename = (n: number, name: string) => { rpc('game_rename', { p_code: code, p_n: n, p_name: name }); };
  const removeTeam = (n: number) => {
    if (!window.confirm('Убрать команду из игры?')) return;
    rpc('game_remove_team', { p_code: code, p_n: n });
    commit((b) => {
      const scores = { ...b.scores }; delete scores[n];
      return { ...b, scores };
    });
  };
  const resetGame = () => {
    commit((b) => freshBoard({ round: b.round, lang: b.lang }));
    rpc('game_buzz_clear', { p_code: code });
    setConfirmReset(false);
  };

  // клавиши: 1–6 — нажать за команду, Esc — вернуть вопрос на табло
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const b = boardRef.current;
      if (!b.q || e.repeat) return;
      if (e.key === 'Escape') { closeQ(false); return; }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
  const setRound = (id: string) => { commit((b) => ({ ...b, round: id })); setView(id as View); };
  const q = board.q;
  const sortedTeams = [...teams].sort((a, b) => a.n - b.n);
  const first = queue[0]?.n;
  const firstName = teams.find((t) => t.n === first)?.name;

  return (
    <GameShell lang={lang} fs={fs}>
      <div className="app">
        <header className="top">
          <div>
            <p className="eyebrow">
              {view === 'rules' ? <Bi ru="Как играть" tj="Тарзи бозӣ" /> : view === 'host' ? <Bi ru="Вопросы с ответами" tj="Саволҳо бо ҷавобҳо" /> :
                <Bi ru={`${roundById(view).tab} · ${roundById(view).sub}`} tj={`${roundById(view).tabt} · ${roundById(view).subt}`} />}
            </p>
            <GameTitle />
          </div>
          <div className="top-ctl">
            <nav className="tabs" role="tablist">
              {ROUNDS.map((r) => (
                <button key={r.id} className="tab" role="tab" aria-selected={view === r.id} onClick={() => setRound(r.id)}><Bi ru={r.tab} tj={r.tabt} /></button>
              ))}
              <button className="tab" role="tab" aria-selected={view === 'rules'} onClick={() => setView('rules')}><Bi ru="Правила" tj="Қоидаҳо" /></button>
              <button className="tab" role="tab" aria-selected={view === 'host'} onClick={() => setView('host')}><Bi ru="Лист ведущего" tj="Варақаи пешбар" /></button>
            </nav>
            <div className="seg" role="group">
              {([['both', 'RU + TJ'], ['ru', 'RU'], ['tj', 'TJ']] as [Lang, string][]).map(([l, t]) => (
                <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{t}</button>
              ))}
            </div>
            <button className="btn primary" onClick={() => commit((b) => ({ ...b, showLink: true }))}><Bi ru="Ссылка для команд" tj="Истинод барои дастаҳо" /></button>
            <a className="btn" href={screenUrl(code)} target="_blank" rel="noreferrer"><Bi ru="Экран для проектора" tj="Экран барои проектор" /></a>
            <button className="btn" onClick={toggleFs}>{fs ? <Bi ru="Выйти из полного экрана" tj="Аз экрани пурра баромадан" /> : <Bi ru="На весь экран" tj="Экрани пурра" />}</button>
          </div>
        </header>
        {fsNote && <p className="host-note"><Bi ru="Браузер не разрешил полноэкранный режим. Нажмите F11." tj="Браузер экрани пурраро иҷозат надод. F11-ро пахш кунед." /></p>}

        <main>
          {(view === 'r1' || view === 'r2') && <BoardGrid board={{ ...board, round: view }} onPick={openQ} />}
          {view === 'rules' && <RulesView />}
          {view === 'host' && <HostSheet />}
        </main>

        <section className="teams" aria-label="Команды">
          <div className="teams-head">
            <h2><Bi ru="Команды" tj="Дастаҳо" /> <span className="code-chip">{code}</span></h2>
            <div className="ctl">
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
            <TeamGrid teams={teams} scores={board.scores} editable={{ onRename: rename, onAdjust: adjust, onRemove: removeTeam }} />
          )}
        </section>
      </div>

      {q && (
        <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) closeQ(false); }}>
          <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title" tabIndex={-1}>
            <QuestionBody board={board} />
            <div className="tools">
              <TimerView left={left} />
              {board.timer.running
                ? <button className="btn" onClick={pauseTimer}><Bi ru="Пауза" tj="Таваққуф" /></button>
                : <button className="btn primary" onClick={startTimer} disabled={left <= 0}>
                    {left === QUESTION_SECONDS ? <Bi ru={`Старт · приём ответов (${QUESTION_SECONDS} с)`} tj={`Оғоз · қабули ҷавоб (${QUESTION_SECONDS} сония)`} /> : <Bi ru="Продолжить" tj="Давом додан" />}
                  </button>}
              <button className="btn" onClick={resetTimer}><Bi ru="Сбросить" tj="Аз нав" /></button>
              <label className="pts"><Bi ru="Баллы" tj="Холҳо" />
                <input type="number" step={100} value={q.pts} onChange={(e) => { const n = parseInt(e.target.value, 10); patchQ({ pts: isNaN(n) || n < 0 ? 0 : n }); }} />
              </label>
              {!q.shown && <button className="btn primary" onClick={() => patchQ({ shown: true })}><Bi ru="Показать ответ" tj="Ҷавобро нишон диҳед" /></button>}
            </div>
            {board.timer.running && <p className="armed" role="status"><Bi ru="Приём ответов открыт: команды видят кнопку «Ответить»" tj="Қабули ҷавоб кушода аст: дастаҳо тугмаи «Ҷавоб додан»-ро мебинанд" /></p>}
            {firstName && <p className="buzz" role="status"><Bi ru={<>Первой отвечает: <b>{firstName}</b></>} tj={<>Аввал ҷавоб медиҳад: <b>{firstName}</b></>} /></p>}
            <BuzzQueue board={board} teams={teams} buzz={buzz} />
            <div className="judge">
              {sortedTeams.map((t) => {
                const w = q.wrong.includes(t.n);
                return (
                  <div className={`judge-row${w ? ' done' : ''}${first === t.n ? ' first' : ''}`} key={t.n}>
                    <div className="jn"><kbd>{t.n}</kbd><span className="nm">{t.name}</span></div>
                    <div className="jb">
                      <button className="ok" disabled={w} onClick={() => judge(t.n, true)}>✓ +{q.pts}</button>
                      <button className="no" disabled={w} onClick={() => judge(t.n, false)}>✗ −{q.pts}</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="dlg-foot">
              <button className="btn" onClick={() => closeQ(false)}><Bi ru="Вернуть на табло" tj="Ба ҷадвал баргардонед" /></button>
              <button className="btn primary" onClick={() => closeQ(true)}>
                {q.shown ? <Bi ru="Закрыть вопрос" tj="Саволро пӯшед" /> : <Bi ru="Никто не ответил, закрыть" tj="Касе ҷавоб надод, пӯшед" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {board.showLink && <LinkOverlay code={code} teams={teams} onClose={() => commit((b) => ({ ...b, showLink: false }))} />}
    </GameShell>
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

const HostSheet: React.FC = () => {
  const lang = useLang();
  const blk = (ru: React.ReactNode, tj: React.ReactNode) => lang === 'ru' ? <span>{ru}</span> : lang === 'tj' ? <span>{tj}</span> : <><span>{ru}</span><span className="t" lang="tg">{tj}</span></>;
  return (
    <div className="host">
      <p className="host-note"><Bi ru="Этот раздел для ведущего: здесь все вопросы с ответами. Не выводите его на экран для класса." tj="Ин бахш барои пешбар аст: дар ин ҷо ҳамаи саволҳо бо ҷавобҳо ҳастанд. Онро барои синф ба экран набароред." /></p>
      {ROUNDS.map((r) => (
        <section key={r.id}>
          <h2><Bi ru={r.tab} tj={r.tabt} /></h2>
          <p className="eyebrow"><Bi ru={r.sub} tj={r.subt} /></p>
          {r.cats.map((c) => (
            <React.Fragment key={c.name}>
              <h3><Bi ru={c.name} tj={c.nt} /></h3>
              <ol>
                {c.qs.map((q) => (
                  <li key={q.v}>
                    <span className="hv">{q.v}</span>
                    <span className="hq">
                      {blk(<><span dangerouslySetInnerHTML={{ __html: fmt(q.q) }} />{q.tag && <> <span className="badge">{pick(lang, SPECIAL[q.tag].ru, SPECIAL[q.tag].tj)}</span></>}</>,
                        <span dangerouslySetInnerHTML={{ __html: fmt(q.qt) }} />)}
                    </span>
                    <span className="ha">
                      {blk(<><b>Ответ:</b> <span dangerouslySetInnerHTML={{ __html: fmt(q.a) }} /></>, <><b>Ҷавоб:</b> <span dangerouslySetInnerHTML={{ __html: fmt(q.at) }} /></>)}
                    </span>
                  </li>
                ))}
              </ol>
            </React.Fragment>
          ))}
        </section>
      ))}
    </div>
  );
};

