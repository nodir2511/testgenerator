import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { TEAM_RULES } from './content';
import {
  FALSE_START_MS, QUESTION_SECONDS, beep, inputOf, queueOf, serverNow, serverTimeOfEvent, signed, standings, unlockAudio, useClockInfo, useCountdown, useGameSession,
  useServerClock, useSettled, useTimerLeft, useWakeLock,
} from './api';
import { Bi, GameShell, TimerView, tc, teamName } from './ui';

interface Me { n: number; secret: string; name: string; pin?: string }
const storeKey = (code: string) => `game_team_${code}`;

function readMe(code: string): Me | null {
  try { const v = localStorage.getItem(storeKey(code)); return v ? (JSON.parse(v) as Me) : null; } catch { return null; }
}
function writeMe(code: string, me: Me | null) {
  try { if (me) localStorage.setItem(storeKey(code), JSON.stringify(me)); else localStorage.removeItem(storeKey(code)); } catch { /* ignore */ }
}

const buzzSignal = () => {
  try { navigator.vibrate?.([80, 60, 80]); } catch { /* ignore */ }
  beep(880, 180);
  setTimeout(() => beep(1320, 180), 200);
};

/** Страница команды: вход по ссылке, таймер и большая кнопка «Ответить». Адрес: /play/КОД */
const PlayGame: React.FC<{ code: string }> = ({ code }) => {
  const { session, state, refetch, connected } = useGameSession(code);
  const now = useServerClock();
  useWakeLock();
  const [me, setMe] = useState<Me | null>(() => readMe(code));
  const [kicked, setKicked] = useState(false);
  const [tab, setTab] = useState<'new' | 'back'>('new');
  const [name, setName] = useState('');
  const [backN, setBackN] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState('');   // идентификатор вопроса, на который уже нажали
  const [note, setNote] = useState('');
  const [bid, setBid] = useState<number | null>(null);
  const [bidSent, setBidSent] = useState<number | null>(null);
  const [, tick] = useState(0);
  const pressing = useRef(false);

  const clock = useClockInfo();

  const board = session?.board;
  const timer = board?.timer ?? { running: false, left: QUESTION_SECONDS, endsAt: null };
  const left = useTimerLeft(timer, now);
  // отсчёт «3-2-1» перед приёмом ответов: кнопка включается сама в назначенный серверный момент, второго сигнала по сети не нужно
  const cd = useCountdown(timer, now);

  // телефон сообщает ведущему задержку и погрешность часов
  useEffect(() => {
    if (!me || clock.rtt == null || clock.err == null) return;
    supabase.rpc('game_net_report', { p_code: code, p_n: me.n, p_secret: me.secret, p_rtt: clock.rtt, p_err: clock.err }).then(() => undefined, () => undefined);
  }, [me?.secret, clock]);

  // звук на телефоне разрешается только после касания
  useEffect(() => {
    const on = () => unlockAudio();
    document.addEventListener('pointerdown', on);
    return () => document.removeEventListener('pointerdown', on);
  }, []);

  const dropMe = (byOther: boolean) => { writeMe(code, null); setMe(null); setKicked(byOther); };

  // команду убрали из игры — к форме входа
  useEffect(() => {
    if (me && session && !session.teams.some((t) => t.n === me.n)) dropMe(false);
  }, [session, me, code]);

  // это устройство всё ещё в игре? (после возврата с другого телефона старое отключается)
  useEffect(() => {
    if (!me) return;
    let dead = false;
    const check = async () => {
      const { data, error } = await supabase.rpc('game_check', { p_code: code, p_n: me.n, p_secret: me.secret });
      if (!dead && !error && data === false) dropMe(true);
    };
    check();
    const id = setInterval(check, 15000);
    return () => { dead = true; clearInterval(id); };
  }, [me?.secret, code]);

  const q = board?.q ?? null;
  // порядок нажатий объявляем, когда запоздавшие пакеты успели дойти
  const queue = queueOf(session?.buzz ?? [], q);
  const settled = useSettled(queue, now);
  const qid = q ? `${q.r}-${q.ci}-${q.qi}-${q.extra ? 'x' : ''}-${q.seq ?? ''}` : '';
  useEffect(() => { setNote(''); setBid(null); setBidSent(null); }, [qid]);

  // сигнал (вибрация + звук), когда команде пора действовать
  const myN = me?.n ?? 0;
  const inQ = !!q && q.won == null && (!q.only || q.only.includes(myN)) && !q.wrong.includes(myN);
  const running = !!board?.timer.running && left > 0;
  const attention = !me || !q || !inQ ? ''
    : q.mode === 'buzz' && running && cd === 0 ? `buzz-${qid}-${board?.timer.startedAt}`
    : q.mode === 'cat' && q.chooser === myN ? `cat-${qid}`
    : q.mode === 'bids' ? `bids-${qid}`
    : q.mode === 'answer' && q.answerer === myN ? `answer-${qid}` : '';
  const lastAttention = useRef('');
  useEffect(() => {
    if (attention && attention !== lastAttention.current) buzzSignal();
    lastAttention.current = attention;
  }, [attention]);

  // блокировка после фальстарта — обновляем экран, пока она идёт
  const fsList = session ? inputOf(session.input, q).fs ?? [] : [];
  const startedAt = board?.timer.startedAt ?? 0;
  const lockLeft = me && running && fsList.includes(me.n) ? Math.max(0, startedAt + FALSE_START_MS - now()) : 0;
  useEffect(() => {
    if (lockLeft <= 0) return;
    const id = setInterval(() => tick((x) => x + 1), 100);
    return () => clearInterval(id);
  }, [lockLeft > 0]);

  if (state === 'missing') return <GameShell lang="both"><div className="play"><p className="play-msg"><Bi ru="Игра не найдена. Проверьте ссылку." tj="Бозӣ ёфт нашуд. Истинодро санҷед." /></p></div></GameShell>;
  if (!session || !board) return <GameShell lang="both"><div className="play"><p className="play-msg">…</p></div></GameShell>;

  const enter = async (d: Me) => {
    await refetch(); // сначала свежий список команд, иначе новая команда покажется «удалённой»
    writeMe(code, d); setMe(d); setKicked(false);
  };
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('game_join', { p_code: code, p_name: name });
    if (error) { setBusy(false); setErr(error.message); return; }
    await enter(data as Me);
    setBusy(false);
  };
  const rejoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backN) return;
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('game_rejoin', { p_code: code, p_n: backN, p_pin: pin });
    const res = data as (Me & { ok: boolean }) | null;
    if (error || !res?.ok) {
      setBusy(false);
      setErr(error ? error.message : 'Неверный код команды / Рамзи даста нодуруст');
      return;
    }
    await enter({ n: res.n, secret: res.secret, name: res.name, pin: res.pin });
    setBusy(false);
  };

  if (!me) {
    const teams = [...session.teams].sort((a, b) => a.n - b.n);
    return (
      <GameShell lang="both">
        <div className="play">
          <h1 className="play-title"><Bi ru="Своя игра" tj="Викторинаи «Своя игра»" /></h1>
          {kicked && <p className="host-note"><Bi ru="Ваша команда открыта на другом устройстве. Чтобы вернуться сюда, введите код команды." tj="Дастаи шумо дар дастгоҳи дигар кушода шуд. Барои баргаштан рамзи дастаро ворид кунед." /></p>}
          {teams.length > 0 && (
            <div className="seg play-tabs" role="group">
              <button aria-pressed={tab === 'new'} onClick={() => { setTab('new'); setErr(''); }}><Bi ru="Новая команда" tj="Дастаи нав" /></button>
              <button aria-pressed={tab === 'back'} onClick={() => { setTab('back'); setErr(''); }}><Bi ru="Вернуться в игру" tj="Ба бозӣ баргаштан" /></button>
            </div>
          )}
          {tab === 'new' || teams.length === 0 ? (
            <form className="play-join" onSubmit={join}>
              <label htmlFor="tn"><Bi ru="Название вашей команды" tj="Номи дастаи шумо" /></label>
              <input id="tn" type="text" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
              <button className="btn primary play-go" disabled={busy || !name.trim()}><Bi ru="Войти в игру" tj="Ба бозӣ даромадан" /></button>
            </form>
          ) : (
            <form className="play-join" onSubmit={rejoin}>
              <span className="lab"><Bi ru="Выберите свою команду" tj="Дастаи худро интихоб кунед" /></span>
              <div className="play-teams">
                {teams.map((t) => (
                  <button type="button" key={t.n} className={`btn${backN === t.n ? ' primary' : ''}`} onClick={() => setBackN(t.n)}>{t.name}</button>
                ))}
              </div>
              <label htmlFor="pin"><Bi ru="Код команды (4 цифры — был на экране команды; его знает ведущий)" tj="Рамзи даста (4 рақам — дар экрани даста буд; пешбар медонад)" /></label>
              <input id="pin" className="play-code" type="text" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoComplete="off" />
              <button className="btn primary play-go" disabled={busy || !backN || pin.length !== 4}><Bi ru="Вернуться" tj="Баргаштан" /></button>
            </form>
          )}
          {err && <p className="gate-err">{err}</p>}
        </div>
      </GameShell>
    );
  }

  const teams = session.teams;
  const myScore = board.scores[me.n] ?? 0;
  const myTeamName = teamName(teams, me.n) || me.name;
  const myPos = queue.findIndex((b) => b.n === me.n) + 1; // 0 — не нажимали
  const wrong = !!q && q.wrong.includes(me.n);
  const notMine = !!q && !!q.only && !q.only.includes(me.n);
  const buzzMode = !!q && q.mode === 'buzz' && q.won == null && !notMine && !wrong;
  // кнопку не блокируем из-за «нет связи»: нажатие всё равно уйдёт, как только сеть вернётся, а ответ сервера покажем
  const counting = cd > 0;
  const live = buzzMode && running && !counting && lockLeft <= 0;
  const paused = buzzMode && !board.timer.running && !!board.timer.startedAt && left > 0;
  // до старта (в том числе во время отсчёта) кнопка нажимается, но это фальстарт
  const early = buzzMode && (counting || (!board.timer.running && !board.timer.startedAt && !q?.shown && board.timer.left > 0));

  const press = async (stamp?: number) => {
    if (!(live || early) || pressing.current || myPos) return;
    pressing.current = true;
    if (live) setSent(qid);
    try { navigator.vibrate?.(40); } catch { /* ignore */ }
    // момент касания по серверным часам: порядок нажатий считается по нему, а не по времени прихода пакета
    const t = serverTimeOfEvent(stamp);
    const args = { p_code: code, p_n: me.n, p_secret: me.secret, p_t: t, p_seq: q?.seq ?? null, p_err: clock.err };
    let res: any = { data: null, error: null };
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await supabase.rpc('game_buzz', args);
      // на сервере ещё нет обновления 0.10 — старый вызов без времени
      if (res.error?.code === 'PGRST202') res = await supabase.rpc('game_buzz', { p_code: code, p_n: me.n, p_secret: me.secret });
      if (!res.error) break;
      // нажатие не дошло: повторяем с тем же временем, пока оно укладывается в окно запоздавших нажатий
      if (t == null || serverNow() - t > 1500) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    pressing.current = false;
    const { data, error } = res;
    if (error) { setSent(''); setNote('net'); refetch(); return; }
    const out = data as { ok: boolean; reason?: string } | null;
    if (!out?.ok) {
      setSent('');
      setNote(out?.reason ?? 'error');
      if (out?.reason === 'forbidden') dropMe(true);
    } else setNote('');
    refetch();
  };

  const giveCat = async (n: number) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('game_team_act', { p_code: code, p_n: me.n, p_secret: me.secret, p_kind: 'cat', p_value: n });
    setBusy(false);
    if (error) setNote('net'); else if (!(data as { ok: boolean } | null)?.ok) setNote('cat_fail');
    refetch();
  };

  const maxBid = q ? Math.max(myScore, q.v) : 0;
  const curBid = bid ?? Math.min(q?.v ?? 0, maxBid);
  const sendBid = async (amount: number) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('game_team_act', { p_code: code, p_n: me.n, p_secret: me.secret, p_kind: 'bid', p_value: amount });
    setBusy(false);
    const res = data as { ok: boolean; reason?: string } | null;
    if (error) setNote('net');
    else if (res?.ok) { setBidSent(amount); setNote(''); }
    else setNote(res?.reason === 'too_much' ? 'too_much' : 'bid_fail');
    refetch();
  };

  const pressed = myPos > 0 || sent === qid;
  const myPlace = standings(teams, board.scores).find((t) => t.n === me.n)?.place;

  // --- что показываем в середине экрана ---
  let center: React.ReactNode = null;
  let status: React.ReactNode = null;

  if (board.final && !q) {
    center = <div className="play-place">{myPlace}<span><Bi ru="место" tj="ҷой" /></span></div>;
    status = <Bi ru="Игра окончена. Спасибо!" tj="Бозӣ ба охир расид. Ташаккур!" />;
  } else if (!q) {
    status = board.chooser === me.n
      ? <b className="play-hot"><Bi ru="Ваша очередь выбирать вопрос!" tj="Навбати шумо барои интихоби савол!" /></b>
      : board.chooser ? <Bi ru={<>Вопрос выбирает: <b>{teamName(teams, board.chooser)}</b></>} tj={<>Саволро интихоб мекунад: <b>{teamName(teams, board.chooser)}</b></>} />
      : <Bi ru="Ждите следующий вопрос" tj="Саволи навбатиро интизор шавед" />;
  } else if (q.won != null) {
    status = q.won === me.n
      ? <b className="play-hot"><Bi ru={`Верно! +${q.pts}`} tj={`Дуруст! +${q.pts}`} /></b>
      : <Bi ru={<>Верно ответила: <b>{teamName(teams, q.won)}</b></>} tj={<>Дуруст ҷавоб дод: <b>{teamName(teams, q.won)}</b></>} />;
  } else if (notMine) {
    status = <Bi ru="Дополнительный вопрос для других команд" tj="Саволи иловагӣ барои дастаҳои дигар" />;
  } else if (q.mode === 'cat') {
    if (q.chooser === me.n) {
      center = (
        <div className="play-choice">
          <p className="play-hot"><Bi ru="«Кот в мешке»! Передайте вопрос другой команде:" tj="«Гурба дар халта»! Саволро ба дастаи дигар диҳед:" /></p>
          {note === 'net' && <p className="play-bad"><Bi ru="Не дошло — проверьте связь и нажмите ещё раз" tj="Нарасид — алоқаро санҷед ва боз пахш кунед" /></p>}
          {note === 'cat_fail' && <p className="play-bad"><Bi ru="Уже не получится — ведущий передал вопрос сам" tj="Дигар намешавад — пешбар саволро худаш дод" /></p>}
          {[...teams].filter((t) => t.n !== me.n).sort((a, b) => a.n - b.n).map((t) => (
            <button key={t.n} className="btn primary play-go" disabled={busy} onClick={() => giveCat(t.n)}>{t.name}</button>
          ))}
        </div>
      );
    } else {
      status = <Bi ru={<>«Кот в мешке»: {q.chooser ? <b>{teamName(teams, q.chooser)}</b> : 'команда'} выбирает, кому передать вопрос</>} tj={<>«Гурба дар халта»: {q.chooser ? <b>{teamName(teams, q.chooser)}</b> : 'даста'} интихоб мекунад, ки саволро ба кӣ диҳад</>} />;
    }
  } else if (q.mode === 'bids') {
    center = (
      <div className="play-choice">
        <p className="play-hot"><Bi ru="«Аукцион»! Ваша тайная ставка:" tj="«Аукцион»! Нархи пинҳонии шумо:" /></p>
        <div className="bid-row">
          <button className="btn" disabled={curBid <= 0} onClick={() => setBid(Math.max(0, curBid - 100))}>−100</button>
          <span className="bid-val">{curBid}</span>
          <button className="btn" disabled={curBid >= maxBid} onClick={() => setBid(Math.min(maxBid, curBid + 100))}>+100</button>
        </div>
        <div className="bid-row">
          <button className="btn" onClick={() => setBid(maxBid)}><Bi ru={`Всё: ${maxBid}`} tj={`Ҳама: ${maxBid}`} /></button>
          <button className="btn" onClick={() => sendBid(0)} disabled={busy}><Bi ru="Пас" tj="Пас" /></button>
        </div>
        <button className="btn primary play-go" disabled={busy} onClick={() => sendBid(curBid)}><Bi ru="Сделать ставку" tj="Нарх гузоштан" /></button>
        <p className="play-small"><Bi ru={`Не больше ${maxBid}`} tj={`На зиёда аз ${maxBid}`} /></p>
      </div>
    );
    status = note === 'too_much' ? <b className="play-bad"><Bi ru={`Ставка слишком большая: не больше ${maxBid}`} tj={`Нарх аз ҳад зиёд: на зиёда аз ${maxBid}`} /></b>
      : note === 'bid_fail' ? <b className="play-bad"><Bi ru="Ставки уже закрыты" tj="Нархгузорӣ аллакай баста шуд" /></b>
      : note === 'net' ? <b className="play-bad"><Bi ru="Ставка не дошла — проверьте связь и нажмите ещё раз" tj="Нарх нарасид — алоқаро санҷед ва боз пахш кунед" /></b>
      : bidSent != null
      ? <Bi ru={`Ставка принята: ${bidSent}. Можно изменить, пока все не поставили`} tj={`Нарх қабул шуд: ${bidSent}. То гузоштани ҳама тағйир додан мумкин`} />
      : <Bi ru="Другие команды не видят вашу ставку" tj="Дастаҳои дигар нархи шуморо намебинанд" />;
  } else if (q.mode === 'answer') {
    if (q.answerer === me.n) {
      center = <div className="play-btn won"><Bi ru="ОТВЕЧАЕТЕ ВЫ" tj="ШУМО ҶАВОБ МЕДИҲЕД" /></div>;
      status = q.tag === 'auction' ? <Bi ru={`Ваша ставка: ${q.pts}`} tj={`Нархи шумо: ${q.pts}`} /> : <Bi ru="Отвечайте ведущему" tj="Ба пешбар ҷавоб диҳед" />;
    } else {
      status = q.answerer
        ? <Bi ru={<>Отвечает: <b>{teamName(teams, q.answerer)}</b></>} tj={<>Ҷавоб медиҳад: <b>{teamName(teams, q.answerer)}</b></>} />
        : <Bi ru="Ведущий выбирает, кто отвечает" tj="Пешбар интихоб мекунад, ки кӣ ҷавоб медиҳад" />;
    }
  } else {
    // обычный вопрос: большая кнопка
    center = (
      <button
        className={`play-btn${live && !pressed ? ' live' : ''}${early ? ' early' : ''}${myPos === 1 && settled ? ' won' : ''}`}
        disabled={!(live || early) || pressed || paused}
        onPointerDown={(e) => { e.preventDefault(); press(e.nativeEvent.timeStamp); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press(e.nativeEvent.timeStamp); } }}
      >
        {myPos > 0 ? <span className="play-pos">{settled ? myPos : '…'}</span>
          : counting ? <span className="play-pos">{cd}</span>
          : lockLeft > 0 ? <span className="play-pos">{(lockLeft / 1000).toFixed(1)}</span>
          : <Bi ru="ОТВЕТИТЬ" tj="ҶАВОБ ДОДАН" />}
      </button>
    );
    if (wrong) status = <Bi ru="Ваш ответ неверный. Отвечают другие команды" tj="Ҷавоби шумо нодуруст. Дастаҳои дигар ҷавоб медиҳанд" />;
    else if (myPos > 0 && !settled) status = <Bi ru="Нажатие принято! Определяем порядок…" tj="Пахш қабул шуд! Тартибро муайян мекунем…" />;
    else if (myPos === 1) status = <b className="play-hot"><Bi ru="Вы первые! Отвечайте ведущему" tj="Шумо аввал! Ба пешбар ҷавоб диҳед" /></b>;
    else if (myPos > 1) status = <Bi ru={`Вы в очереди: №${myPos}`} tj={`Шумо дар навбат: №${myPos}`} />;
    else if (pressed) status = <Bi ru="Отправляем…" tj="Фиристода истодаам…" />;
    else if (lockLeft > 0) status = <b className="play-bad"><Bi ru="Фальстарт! Кнопка заблокирована" tj="Пеш аз вақт! Тугма қуфл аст" /></b>;
    else if (note === 'false_start') status = <b className="play-bad"><Bi ru="Фальстарт! После старта кнопка будет заблокирована на 1,5 с" tj="Пеш аз вақт! Баъди оғоз тугма 1,5 сония қуфл мешавад" /></b>;
    else if (note === 'closed') status = <Bi ru="Не успели — приём закрыт" tj="Нарасидед — қабул баста шуд" />;
    else if (note === 'net') status = <b className="play-bad"><Bi ru="Нажатие не дошло — проверьте связь" tj="Пахш нарасид — алоқаро санҷед" /></b>;
    else if (counting) status = <b className="play-hot"><Bi ru="Приготовьтесь! Жмите, когда отсчёт закончится" tj="Омода шавед! Баъди тамом шудани ҳисоб пахш кунед" /></b>;
    else if (paused) status = <Bi ru="Пауза — ведущий скоро продолжит" tj="Таваққуф — пешбар ба зудӣ давом медиҳад" />;
    else if (live) status = <Bi ru="Знаете ответ? Жмите!" tj="Ҷавобро медонед? Пахш кунед!" />;
    else if (left <= 0) status = <Bi ru="Время вышло" tj="Вақт тамом шуд" />;
    else status = <Bi ru="Слушайте вопрос. Жмите только после старта таймера!" tj="Саволро гӯш кунед. Танҳо баъди оғози таймер пахш кунед!" />;
  }

  const showTimer = !!q && !notMine && (q.mode === 'buzz' || q.mode === 'answer');

  return (
    <GameShell lang="both">
      {!connected && <div className="offline" role="alert"><Bi ru="Нет связи! Проверьте интернет — игра подключится сама" tj="Алоқа нест! Интернетро санҷед — бозӣ худаш пайваст мешавад" /></div>}
      <div className="play" style={tc(me.n)}>
        <div className="play-head">
          <p className="play-team">{myTeamName}</p>
          <p className="play-score"><Bi ru="Счёт" tj="Хол" />: <b className={myScore < 0 ? 'neg' : ''}>{signed(myScore)}</b></p>
        </div>
        {connected && clock.err != null && clock.err > 300 && (
          <p className="play-small play-bad" role="status"><Bi ru="Слабая связь: порядок нажатий считается по времени касания, но лучше перейти ближе к роутеру" tj="Алоқаи суст: тартиби пахшҳо аз рӯи вақти ламс ҳисоб мешавад, аммо ба роутер наздиктар шавед" /></p>
        )}
        {board.lobby && (
          <div className="play-wait">
            <p className="play-hot"><Bi ru="Вы в игре! Ждём остальные команды, ведущий скоро начнёт" tj="Шумо дар бозӣ ҳастед! Дастаҳои дигарро интизорем, пешбар ба зудӣ оғоз мекунад" /></p>
            <p className="play-small"><Bi ru={`Команд в игре: ${teams.length}`} tj={`Дастаҳо дар бозӣ: ${teams.length}`} /></p>
          </div>
        )}
        {showTimer && <div className="play-timer"><TimerView left={left} big /></div>}
        {center}
        {status && !board.lobby && <p className="play-msg" role="status">{status}</p>}
        <details className="play-rules" open={board.lobby || undefined}>
          <summary><Bi ru="Правила игры" tj="Қоидаҳои бозӣ" /></summary>
          <ul>{TEAM_RULES.map((r, i) => <li key={i}><Bi ru={r.ru} tj={r.tj} /></li>)}</ul>
        </details>
        {me.pin && (
          <p className="play-pin"><Bi ru={<>Код команды для возврата: <b>{me.pin}</b></>} tj={<>Рамзи даста барои баргаштан: <b>{me.pin}</b></>} /></p>
        )}
      </div>
    </GameShell>
  );
};

/** Вход без кода (/play): поле для ввода кода игры */
const CodeEntry: React.FC = () => {
  const [v, setV] = useState('');
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const c = v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c) window.location.assign('/play/' + c);
  };
  return (
    <GameShell lang="both">
      <div className="play">
        <h1 className="play-title"><Bi ru="Своя игра" tj="Викторинаи «Своя игра»" /></h1>
        <form className="play-join" onSubmit={go}>
          <label htmlFor="gc"><Bi ru="Код игры (он на экране у ведущего)" tj="Рамзи бозӣ (дар экрани пешбар)" /></label>
          <input id="gc" className="play-code" type="text" maxLength={8} value={v} onChange={(e) => setV(e.target.value.toUpperCase())} autoFocus autoComplete="off" autoCapitalize="characters" />
          <button className="btn primary play-go" disabled={!v.trim()}><Bi ru="Дальше" tj="Давом додан" /></button>
        </form>
      </div>
    </GameShell>
  );
};

export const GamePlay: React.FC<{ code: string }> = ({ code }) => (code ? <PlayGame code={code} /> : <CodeEntry />);
