import React, { useEffect, useState } from 'react';
import { QUESTION_SECONDS, useGameSession, useServerClock, useTimerLeft } from './api';
import { Bi, BoardGrid, BuzzQueue, GameShell, GameTitle, LinkOverlay, QuestionBody, TeamGrid, TimerView, roundById } from './ui';

/** Экран для проектора: только показ, без входа. Адрес: /game/screen/КОД */
export const GameScreen: React.FC<{ code: string }> = ({ code }) => {
  const { session, state } = useGameSession(code);
  const now = useServerClock();
  const [fs, setFs] = useState(false);
  const board = session?.board;
  const left = useTimerLeft(board?.timer ?? { running: false, left: QUESTION_SECONDS, endsAt: null }, now);

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

  const r = roundById(board.round);
  return (
    <GameShell lang={board.lang} fs={fs} proj>
      <div className="app">
        <header className="top">
          <div>
            <p className="eyebrow"><Bi ru={`${r.tab} · ${r.sub}`} tj={`${r.tabt} · ${r.subt}`} /></p>
            <GameTitle />
          </div>
          <div className="top-ctl">
            <button className="btn" onClick={toggleFs}>{fs ? <Bi ru="Выйти из полного экрана" tj="Аз экрани пурра баромадан" /> : <Bi ru="На весь экран" tj="Экрани пурра" />}</button>
          </div>
        </header>
        <main><BoardGrid board={board} /></main>
        <section className="teams">
          {session.teams.length === 0
            ? <p className="queue-empty"><Bi ru="Ждём команды…" tj="Интизори дастаҳо…" /></p>
            : <TeamGrid teams={session.teams} scores={board.scores} />}
        </section>
      </div>

      {board.q && (
        <div className="scrim proj">
          <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
            <QuestionBody board={board} />
            <div className="tools">
              <TimerView left={left} big />
            </div>
            <BuzzQueue board={board} teams={session.teams} buzz={session.buzz} />
          </div>
        </div>
      )}

      {board.showLink && <LinkOverlay code={code} teams={session.teams} />}
    </GameShell>
  );
};
