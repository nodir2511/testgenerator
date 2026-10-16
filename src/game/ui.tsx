import React, { createContext, useContext, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import './game.css';
import { FormattedText } from '../components/FormulaEditor';
import { INTRO_SLIDES, SPECIAL } from './content';
import {
  GameBoard, GameBuzz, GameTeam, LayoutRound, Lang, formatTime, playUrl, queueOf, signed, standings, teamColor,
} from './api';

const LangCtx = createContext<Lang>('both');
export const LangProvider = LangCtx.Provider;
export const useLang = () => useContext(LangCtx);

export const layoutRound = (board: GameBoard, id?: string): LayoutRound | null =>
  board.layout.find((r) => r.id === (id ?? board.round)) ?? board.layout[0] ?? null;

/** Подключает шрифты игры и класс .gm; общая обёртка для всех экранов */
export const GameShell: React.FC<{ lang: Lang; fs?: boolean; proj?: boolean; children: React.ReactNode }> = ({ lang, fs, proj, children }) => {
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
      <div className={`gm${fs ? ' fs' : ''}${proj ? ' proj' : ''}`}>{children}</div>
    </LangProvider>
  );
};

/** Разметка формул пакета игры: H_2SO_4 → H₂SO₄, 10^23^ → 10²³. Всё экранируется. */
export function fmt(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/_\{([^}]+)\}/g, '<sub>$1</sub>')
    .replace(/_(\d+)/g, '<sub>$1</sub>')
    .replace(/\^([^^]+)\^/g, (_m, x: string) => '<sup>' + x.replace(/-/g, '−') + '</sup>');
}

/** Текст вопроса/ответа: разметка игры или (для банка сайта) разметка сайта */
export const QT: React.FC<{ text: string; bank?: boolean }> = ({ text, bank }) =>
  bank ? <FormattedText text={text} /> : <span dangerouslySetInnerHTML={{ __html: fmt(text) }} />;

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

export const tc = (n: number) => ({ '--tc': teamColor(n) } as React.CSSProperties);

export const teamName = (teams: GameTeam[], n: number | null | undefined) =>
  n == null ? '' : teams.find((t) => t.n === n)?.name ?? `№${n}`;

/** Табло: категории × стоимость. Без onPick — только показ (проектор). */
export const BoardGrid: React.FC<{ board: GameBoard; roundId?: string; onPick?: (ci: number, qi: number) => void; teams?: GameTeam[] }> = ({ board, roundId, onPick, teams }) => {
  const lang = useLang();
  const r = layoutRound(board, roundId);
  if (!r) return <p className="queue-empty">…</p>;
  const used = board.used[r.id] || {};
  const rows = Math.max(...r.cats.map((c) => c.values.length));
  let total = 0; let done = 0;
  r.cats.forEach((c, ci) => c.values.forEach((_v, qi) => { total++; if (used[`${ci}-${qi}`]) done++; }));
  const chooser = teams ? teamName(teams, board.chooser) : '';
  return (
    <>
      <div className="board-meta">
        <span><Bi ru={<>Сыграно вопросов: <b>{done}</b> из {total}</>} tj={<>Саволҳои бозидашуда: <b>{done}</b> аз {total}</>} /></span>
        {chooser
          ? <span className="chooser-tag"><Bi ru={<>Выбирает вопрос: <b>{chooser}</b></>} tj={<>Саволро интихоб мекунад: <b>{chooser}</b></>} /></span>
          : onPick && <span><Bi ru="Выбирайте тему и стоимость вопроса" tj="Мавзӯъ ва арзиши саволро интихоб кунед" /></span>}
      </div>
      <div className="board-scroll">
        <div className="board" role="grid" style={{ gridTemplateColumns: `repeat(${r.cats.length}, minmax(0, 1fr))` }}>
          {r.cats.map((c) => (
            <div className={`cat${c.name.length > 22 ? ' long' : ''}${c.name.length > 30 ? ' xlong' : ''}`} role="columnheader" key={c.name}><Bi ru={c.name} tj={c.nt} /></div>
          ))}
          {Array.from({ length: rows }, (_x, qi) => r.cats.map((c, ci) => {
            const isUsed = !!used[`${ci}-${qi}`];
            const v = c.values[qi];
            if (v == null) return <span key={`${ci}-${qi}`} />;
            return (
              <button
                key={`${ci}-${qi}`}
                className={`tile${onPick ? '' : ' ro'}${isUsed ? ' used' : ''}`}
                disabled={isUsed || !onPick}
                onClick={() => onPick?.(ci, qi)}
                aria-label={`${pick(lang, c.name, c.nt)}, ${v}${isUsed ? ', ' + pick(lang, 'сыграно', 'бозида шуд') : ''}`}
              >
                <span className="tile-v">{v}</span>
              </button>
            );
          }))}
        </div>
      </div>
    </>
  );
};

