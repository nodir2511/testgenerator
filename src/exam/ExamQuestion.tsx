import React, { useState } from 'react';
import { FormattedText } from '../components/FormulaEditor';
import { isEmptyQ, matchingAnswer, openDigits, OPEN_CELLS, pickText, sortByOrder, type Answer, type Lang, type SaveStatus } from './examLogic';
import { examTexts, type ExamTexts } from './i18n';

const LETTERS = 'ABCDEFGH';

interface CommonProps { snap: any; n: number; lang: Lang; prevPassageId: string | null }

function Passage({ snap, prevPassageId }: { snap: any; prevPassageId: string | null }) {
  const p = snap.passage;
  if (!p || p.id === prevPassageId) return null;
  return (
    <div className="q-passage">
      {p.title && <b>{p.title}</b>}
      <FormattedText text={p.content || ''} />
    </div>
  );
}

function Head({ snap, n, lang }: { snap: any; n: number; lang: Lang }) {
  const content = pickText(snap, lang, 'content');
  return (
    <>
      <div className="q-head">
        <span className="n">{n}.</span>
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{content ? <FormattedText text={content} /> : null}</div>
      </div>
      {snap.image_url && <img className="q-img" src={snap.image_url} alt="" loading="lazy" />}
    </>
  );
}

const sides = (snap: any) => {
  const items: any[] = snap.matching_items ?? [];
  return {
    left: items.filter((m) => m.side === 'left').sort(sortByOrder),
    right: items.filter((m) => m.side === 'right').sort(sortByOrder),
  };
};

function OptionBody({ o, lang }: { o: any; lang: Lang }) {
  const t = pickText(o, lang);
  return (
    <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      {t && <FormattedText text={t} />}
      {o.image_url && <img src={o.image_url} alt="" loading="lazy" />}
    </span>
  );
}

/** Поле числа: клетки по одной цифре, как на бланке (cells — 4 или 5 по предмету). Каждое изменение сразу идёт наверх (там ответ учитывается в счётчике и сдаче), отправка на сервер — с паузой или по blur */
function OpenField({ value, cells, t, onChange, onEnter }: { value: string; cells: number; t: ExamTexts; onChange: (v: string, deferred: boolean) => void; onEnter?: () => void }) {
  const [draft, setDraft] = useState(openDigits(value, cells));
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const focusAt = (i: number) => setTimeout(() => refs.current[Math.max(0, Math.min(cells - 1, i))]?.focus(), 0);
  const set = (v: string, at: number) => { setDraft(v); onChange(v, true); focusAt(at); };
  return (
    <div className="open-cells" role="group" aria-label={t.openAria} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onChange(draft, false); }}>
      {Array.from({ length: cells }, (_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className="open-cell"
          inputMode="numeric"
          autoComplete="off"
          aria-label={t.digitAria(i + 1)}
          value={draft[i] ?? ''}
          // клик в любую клетку ведёт к первой свободной: цифры идут слева направо без пропусков
          onFocus={(e) => { const t = Math.min(draft.length, cells - 1); if (i !== t) { refs.current[t]?.focus(); } else e.target.select(); }}
          onChange={(e) => {
            const d = openDigits(e.target.value, cells);
            if (!d) return;
            // вставка нескольких цифр или ввод в заполненную клетку: пишем с этой позиции
            const next = openDigits(draft.slice(0, i) + d + draft.slice(i + 1), cells);
            set(next, next.length);
          }}
          onKeyDown={(e) => {
            // Enter: ответ принят (уходит на сервер сразу) и идём к следующему вопросу
            if (e.key === 'Enter') { e.preventDefault(); onChange(draft, false); onEnter?.(); return; }
            if (e.key === 'Backspace' || e.key === 'Delete') {
              e.preventDefault();
              if (draft.length === 0) return;
              const cut = e.key === 'Backspace' && i === draft.length && draft[i] === undefined ? draft.length - 1 : Math.min(i, draft.length - 1);
              const next = draft.slice(0, cut) + draft.slice(cut + 1);
              set(next, next.length);
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const d = openDigits(e.clipboardData.getData('text'), cells);
            if (d) set(d, d.length);
          }}
        />
      ))}
    </div>
  );
}

