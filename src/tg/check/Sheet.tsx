import type { ReactNode } from 'react';
import type { Answers, Composition, TicketKey } from '../../../supabase/functions/_shared/omrScore';
import { DIGITS, LETTERS, matchId, questionNumbers, setMatch, setOpen, setTest, testId, type CellId } from './logic';
import { tap } from './telegram';

// Сетка кружков, как на бумажном бланке: ответы ученика, ключ, просмотр сохранённой работы.

/** Ряд кружков. С ключом (expected) виден разбор: верный — зелёный, неверный — красный, правильный ответ обведён */
export function Bubbles({ options, value, expected, label, onChange }: { options: string[]; value: string | null; expected?: string | null; label: string; onChange?: (v: string | null) => void }) {
  return (
    <>
      {options.map((o) => {
        const on = value === o;
        const cls = expected === undefined ? (on ? 'on' : '') : on ? (expected === o ? 'right' : 'wrong') : expected === o ? 'key' : '';
        return (
          <button key={o} type="button" className={`ck-bub ${cls}`} disabled={!onChange} aria-pressed={on} aria-label={`${label}: ${o}${expected === o ? ', верный ответ' : ''}`} onClick={() => { tap(); onChange?.(on ? null : o); }}>
            <i>{o}</i>
          </button>
        );
      })}
    </>
  );
}

interface GridProps {
  comp: Composition;
  answers: Answers;
  onChange?: (a: Answers) => void;
  /** Ключ: показать, что верно и что нет */
  compare?: TicketKey;
  doubtful?: Set<CellId>;
  /** Сколько цифр помещается в ответ открытого вопроса */
  openMax?: number;
  /** Открытые вопросы показывает вызывающий экран сам */
  hideOpen?: boolean;
}

const normOpen = (s: string | null | undefined) => (s ?? '').trim().replace(/^0+(?=\d)/, '');

export function SheetGrid({ comp, answers, onChange, compare, doubtful, openMax = 4, hideOpen }: GridProps) {
  const n = questionNumbers(comp);
  return (
    <div className="ck-sheet">
      <div className="ck-tests" style={{ gridTemplateRows: `repeat(${Math.ceil(comp.test / 2)}, auto)` }}>
        {n.tests.map((q, i) => (
          <div key={q} className={`ck-line ${doubtful?.has(testId(i)) ? 'doubt' : ''}`}>
            <span className="ck-num">{q}</span>
            <Bubbles options={LETTERS} value={answers.tests[i]} expected={compare ? compare.tests[i] : undefined} label={`Тест ${q}`} onChange={onChange && ((v) => onChange(setTest(answers, i, v)))} />
          </div>
        ))}
      </div>
      {comp.matching > 0 && (
        <div className="ck-matches">
          {n.matching.map((q, i) => (
            <div key={q} className="ck-match">
              <b>{q}. Соответствие</b>
              {LETTERS.map((l, r) => (
                <div key={l} className={`ck-line ${doubtful?.has(matchId(i, r)) ? 'doubt' : ''}`}>
                  <span className="ck-num">{l}</span>
                  <Bubbles options={DIGITS} value={answers.matching[i][r]} expected={compare ? compare.matching[i][r] : undefined} label={`Соответствие ${q}, пункт ${l}`} onChange={onChange && ((v) => onChange(setMatch(answers, i, r, v)))} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {!hideOpen && comp.open > 0 && (
        <div>
          {n.open.map((q, i) => {
            const right = compare ? compare.open[i] !== null && normOpen(compare.open[i]) !== '' && normOpen(answers.open[i]) === normOpen(compare.open[i]) : false;
            return (
              <OpenRow key={q} q={q}>
                {onChange
                  ? <input inputMode="numeric" aria-label={`Открытый вопрос ${q}`} value={answers.open[i]} maxLength={openMax} placeholder="—" onChange={(e) => onChange(setOpen(answers, i, e.target.value, openMax))} />
                  : compare && (
                    <span className="ck-val">
                      <span className={right ? 'ck-good' : 'ck-low'}>{answers.open[i] || 'пусто'}</span>
                      {!right && compare.open[i] && <span className="ck-sub" style={{ display: 'inline' }}> верно {compare.open[i]}</span>}
                    </span>
                  )}
              </OpenRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OpenRow({ q, children, pic }: { q: number; children: ReactNode; pic?: ReactNode }) {
  return (
    <div className="ck-open">
      <span className="ck-num">{q}</span>
      <div className="ck-open-pic">{pic ?? <span className="ck-sub" style={{ margin: 0 }}>Открытый вопрос</span>}</div>
      {children}
    </div>
  );
}

export function CompareLegend() {
  return (
    <p className="ck-legend" aria-hidden="true">
      <span><i style={{ background: '#059669' }} />верно</span>
      <span><i style={{ background: '#dc2626' }} />неверно</span>
      <span><i style={{ border: '2.5px solid #059669' }} />правильный ответ</span>
    </p>
  );
}
