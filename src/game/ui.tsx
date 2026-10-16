import React, { createContext, useContext, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import './game.css';
import { ROUNDS, SPECIAL, GameRound } from './data';
import {
  GameBoard, GameBuzz, GameTeam, Lang, formatTime, playUrl, queueOf, signed,
} from './api';

const LangCtx = createContext<Lang>('both');
export const LangProvider = LangCtx.Provider;
export const useLang = () => useContext(LangCtx);

export const roundById = (id: string): GameRound => ROUNDS.find((r) => r.id === id) ?? ROUNDS[0];

/** Подключает шрифты игры и класс .gm; общая обёртка для всех трёх экранов */
export const GameShell: React.FC<{ lang: Lang; fs?: boolean; children: React.ReactNode }> = ({ lang, fs, children }) => {
  useEffect(() => {
    const id = 'game-fonts';
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=Unbounded:wght@500;600;700&display=swap';
    document.head.appendChild(l);
  }, []);
  return (
    <LangProvider value={lang}>
      <div className={`gm${fs ? ' fs' : ''}`}>{children}</div>
    </LangProvider>
  );
};

/** Разметка формул: H_2SO_4 → H₂SO₄, 10^23^ → 10²³. Вход — текст из data.ts (не пользовательский), всё экранируется. */
export function fmt(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/_\{([^}]+)\}/g, '<sub>$1</sub>')
    .replace(/_(\d+)/g, '<sub>$1</sub>')
    .replace(/\^([^^]+)\^/g, (_m, x: string) => '<sup>' + x.replace(/-/g, '−') + '</sup>');
}

export const pick = (lang: Lang, ru: string, tj: string) => (lang === 'ru' ? ru : lang === 'tj' ? tj : `${ru} / ${tj}`);

/** Текст на русском и/или таджикском (два языка — в две строки) */
export const Bi: React.FC<{ ru: React.ReactNode; tj: React.ReactNode }> = ({ ru, tj }) => {
  const lang = useLang();
  if (lang === 'ru') return <>{ru}</>;
  if (lang === 'tj') return <>{tj}</>;
  return (
    <span className="b">
      <span lang="ru">{ru}</span>
      <i lang="tg">{tj}</i>
    </span>
  );
};

/** То же, но с разметкой формул */
export const BiF: React.FC<{ ru: string; tj: string }> = ({ ru, tj }) => (
  <Bi ru={<span dangerouslySetInnerHTML={{ __html: fmt(ru) }} />} tj={<span dangerouslySetInnerHTML={{ __html: fmt(tj) }} />} />
);

/** Табло: категории × стоимость. Без onPick — только показ (проектор). */
export const BoardGrid: React.FC<{ board: GameBoard; onPick?: (ci: number, qi: number) => void }> = ({ board, onPick }) => {
  const lang = useLang();
  const r = roundById(board.round);
  const used = board.used[r.id] || {};
  let total = 0; let done = 0;
  r.cats.forEach((c, ci) => c.qs.forEach((_q, qi) => { total++; if (used[`${ci}-${qi}`]) done++; }));
  return (
    <>
      <div className="board-meta">
        <span><Bi ru={<>Сыграно вопросов: <b>{done}</b> из {total}</>} tj={<>Саволҳои бозидашуда: <b>{done}</b> аз {total}</>} /></span>
        {onPick && <span><Bi ru="Выбирайте тему и стоимость вопроса" tj="Мавзӯъ ва арзиши саволро интихоб кунед" /></span>}
      </div>
      <div className="board-scroll">
        <div className="board" role="grid">
          {r.cats.map((c) => (
            <div className="cat" role="columnheader" key={c.name}><Bi ru={c.name} tj={c.nt} /></div>
          ))}
          {[0, 1, 2, 3, 4].map((qi) => r.cats.map((c, ci) => {
            const isUsed = !!used[`${ci}-${qi}`];
            return (
              <button
                key={`${ci}-${qi}`}
                className={`tile${onPick ? '' : ' ro'}`}
                disabled={isUsed || !onPick}
                onClick={() => onPick?.(ci, qi)}
                aria-label={`${pick(lang, c.name, c.nt)}, ${c.qs[qi].v}${isUsed ? ', ' + pick(lang, 'сыграно', 'бозида шуд') : ''}`}
              >
                <span className="tile-v">{c.qs[qi].v}</span>
              </button>
            );
          }))}
        </div>
      </div>
    </>
  );
};