/** Таблица ответа на соответствие, как на бумажном бланке: строки — левые пункты (A–D), столбцы — правые (1–5), в строке отмечается один кружок */
export function MatchTable({ left, right, answer, onAnswer }: { left: Array<{ id: string }>; right: Array<{ id: string }>; answer: Answer | undefined; onAnswer: (a: Answer) => void }) {
  const current = answer && typeof answer === 'object' ? answer : {};
  return (
    <div className="m-table" style={{ gridTemplateColumns: `32px repeat(${right.length}, minmax(0, 48px))` }}>
      <i aria-hidden="true" />
      {right.map((r, k) => <b key={r.id} aria-hidden="true">{k + 1}</b>)}
      {left.map((l, i) => (
        <div className="m-tr" key={l.id} role="radiogroup" aria-label={LETTERS[i]}>
          <b aria-hidden="true">{LETTERS[i]}</b>
          {right.map((r, k) => {
            const on = current[l.id] === r.id;
            return (
              <button
                key={r.id} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''}
                aria-label={`${LETTERS[i]} — ${k + 1}`}
                onClick={() => {
                  const next = matchingAnswer(answer, l.id, on ? null : r.id);
                  onAnswer(Object.keys(next).length ? next : null);
                }}
              ><i /></button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Вопрос для ответа: варианты, пары, число. Каждое изменение сразу уходит наверх (там сохраняется на сервере). */
export function ExamQuestion({ snap, n, lang, prevPassageId, answer, saveState, onAnswer, onEnter, openCells = OPEN_CELLS }: CommonProps & {
  answer: Answer | undefined; saveState: SaveStatus; onAnswer: (a: Answer, deferred?: boolean) => void; onEnter?: () => void;
  /** сколько клеток у открытого ответа (по предмету, как на бланке) */
  openCells?: number;
}) {
  const t = examTexts(lang);
  if (isEmptyQ(snap)) {
    return <div className="exam-card"><b>{n}.</b> <span className="hint">{t.emptyPlace}</span></div>;
  }
  const options = [...(snap.options ?? [])].sort(sortByOrder);
  const { left, right } = sides(snap);

  return (
    <div className="exam-card" id={`q-${n}`}>
      <Passage snap={snap} prevPassageId={prevPassageId} />
      <Head snap={snap} n={n} lang={lang} />

      {snap.type === 'test' && (
        <div className="opts" role="radiogroup">
          {options.map((o, i) => (
            <button
              key={o.id} type="button" role="radio" aria-checked={answer === o.id}
              className={`opt${answer === o.id ? ' on' : ''}`}
              onClick={() => onAnswer(answer === o.id ? null : o.id)}
            >
              <span className="let">{LETTERS[i]})</span>
              <OptionBody o={o} lang={lang} />
            </button>
          ))}
        </div>
      )}

      {snap.type === 'matching' && (
        <>
          <div className="m-items">
            {left.map((l, i) => (
              <div key={l.id}><b>{LETTERS[i]})</b><FormattedText text={pickText(l, lang)} />{l.image_url && <img className="q-img" src={l.image_url} alt="" loading="lazy" />}</div>
            ))}
          </div>
          <div className="m-items m-second">
            {right.map((r, i) => (
              <div key={r.id}><b>{i + 1})</b><FormattedText text={pickText(r, lang)} />{r.image_url && <img className="q-img" src={r.image_url} alt="" loading="lazy" />}</div>
            ))}
          </div>
          <MatchTable left={left} right={right} answer={answer} onAnswer={onAnswer} />
        </>
      )}

      {snap.type === 'open' && (
        <div style={{ marginTop: 10 }}>
          <OpenField value={typeof answer === 'string' ? answer : ''} cells={openCells} t={t} onChange={(v, deferred) => onAnswer(v === '' ? null : v, deferred)} onEnter={onEnter} />
        </div>
      )}

      {saveState === 'saving' && <div className="q-saving">{t.saving}</div>}
      {saveState === 'failed' && <div className="q-unsaved">{t.saveFailed}</div>}
      {saveState === 'saved' && <div className="q-saved">{t.saved}</div>}
    </div>
  );
}

const None = '—';

/** Вопрос в разборе: условие, ответ ученика и верный ответ. Верное — зелёным, ошибка — красным. */
export function ReviewQuestion({ snap, n, lang, prevPassageId, answer, points, max }: CommonProps & { answer: Answer; points: number; max: number }) {
  if (isEmptyQ(snap)) return null;
  const t = examTexts(lang);
  const options = [...(snap.options ?? [])].sort(sortByOrder);
  const { left, right } = sides(snap);
  const given = answer && typeof answer === 'object' ? answer : {};

  return (
    <div className="exam-card lost">
      <Passage snap={snap} prevPassageId={prevPassageId} />
      <Head snap={snap} n={n} lang={lang} />
      <div className="hint" style={{ marginTop: 4 }}>{t.points(points, max)}</div>

      {snap.type === 'test' && (
        <div className="opts">
          {options.map((o, i) => {
            const cls = o.is_correct ? ' right' : answer === o.id ? ' wrong' : '';
            return (
              <div key={o.id} className={`opt${cls}`}>
                <span className="let">{LETTERS[i]})</span>
                <OptionBody o={o} lang={lang} />
                <span style={{ marginLeft: 'auto', fontSize: 13 }}>{o.is_correct ? t.correct : answer === o.id ? t.yours : ''}</span>
              </div>
            );
          })}
          {answer == null && <div className="rv-line bad">{t.notAnswered}</div>}
        </div>
      )}

      {snap.type === 'matching' && (
        <>
          <div className="m-rights">
            {right.map((r, i) => <div key={r.id}><b>{i + 1})</b><FormattedText text={pickText(r, lang)} /></div>)}
          </div>
          {left.map((l, i) => {
            const mine = right.findIndex((r) => r.id === given[l.id]);
            const key = right.findIndex((r) => r.id === l.correct_match_id);
            const ok = mine >= 0 && mine === key;
            return (
              <div className="m-row" key={l.id}>
                <div><b className="hint">{LETTERS[i]})</b> <FormattedText text={pickText(l, lang)} /></div>
                <div className={`rv-line ${ok ? 'good' : 'bad'}`}>
                  <span className="lbl">{t.yourAnswer}</span>{mine >= 0 ? mine + 1 : None}
                  {' · '}<span className="lbl">{t.rightShort}</span>{key >= 0 ? key + 1 : None}
                </div>
              </div>
            );
          })}
        </>
      )}

      {snap.type === 'open' && (
        <>
          <div className="rv-line bad"><span className="lbl">{t.yourAnswer}</span>{typeof answer === 'string' && answer.trim() ? answer : None}</div>
          <div className="rv-line good"><span className="lbl">{t.rightAnswer}</span>{snap.correct_numeric_answer == null ? None : String(snap.correct_numeric_answer)}</div>
        </>
      )}
    </div>
  );
}