/** Карточки команд со счётом. Для ведущего (editable) — переименование, ±100, «выбирает». */
export const TeamGrid: React.FC<{
  teams: GameTeam[];
  scores: Record<string, number>;
  chooser?: number | null;
  /** Коды команд для возврата (только ведущему) */
  pins?: Record<string, string>;
  editable?: {
    onRename: (n: number, name: string) => void;
    onAdjust: (n: number, d: number) => void;
    onRemove: (n: number) => void;
    onChooser: (n: number) => void;
  };
}> = ({ teams, scores, chooser, pins, editable }) => {
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
          <div className={`team${lead ? ' lead' : ''}${chooser === t.n ? ' choosing' : ''}`} key={t.n} style={tc(t.n)}>
            <div className="team-tags">
              {lead && <span className="lead-tag">{lang === 'both' ? 'Лидирует · Пешсаф' : pick(lang, 'Лидирует', 'Пешсаф')}</span>}
              {chooser === t.n && <span className="choose-tag">▶ {lang === 'both' ? 'Выбирает · Интихоб мекунад' : pick(lang, 'Выбирает', 'Интихоб мекунад')}</span>}
            </div>
            {editable ? (
              <TeamNameInput key={t.name} name={t.name} onCommit={(v) => editable.onRename(t.n, v)} label={`${pick(lang, 'Название команды ', 'Номи даста ')}${t.n}`} />
            ) : (
              <div className="tname">{t.name}</div>
            )}
            <div className={`score${sc(t.n) < 0 ? ' neg' : ''}`}>{signed(sc(t.n))}</div>
            {pins?.[t.n] && <div className="team-pin" title={pick(lang, 'Код команды для возврата в игру', 'Рамзи даста барои баргаштан ба бозӣ')}>{pick(lang, 'код', 'рамз')} {pins[t.n]}</div>}
            {editable && (
              <div className="adj">
                <button onClick={() => editable.onAdjust(t.n, -100)}>−100</button>
                <button onClick={() => editable.onAdjust(t.n, 100)}>+100</button>
                <button onClick={() => editable.onChooser(t.n)} title={pick(lang, 'Эта команда выбирает вопрос', 'Ин даста саволро интихоб мекунад')} aria-pressed={chooser === t.n}>☝</button>
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
  if (!queue.length) {
    return <p className="queue-empty"><Bi ru="Пока никто не нажал «Ответить»" tj="Ҳоло касе «Ҷавоб додан»-ро пахш накардааст" /></p>;
  }
  return (
    <ol className="queue">
      {queue.map((b, i) => (
        <li key={b.n} className={i === 0 ? 'first' : ''} style={tc(b.n)}>
          <span className="qpos">{i + 1}</span>
          <span className="qname">{teamName(teams, b.n)}</span>
          <span className="qdelta">{i === 0 ? '' : `+${((b.t - queue[0].t) / 1000).toFixed(2)} с`}</span>
        </li>
      ))}
    </ol>
  );
};

/** «Верно!» — команда ответила, вопрос ещё открыт, чтобы класс увидел ответ */
export const WonBanner: React.FC<{ board: GameBoard; teams: GameTeam[] }> = ({ board, teams }) => {
  const q = board.q;
  if (!q || q.won == null) return null;
  const who = teamName(teams, q.won);
  return (
    <p className="won-banner" role="status" style={tc(q.won)}>
      <Bi ru={<>✓ Верно! <b>{who}</b> +{q.pts}</>} tj={<>✓ Дуруст! <b>{who}</b> +{q.pts}</>} />
    </p>
  );
};

/** Состояние особого вопроса (кот, аукцион) и кто отвечает — для ведущего и проектора */
export const ModeStatus: React.FC<{ board: GameBoard; teams: GameTeam[]; bidders?: number[] }> = ({ board, teams, bidders }) => {
  const q = board.q;
  if (!q || q.won != null) return null;
  if (q.mode === 'cat') {
    const who = teamName(teams, q.chooser);
    return (
      <p className="armed" role="status">
        {who
          ? <Bi ru={<>«Кот в мешке»: <b>{who}</b> выбирает на телефоне, кому передать вопрос…</>} tj={<>«Гурба дар халта»: <b>{who}</b> дар телефон интихоб мекунад, ки саволро ба кӣ диҳад…</>} />
          : <Bi ru="«Кот в мешке»: ведущий отмечает, какая команда выбрала вопрос" tj="«Гурба дар халта»: пешбар дастаи интихобкардаро қайд мекунад" />}
      </p>
    );
  }
  if (q.mode === 'bids') {
    const done = bidders?.length ?? 0;
    return (
      <p className="armed" role="status">
        <Bi ru={<>«Аукцион»: команды делают ставки на телефонах — {done} из {teams.length}</>} tj={<>«Аукцион»: дастаҳо дар телефонҳо нарх мегузоранд — {done} аз {teams.length}</>} />
      </p>
    );
  }
  if (q.mode === 'answer') {
    const who = teamName(teams, q.answerer);
    return (
      <div className="buzz" role="status">
        {who ? <Bi ru={<>Отвечает: <b>{who}</b>{q.tag === 'auction' && <> · ставка {q.pts}</>}</>} tj={<>Ҷавоб медиҳад: <b>{who}</b>{q.tag === 'auction' && <> · нарх {q.pts}</>}</>} />
          : <Bi ru="Никто не сделал ставку — отвечающего выбирает ведущий" tj="Касе нарх нагузошт — ҷавобдиҳандаро пешбар интихоб мекунад" />}
        {q.bids && q.bids.length > 0 && (
          <div className="bids">
            {q.bids.map((b) => <span key={b.n} style={tc(b.n)}>{teamName(teams, b.n)}: <b>{b.amount}</b></span>)}
          </div>
        )}
      </div>
    );
  }
  return null;
};

/** Вопрос: шапка, пометка особой клетки, текст. hideText — скрыть текст до ставок/передачи (проектор). */
export const QuestionBody: React.FC<{ board: GameBoard; hideText?: boolean }> = ({ board, hideText }) => {
  const lang = useLang();
  const q = board.q;
  if (!q) return null;
  const sp = q.tag ? SPECIAL[q.tag] : null;
  const t = q.text;
  return (
    <>
      <div className="dlg-head">
        <div><span className="dlg-cat" id="dlg-title">{q.extra ? pick(lang, 'Дополнительный вопрос', 'Саволи иловагӣ') : pick(lang, q.cat, q.catt)}</span></div>
        <div>
          {sp && <><span className="badge">{pick(lang, sp.ru, sp.tj)}</span>{' '}</>}
          <span className="dlg-val">{q.pts}</span>
        </div>
      </div>
      {sp && (
        <p className="special-note">
          {lang !== 'tj' && <span>{sp.nru}</span>}
          {lang !== 'ru' && <span className={lang === 'both' ? 't' : ''} lang="tg">{sp.ntj}</span>}
        </p>
      )}
      {hideText ? (
        <p className="q q-hidden"><Bi ru="Вопрос откроется, когда будет ясно, кто отвечает" tj="Савол вақте кушода мешавад, ки ҷавобдиҳанда маълум шавад" /></p>
      ) : (
        <>
          {lang !== 'tj' && <p className="q" lang="ru"><QT text={t.q} bank={t.bank} /></p>}
          {lang !== 'ru' && t.qt && <p className={lang === 'both' ? 'q-tj' : 'q'} lang="tg"><QT text={t.qt} bank={t.bank} /></p>}
          {t.image && <img className="q-img" src={t.image} alt="" />}
          {t.options && t.options.length > 0 && (
            <ol className="q-opts">
              {t.options.map((o, i) => (
                <li key={i}>
                  <span className="q-opt-l">{String.fromCharCode(65 + i)}</span>
                  <span>
                    {lang !== 'tj' && <QT text={o.ru} bank />}
                    {lang === 'both' && o.tj && o.tj !== o.ru && <span className="t"> / </span>}
                    {lang !== 'ru' && o.tj && (lang === 'tj' || o.tj !== o.ru) && <QT text={o.tj} bank />}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {q.shown && q.ans && (
        <p className="answer">
          <span className="lab">{pick(lang, 'Ответ', 'Ҷавоб')}</span>
          {lang !== 'tj' && <span><QT text={q.ans.a} bank={t.bank} /></span>}
          {lang !== 'ru' && q.ans.at && <span className={lang === 'both' ? 't' : ''} lang="tg"><QT text={q.ans.at} bank={t.bank} /></span>}
        </p>
      )}
    </>
  );
};

export const TimerView: React.FC<{ left: number; big?: boolean }> = ({ left, big }) => (
  <span className={`timer${left <= 5 ? ' low' : ''}${big ? ' big' : ''}`} role="timer">{formatTime(left)}</span>
);

/** Пьедестал: 1–3 места и остальные */
export const Podium: React.FC<{ board: GameBoard; teams: GameTeam[] }> = ({ board, teams }) => {
  const list = standings(teams, board.scores);
  const top = [2, 1, 3].map((p) => list.filter((t) => t.place === p));
  const rest = list.filter((t) => t.place > 3);
  return (
    <div className="podium-wrap">
      <p className="podium-title"><Bi ru="Итоги игры" tj="Натиҷаҳои бозӣ" /></p>
      <div className="podium">
        {top.map((group, i) => {
          const place = [2, 1, 3][i];
          return (
            <div className={`pod pod-${place}`} key={place}>
              <div className="pod-names">
                {group.length ? group.map((t) => <div key={t.n} className="pod-name" style={tc(t.n)}><span className="pod-nm">{t.name}</span><span className="pod-score">{signed(t.score)}</span></div>) : <div className="pod-name pod-empty">—</div>}
              </div>
              <div className="pod-step"><span>{place}</span></div>
            </div>
          );
        })}
      </div>
      {rest.length > 0 && (
        <ol className="pod-rest">
          {rest.map((t) => <li key={t.n} style={tc(t.n)}><b>{t.place}.</b> {t.name} — {signed(t.score)}</li>)}
        </ol>
      )}
    </div>
  );
};

/** Слайд мини-презентации на весь экран. С controls — для ведущего (листает), без — для проектора. */
export const IntroOverlay: React.FC<{ index: number; controls?: { onPrev: () => void; onNext: () => void; onSkip: () => void; projectorHref?: string } }> = ({ index, controls }) => {
  const s = INTRO_SLIDES[Math.min(index, INTRO_SLIDES.length - 1)];
  const last = index >= INTRO_SLIDES.length - 1;
  return (
    <div className="linkfull intro" role="dialog" aria-modal="true">
      <div className="intro-dots" aria-hidden="true">{INTRO_SLIDES.map((_x, i) => <span key={i} className={i === index ? 'on' : i < index ? 'past' : ''} />)}</div>
      <div className="intro-icon" aria-hidden="true">{s.icon}</div>
      <h2 className="intro-title"><Bi ru={s.title.ru} tj={s.title.tj} /></h2>
      <ul className="intro-lines">
        {s.lines.map((l, i) => <li key={i}><Bi ru={l.ru} tj={l.tj} /></li>)}
      </ul>
      {controls && (
        <div className="lobby-actions">
          <button className="btn" onClick={controls.onPrev} disabled={index <= 0}>← <Bi ru="Назад" tj="Ба қафо" /></button>
          <button className="btn primary lobby-start" onClick={controls.onNext}>{last ? <Bi ru="Показать QR-код →" tj="Нишон додани QR →" /> : <Bi ru="Дальше →" tj="Минбаъд →" />}</button>
          {controls.projectorHref && <a className="btn primary" href={controls.projectorHref} target="_blank" rel="noreferrer">📽 <Bi ru="Показать на проекторе" tj="Дар проектор нишон диҳед" /></a>}
          <button className="btn" onClick={controls.onSkip}><Bi ru="Пропустить презентацию" tj="Гузаштан аз муаррифӣ" /></button>
        </div>
      )}
    </div>
  );
};

/** Полноэкранная ссылка и QR для команд */
export const LinkOverlay: React.FC<{ code: string; teams: GameTeam[]; onClose?: () => void; footer?: React.ReactNode; onRemove?: (n: number) => void; closed?: boolean }> = ({ code, teams, onClose, footer, onRemove, closed }) => {
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
          {closed && <p className="gate-err"><Bi ru="Вход закрыт ведущим" tj="Воридшавӣ аз тарафи пешбар баста шуд" /></p>}
          <p className="linkfull-teams">
            <Bi ru={`Зашли команд: ${teams.length} из 6`} tj={`Дастаҳои ворид шуда: ${teams.length} аз 6`} />
          </p>
          <div className="chips">
            {[...teams].sort((a, b) => a.n - b.n).map((t) => <span key={t.n} style={tc(t.n)}>{t.name}{onRemove && <button className="chip-x" onClick={() => onRemove(t.n)} aria-label="Убрать команду">✕</button>}</span>)}
          </div>
          {footer}
        </div>
      </div>
    </div>
  );
};

export const GameTitle: React.FC = () => (
  <h1><Bi ru="Своя игра по химии" tj="Викторинаи «Своя игра» аз химия" /></h1>
);