/** Карточки команд со счётом. Для ведущего (editable) — с переименованием и ±100. */
export const TeamGrid: React.FC<{
  teams: GameTeam[];
  scores: Record<string, number>;
  editable?: {
    onRename: (n: number, name: string) => void;
    onAdjust: (n: number, d: number) => void;
    onRemove: (n: number) => void;
  };
}> = ({ teams, scores, editable }) => {
  const lang = useLang();
  const sc = (n: number) => scores[n] ?? 0;
  const max = teams.length ? Math.max(...teams.map((t) => sc(t.n))) : 0;
  const leaders = teams.filter((t) => sc(t.n) === max).length;
  const sorted = [...teams].sort((a, b) => a.n - b.n);
  return (
    <div className="team-grid">
      {sorted.map((t) => {
        const lead = max > 0 && sc(t.n) === max && leaders === 1;
        return (
          <div className={`team${lead ? ' lead' : ''}`} key={t.n}>
            {lead && <span className="lead-tag">{lang === 'both' ? 'Лидирует · Пешсаф' : pick(lang, 'Лидирует', 'Пешсаф')}</span>}
            {editable ? (
              <TeamNameInput key={t.name} name={t.name} onCommit={(v) => editable.onRename(t.n, v)} label={`${pick(lang, 'Название команды ', 'Номи даста ')}${t.n}`} />
            ) : (
              <div className="tname">{t.name}</div>
            )}
            <div className={`score${sc(t.n) < 0 ? ' neg' : ''}`}>{signed(sc(t.n))}</div>
            {editable && (
              <div className="adj">
                <button onClick={() => editable.onAdjust(t.n, -100)}>−100</button>
                <button onClick={() => editable.onAdjust(t.n, 100)}>+100</button>
                <button onClick={() => editable.onRemove(t.n)} aria-label={pick(lang, 'Убрать команду', 'Дастаро хориҷ кардан')} title={pick(lang, 'Убрать команду', 'Дастаро хориҷ кардан')}>✕</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const TeamNameInput: React.FC<{ name: string; onCommit: (v: string) => void; label: string }> = ({ name, onCommit, label }) => {
  const [v, setV] = useState(name);
  return (
    <input
      type="text" maxLength={24} value={v} aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v.trim() !== name) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
};

/** Очередь нажатий «Ответить»: кто и насколько позже первого */
export const BuzzQueue: React.FC<{ board: GameBoard; teams: GameTeam[]; buzz: GameBuzz[] }> = ({ board, teams, buzz }) => {
  const queue = queueOf(buzz, board.q);
  const name = (n: number) => teams.find((t) => t.n === n)?.name ?? `№${n}`;
  if (!queue.length) {
    return <p className="queue-empty"><Bi ru="Пока никто не нажал «Ответить»" tj="Ҳоло касе «Ҷавоб додан»-ро пахш накардааст" /></p>;
  }
  return (
    <ol className="queue">
      {queue.map((b, i) => (
        <li key={b.n} className={i === 0 ? 'first' : ''}>
          <span className="qpos">{i + 1}</span>
          <span className="qname">{name(b.n)}</span>
          <span className="qdelta">{i === 0 ? '' : `+${((b.t - queue[0].t) / 1000).toFixed(2)} с`}</span>
        </li>
      ))}
    </ol>
  );
};

/** Вопрос: шапка, пометка особой клетки, текст. Общий для ведущего и проектора. */
export const QuestionBody: React.FC<{ board: GameBoard }> = ({ board }) => {
  const lang = useLang();
  const q = board.q;
  if (!q) return null;
  const r = roundById(q.r);
  const c = r.cats[q.ci];
  const item = c.qs[q.qi];
  const sp = item.tag ? SPECIAL[item.tag] : null;
  return (
    <>
      <div className="dlg-head">
        <div><span className="dlg-cat" id="dlg-title">{pick(lang, c.name, c.nt)}</span></div>
        <div>
          {sp && <><span className="badge">{pick(lang, sp.ru, sp.tj)}</span>{' '}</>}
          <span className="dlg-val">{item.v}</span>
        </div>
      </div>
      {sp && (
        <p className="special-note">
          {lang !== 'tj' && <span>{sp.nru}</span>}
          {lang !== 'ru' && <span className={lang === 'both' ? 't' : ''} lang="tg">{sp.ntj}</span>}
        </p>
      )}
      {lang === 'ru' && <p className="q" dangerouslySetInnerHTML={{ __html: fmt(item.q) }} />}
      {lang === 'tj' && <p className="q" lang="tg" dangerouslySetInnerHTML={{ __html: fmt(item.qt) }} />}
      {lang === 'both' && (
        <>
          <p className="q" lang="ru" dangerouslySetInnerHTML={{ __html: fmt(item.q) }} />
          <p className="q-tj" lang="tg" dangerouslySetInnerHTML={{ __html: fmt(item.qt) }} />
        </>
      )}
      {q.shown && (
        <p className="answer">
          <span className="lab">{pick(lang, 'Ответ', 'Ҷавоб')}</span>
          {lang !== 'tj' && <span dangerouslySetInnerHTML={{ __html: fmt(item.a) }} />}
          {lang !== 'ru' && <span className={lang === 'both' ? 't' : ''} lang="tg" dangerouslySetInnerHTML={{ __html: fmt(item.at) }} />}
        </p>
      )}
    </>
  );
};

export const TimerView: React.FC<{ left: number; big?: boolean }> = ({ left, big }) => (
  <span className={`timer${left <= 5 ? ' low' : ''}${big ? ' big' : ''}`} role="timer">{formatTime(left)}</span>
);

/** Полноэкранная ссылка и QR для команд */
export const LinkOverlay: React.FC<{ code: string; teams: GameTeam[]; onClose?: () => void }> = ({ code, teams, onClose }) => {
  const url = playUrl(code);
  const [qr, setQr] = useState('');
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 640, color: { dark: '#04202F', light: '#FFFFFF' } }).then(setQr).catch(() => setQr(''));
  }, [url]);
  return (
    <div className="linkfull" role="dialog" aria-modal="true">
      {onClose && <button className="btn linkfull-close" onClick={onClose}><Bi ru="Закрыть" tj="Пӯшед" /></button>}
      <p className="linkfull-title"><Bi ru="Заходите в игру" tj="Ба бозӣ дароед" /></p>
      <div className="linkfull-body">
        {qr && <img className="linkfull-qr" src={qr} alt="QR" />}
        <div className="linkfull-side">
          <p className="linkfull-hint"><Bi ru="Наведите камеру телефона на QR-код или откройте ссылку:" tj="Камераи телефонро ба рамзи QR равона кунед ё истинодро кушоед:" /></p>
          <p className="linkfull-url">{url.replace(/^https?:\/\//, '')}</p>
          <p className="linkfull-code"><Bi ru="Код игры" tj="Рамзи бозӣ" />: <b>{code}</b></p>
          <p className="linkfull-teams">
            <Bi ru={`Зашли команд: ${teams.length} из 6`} tj={`Дастаҳои ворид шуда: ${teams.length} аз 6`} />
          </p>
          <div className="chips">
            {[...teams].sort((a, b) => a.n - b.n).map((t) => <span key={t.n}>{t.name}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
};

export const GameTitle: React.FC = () => (
  <h1><Bi ru="Своя игра по химии" tj="Викторинаи «Своя игра» аз химия" /></h1>
);
