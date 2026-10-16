import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { QUESTION_SECONDS, queueOf, useGameSession, useServerClock, useTimerLeft } from './api';
import { Bi, GameShell, TimerView } from './ui';

interface Me { n: number; secret: string; name: string }
const storeKey = (code: string) => `game_team_${code}`;

function readMe(code: string): Me | null {
  try { const v = localStorage.getItem(storeKey(code)); return v ? (JSON.parse(v) as Me) : null; } catch { return null; }
}
function writeMe(code: string, me: Me | null) {
  try { if (me) localStorage.setItem(storeKey(code), JSON.stringify(me)); else localStorage.removeItem(storeKey(code)); } catch { /* ignore */ }
}

/** Страница команды: вход по ссылке, таймер и большая кнопка «Ответить». Адрес: /play/КОД */
export const GamePlay: React.FC<{ code: string }> = ({ code }) => {
  const { session, state, refetch } = useGameSession(code);
  const now = useServerClock();
  const [me, setMe] = useState<Me | null>(() => readMe(code));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<string>(''); // идентификатор вопроса, на который уже нажали
  const [note, setNote] = useState('');
  const pressing = useRef(false);

  const board = session?.board;
  const left = useTimerLeft(board?.timer ?? { running: false, left: QUESTION_SECONDS, endsAt: null }, now);

  // команду убрали из игры — возвращаемся к форме входа
  useEffect(() => {
    if (me && session && !session.teams.some((t) => t.n === me.n)) { writeMe(code, null); setMe(null); }
  }, [session, me, code]);

  const qid = board?.q ? `${board.q.r}-${board.q.ci}-${board.q.qi}` : '';
  useEffect(() => { setNote(''); }, [qid]);

  if (state === 'missing') return <GameShell lang="both"><div className="play"><p className="play-msg"><Bi ru="Игра не найдена. Проверьте ссылку." tj="Бозӣ ёфт нашуд. Истинодро санҷед." /></p></div></GameShell>;
  if (!session || !board) return <GameShell lang="both"><div className="play"><p className="play-msg">…</p></div></GameShell>;

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('game_join', { p_code: code, p_name: name });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    const d = data as Me;
    writeMe(code, d); setMe(d);
    refetch();
  };

  if (!me) {
    return (
      <GameShell lang="both">
        <div className="play">
          <h1 className="play-title"><Bi ru="Своя игра по химии" tj="Викторинаи «Своя игра» аз химия" /></h1>
          <form className="play-join" onSubmit={join}>
            <label htmlFor="tn"><Bi ru="Название вашей команды" tj="Номи дастаи шумо" /></label>
            <input id="tn" type="text" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
            <button className="btn primary play-go" disabled={busy || !name.trim()}><Bi ru="Войти в игру" tj="Ба бозӣ даромадан" /></button>
            {err && <p className="gate-err">{err}</p>}
          </form>
        </div>
      </GameShell>
    );
  }

  const q = board.q;
  const queue = queueOf(session.buzz, q);
  const myPos = queue.findIndex((b) => b.n === me.n) + 1; // 0 — не нажимали
  const wrong = !!q && q.wrong.includes(me.n);
  const open = !!q && board.timer.running && left > 0 && !wrong;
  const myTeamName = session.teams.find((t) => t.n === me.n)?.name ?? me.name;

  const press = async () => {
    if (!open || pressing.current || myPos) return;
    pressing.current = true;
    setSent(qid);
    try { navigator.vibrate?.(40); } catch { /* ignore */ }
    const { data } = await supabase.rpc('game_buzz', { p_code: code, p_n: me.n, p_secret: me.secret });
    pressing.current = false;
    const res = data as { ok: boolean; reason?: string } | null;
    if (!res?.ok) { setSent(''); setNote(res?.reason === 'closed' ? 'closed' : res?.reason === 'blocked' ? 'blocked' : 'error'); }
    refetch();
  };

  const pressed = myPos > 0 || sent === qid;
  let status: React.ReactNode;
  if (!q) status = <Bi ru="Ждите следующий вопрос" tj="Саволи навбатиро интизор шавед" />;
  else if (wrong) status = <Bi ru="Ваш ответ неверный. Отвечают другие команды" tj="Ҷавоби шумо нодуруст. Дастаҳои дигар ҷавоб медиҳанд" />;
  else if (myPos === 1) status = <Bi ru="Вы первые! Отвечайте ведущему" tj="Шумо аввал! Ба пешбар ҷавоб диҳед" />;
  else if (myPos > 1) status = <Bi ru={`Вы в очереди: №${myPos}`} tj={`Шумо дар навбат: №${myPos}`} />;
  else if (pressed) status = <Bi ru="Отправляем…" tj="Фиристода истодаам…" />;
  else if (note === 'closed') status = <Bi ru="Не успели — приём закрыт" tj="Нарасидед — қабул баста шуд" />;
  else if (board.timer.running && left > 0) status = <Bi ru="Знаете ответ? Жмите!" tj="Ҷавобро медонед? Пахш кунед!" />;
  else if (left <= 0) status = <Bi ru="Время вышло" tj="Вақт тамом шуд" />;
  else status = <Bi ru="Вопрос на экране. Ждите сигнала ведущего" tj="Савол дар экран. Сигнали пешбарро интизор шавед" />;

  return (
    <GameShell lang="both">
      <div className="play">
        <p className="play-team">{myTeamName}</p>
        {q && <div className="play-timer"><TimerView left={left} big /></div>}
        <button
          className={`play-btn${open && !pressed ? ' live' : ''}${myPos === 1 ? ' won' : ''}`}
          disabled={!open || pressed}
          onPointerDown={(e) => { e.preventDefault(); press(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press(); } }}
        >
          {myPos > 0 ? <span className="play-pos">{myPos}</span> : <Bi ru="ОТВЕТИТЬ" tj="ҶАВОБ ДОДАН" />}
        </button>
        <p className="play-msg" role="status">{status}</p>
      </div>
    </GameShell>
  );
};
