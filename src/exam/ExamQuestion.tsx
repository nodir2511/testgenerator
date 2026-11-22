import React, { useEffect, useRef, useState } from 'react';
import { FormattedText } from '../components/FormulaEditor';
import { isEmptyQ, matchingAnswer, normalizeOpen, pickText, sortByOrder, type Answer, type Lang } from './examLogic';

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

/** Поле числа: черновик хранится у себя, ответ уходит по blur и через паузу после набора */
function OpenField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const sent = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(onChange);
  latest.current = onChange;

  const flush = (v: string) => {
    clearTimeout(timer.current);
    if (v !== sent.current) { sent.current = v; latest.current(v); }
  };
  const draftRef = useRef(value);
  draftRef.current = draft;
  useEffect(() => () => flush(draftRef.current), []); // уход к другому вопросу не теряет набранное

  return (
    <input
      className="exam-input"
      inputMode="decimal"
      autoComplete="off"
      maxLength={20}
      placeholder="Число"
      value={draft}
      onChange={(e) => {
        const v = normalizeOpen(e.target.value);
        setDraft(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(v), 700);
      }}
      onBlur={() => flush(draft)}
    />
  );
}

/** Вопрос для ответа: варианты, пары, число. Каждое изменение сразу уходит наверх (там сохраняется на сервере). */
export function ExamQuestion({ snap, n, lang, prevPassageId, answer, unsaved, onAnswer }: CommonProps & {
  answer: Answer | undefined; unsaved: boolean; onAnswer: (a: Answer) => void;
}) {
  if (isEmptyQ(snap)) {
    return <div className="exam-card"><b>{n}.</b> <span className="hint">Это место в билете пустое — пропустите его.</span></div>;
  }
  const options = [...(snap.options ?? [])].sort(sortByOrder);
  const { left, right } = sides(snap);
  const current = answer && typeof answer === 'object' ? answer : {};

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
          <div className="m-rights">
            {right.map((r, i) => (
              <div key={r.id}><b>{i + 1})</b><FormattedText text={pickText(r, lang)} />{r.image_url && <img className="q-img" src={r.image_url} alt="" loading="lazy" />}</div>
            ))}
          </div>
          {left.map((l, i) => (
            <div className="m-row" key={l.id}>
              <div><b className="hint">{LETTERS[i]})</b> <FormattedText text={pickText(l, lang)} />{l.image_url && <img className="q-img" src={l.image_url} alt="" loading="lazy" />}</div>
              <div className="m-pick">
                {right.map((r, k) => (
                  <button
                    key={r.id} type="button" className={current[l.id] === r.id ? 'on' : ''}
                    aria-label={`${LETTERS[i]} — ${k + 1}`}
                    onClick={() => {
                      const next = matchingAnswer(answer, l.id, current[l.id] === r.id ? null : r.id);
                      onAnswer(Object.keys(next).length ? next : null);
                    }}
                  >{k + 1}</button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {snap.type === 'open' && (
        <div style={{ marginTop: 10 }}>
          <OpenField value={typeof answer === 'string' ? answer : ''} onChange={(v) => onAnswer(v === '' ? null : v)} />
        </div>
      )}

      {unsaved && <div className="q-unsaved">не сохранено — повторяем отправку…</div>}
    </div>
  );
}

const None = '—';

/** Вопрос в разборе: условие, ответ ученика и верный ответ. Верное — зелёным, ошибка — красным. */
export function ReviewQuestion({ snap, n, lang, prevPassageId, answer, points, max }: CommonProps & { answer: Answer; points: number; max: number }) {
  if (isEmptyQ(snap)) return null;
  const options = [...(snap.options ?? [])].sort(sortByOrder);
  const { left, right } = sides(snap);
  const given = answer && typeof answer === 'object' ? answer : {};

  return (
    <div className="exam-card lost">
      <Passage snap={snap} prevPassageId={prevPassageId} />
      <Head snap={snap} n={n} lang={lang} />
      <div className="hint" style={{ marginTop: 4 }}>Баллы: {points} из {max}</div>

      {snap.type === 'test' && (
        <div className="opts">
          {options.map((o, i) => {
            const cls = o.is_correct ? ' right' : answer === o.id ? ' wrong' : '';
            return (
              <div key={o.id} className={`opt${cls}`}>
                <span className="let">{LETTERS[i]})</span>
                <OptionBody o={o} lang={lang} />
                <span style={{ marginLeft: 'auto', fontSize: 13 }}>{o.is_correct ? 'верный' : answer === o.id ? 'ваш' : ''}</span>
              </div>
            );
          })}
          {answer == null && <div className="rv-line bad">Вы не ответили</div>}
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
                  <span className="lbl">Ваш ответ: </span>{mine >= 0 ? mine + 1 : None}
                  {' · '}<span className="lbl">Верный: </span>{key >= 0 ? key + 1 : None}
                </div>
              </div>
            );
          })}
        </>
      )}

      {snap.type === 'open' && (
        <>
          <div className="rv-line bad"><span className="lbl">Ваш ответ: </span>{typeof answer === 'string' && answer.trim() ? answer : None}</div>
          <div className="rv-line good"><span className="lbl">Верный ответ: </span>{snap.correct_numeric_answer == null ? None : String(snap.correct_numeric_answer)}</div>
        </>
      )}
    </div>
  );
}
