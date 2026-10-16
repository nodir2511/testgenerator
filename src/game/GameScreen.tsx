import React, { useEffect, useRef, useState } from 'react';
import { QUESTION_SECONDS, playSound, unlockAudio, useGameSession, useServerClock, useTimerLeft, useWakeLock } from './api';
import { Bi, BoardGrid, BuzzQueue, GameShell, GameTitle, LinkOverlay, ModeStatus, Podium, QuestionBody, TeamGrid, TimerView, layoutRound } from './ui';

/** Экран для проектора: только показ, без входа. Адрес: /game/screen/КОД */
export const GameScreen: React.FC<{ code: string }> = ({ code }) => {
  const { session, state, connected } = useGameSession(code);
  const now = useServerClock();
  useWakeLock();
  const [fs, setFs] = useState(false);
  const board = session?.board;
  const left = useTimerLeft(board?.timer ?? { running: false, left: QUESTION_SECONDS, endsAt: null }, now);

  // звуки проектора: включаются кнопкой (браузер разрешает звук только после клика)
  const [sound, setSound] = useState(() => { try { return localStorage.getItem('game_sound') === '1'; } catch { return false; } });
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try { localStorage.setItem('game_sound', next ? '1' : '0'); } catch { /* ignore */ }
    if (next) { unlockAudio(); playSound('open'); }
  };
  const qKey = board?.q ? `${board.q.r}-${board.q.ci}-${board.q.qi}-${board.q.extra ? 'x' : ''}` : '';
  const firstBuzz = board?.q?.mode === 'buzz' ? session?.buzz.find((b) => !board.q!.wrong.includes(b.n))?.n ?? 0 : 0;
  const prev = useRef({ qKey: '', left, final: false, first: 0 });
  useEffect(() => {
    const p = prev.current;
    if (sound && board) {
      if (qKey && qKey !== p.qKey) playSound('open');
      if (board.timer.running && left > 0 && left <= 5 && left !== p.left) playSound('tick');
      if (qKey && left === 0 && p.left > 0 && qKey === p.qKey) playSound('gong');
      if (board.final && !board.q && !p.final) playSound('fanfare');
      if (firstBuzz && firstBuzz !== p.first) playSound('buzz');
    }
    prev.current = { qKey, left, final: !!board?.final && !board?.q, first: firstBuzz };
  }, [qKey, left, board?.final, board?.q, firstBuzz, sound]);

  useEffect(() => {
    const on = () => setFs(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  if (state === 'missing') return <GameShell lang="ru"><p>Игра не найдена или устарела.</p></GameShell>;
  if (!session || !board) return <GameShell lang="ru"><p>Загрузка…</p></GameShell>;

  const r = layoutRound(board);
  const q = board.q;
  const { teams } = session;
  return (
    <GameShell lang={board.lang} fs={fs} proj>
      {!connected && <div className="offline" role="alert"><Bi ru="Нет связи — экран не обновляется" tj="Алоқа нест — экран нав намешавад" /></div>}
      <div className="app">
        <header className="top">
          <div>
            {r && <p className="eyebrow"><Bi ru={`${r.tab} · ${r.sub}`} tj={`${r.tabt} · ${r.subt}`} /></p>}
            <GameTitle />
          </div>
          <div className="top-ctl">
            <button className="btn" onClick={toggleSound} aria-pressed={sound}>{sound ? <Bi ru="🔊 Звук включён" tj="🔊 Садо фаъол аст" /> : <Bi ru="🔇 Включить звук" tj="🔇 Садоро фаъол кунед" />}</button>
            <button className="btn" onClick={toggleFs}>{fs ? <Bi ru="Выйти из полного экрана" tj="Аз экрани пурра баромадан" /> : <Bi ru="На весь экран" tj="Экрани пурра" />}</button>
          </div>
        </header>
        <main><BoardGrid board={board} teams={teams} /></main>
        <section className="teams">
          {teams.length === 0
            ? <p className="queue-empty"><Bi ru="Ждём команды…" tj="Интизори дастаҳо…" /></p>
            : <TeamGrid teams={teams} scores={board.scores} chooser={board.chooser} />}
        </section>
      </div>

      {q && (
        <div className="scrim proj">
          <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
            <QuestionBody board={board} hideText={q.mode === 'cat' || q.mode === 'bids'} />
            {(q.mode === 'buzz' || q.mode === 'answer') && (
              <div className="tools"><TimerView left={left} big /></div>
            )}
            <ModeStatus board={board} teams={teams} bidders={session.input.bidders} />
            {q.mode === 'buzz' && <BuzzQueue board={board} teams={teams} buzz={session.buzz} />}
          </div>
        </div>
      )}

      {board.final && !q && (
        <div className="scrim proj">
          <div className="dlg"><Podium board={board} teams={teams} /></div>
        </div>
      )}

      {(board.lobby || board.showLink) && <LinkOverlay code={code} teams={teams} />}
    </GameShell>
  );
};
