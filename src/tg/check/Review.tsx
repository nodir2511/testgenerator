import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { maxPoints, scoreAnswers, type Answers, type TicketKey } from '../../../supabase/functions/_shared/omrScore';
import { answersFromResult, keyFromAnswers, qualityWarnings, variantFromResult } from '../../lib/omr/answers';
import { collectEnabled, collectSamples, guessOpen, loadDigitModel, type OpenHint } from '../../lib/omr/model';
import { VARIANTS, WHY, count, doubtRows, missingCount, percent, setMatch, setOpen, setTest, tone, LETTERS, DIGITS, type CellId, type DoubtRow, type Ok } from './logic';
import type { Api } from './Results';
import { openCells, type CustomKey } from './CustomKeys';
import { Crop, SheetPhoto } from './pictures';
import type { Sheet } from '../../lib/omr/process';
import { matchRect, openRect, testRect, variantRect } from '../../lib/omr/rectify';
import { Bubbles, CompareLegend, OpenRow, SheetGrid } from './Sheet';

export interface KeySource {
  kind: 'set' | 'custom';
  id: string;
  batchId?: string;
  title: string;
  comp: { test: number; matching: number; open: number };
  layouts: string[];
  keys: Record<number, TicketKey>;
}

function DigitPic({ box }: { box: Ok['open'][number]['boxes'][number] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const k = 3;
    cv.width = box.cols * k;
    cv.height = box.rows * k;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000';
    for (let r = 0; r < box.rows; r++) for (let c = 0; c < box.cols; c++) if (box.bitmap[r * box.cols + c]) ctx.fillRect(c * k, r * k, k, k);
  }, [box]);
  return <canvas ref={ref} aria-hidden="true" style={{ height: 40, width: 'auto', border: '1px solid var(--line)', borderRadius: 4, background: '#fff' }} />;
}

/** Модель цифр: примеры загружаются один раз за сеанс */
export const digitModel = (api: Api) => loadDigitModel(async () => (await api<{ samples: Array<{ d: number; px: string }> }>('digits_get')).samples);

/** Подставляет подсказки по цифрам в пустые поля открытых вопросов, когда модель загрузилась */
function useDigitHints(api: Api, res: Ok, setAnswers: Dispatch<SetStateAction<Answers>>, fill = true): Array<OpenHint | null> {
  const [hints, setHints] = useState<Array<OpenHint | null>>([]);
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    let off = false;
    void digitModel(apiRef.current).then((knn) => {
      if (off) return;
      const h = res.open.map((o) => guessOpen(knn, o));
      setHints(h);
      if (fill) setAnswers((a) => ({ ...a, open: a.open.map((x, i) => (x === '' && h[i] ? h[i]!.text : x)) }));
    });
    return () => { off = true; };
  }, [res, setAnswers, fill]);
  return hints;
}

// ---------- общие части проверки и эталона ----------
function QualityNote({ res, onRetake, label }: { res: Ok; onRetake: () => void; label: string }) {
  const warnings = useMemo(() => qualityWarnings(res), [res]);
  const [hidden, setHidden] = useState(false);
  if (!warnings.length || hidden) return null;
  return (
    <div className="ck-note warn" role="status">
      <b>Снимок читается ненадёжно</b>
      {warnings.map((w) => <span key={w} style={{ display: 'block' }}>{w}</span>)}
      <div className="ck-pair" style={{ marginTop: 10 }}>
        <button className="tg-btn-secondary" onClick={onRetake}><RotateCcw size={18} aria-hidden="true" />{label}</button>
        <button className="tg-btn-secondary" onClick={() => setHidden(true)}>Всё равно проверить</button>
      </div>
    </div>
  );
}

/** Сомнительные ответы: по строке на каждый; правка или «Верно» убирает строку из счётчика */
function Doubts({ rows, sheet, done, answers, setAnswers, onDone }: { rows: DoubtRow[]; sheet?: Sheet; done: Set<CellId>; answers: Answers; setAnswers: (a: Answers) => void; onDone: (id: CellId) => void }) {
  if (!rows.length) return null;
  const left = rows.filter((d) => !done.has(d.id)).length;
  return (
    <>
      <h2 className="ck-section">Проверьте по бланку<small>{left ? `осталось ${left} из ${rows.length}` : 'всё просмотрено'}</small></h2>
      <div className="ck-card">
        {rows.map((d) => {
          const ok = done.has(d.id);
          const value = d.kind === 'test' ? answers.tests[d.index] : answers.matching[d.index][d.row];
          return (
            <div key={d.id} className={`ck-doubt ${ok ? 'ok' : ''}`}>
              <div className="ck-doubt-head"><b>{d.label}</b><span>{ok ? 'просмотрено' : WHY[d.why]}</span>
                {d.why !== 'empty' && <button className="ck-text" disabled={ok} onClick={() => onDone(d.id)}><Check size={18} aria-hidden="true" />Верно</button>}
              </div>
              {sheet && <Crop sheet={sheet} rect={(l) => (d.kind === 'test' ? testRect(l, d.index) : matchRect(l, d.index, d.row))} label={`Задание ${d.label} на бланке`} />}
              <div className="ck-line">
                <Bubbles options={d.kind === 'test' ? LETTERS : DIGITS} value={value} label={`Задание ${d.label}`} onChange={(v) => { setAnswers(d.kind === 'test' ? setTest(answers, d.index, v) : setMatch(answers, d.index, d.row, v)); onDone(d.id); }} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function OpenAnswers({ res, sheet, answers, setAnswers, hints }: { res: Ok; sheet?: Sheet; answers: Answers; setAnswers: (a: Answers) => void; hints: Array<OpenHint | null> }) {
  if (!res.open.length) return null;
  return (
    <>
      <h2 className="ck-section">Открытые вопросы</h2>
      <div className="ck-card">
        {res.open.map((o, i) => {
          const h = hints[i], fromHint = !!h && answers.open[i] === h.text, max = o.boxes.length;
          return (
            <OpenRow key={o.q} q={o.q} pic={!o.boxes.some((b) => b.hasDigit) ? <span className="ck-sub" style={{ margin: 0 }}>клетки пустые</span> : sheet ? <Crop sheet={sheet} rect={(l) => openRect(l, i)} label={`Ответ ${o.q} на бланке`} /> : o.boxes.map((b, j) => (b.hasDigit ? <DigitPic key={j} box={b} /> : null))}>
              <input className={fromHint && h!.unsure ? 'check' : ''} inputMode="numeric" maxLength={max} value={answers.open[i]} placeholder="—" aria-label={`Открытый вопрос ${o.q}${fromHint ? ', прочитано с бланка, проверьте' : ''}`} onChange={(e) => setAnswers(setOpen(answers, i, e.target.value, max))} />
            </OpenRow>
          );
        })}
        {hints.some((h, i) => h && answers.open[i] === h.text) && <p className="ck-sub" style={{ marginTop: 8 }}>Числа прочитаны с бланка — сверьте с рисунком. Жёлтые прочитаны неуверенно.</p>}
      </div>
    </>
  );
}

export interface Saved { id: string; student: string; score: number; max: number; ticket: number; createdAt: string }

/** Правки учителя по одному снимку: не теряются при выходе из разбора и при отмене сохранения */
export interface Draft { answers: Answers; variant: string; student: string; done: Set<CellId> }

export function Review({ api, src, res, sheet, title, left, draft, onDraft, onDone, onError, onRetake }: { api: Api; src: KeySource; res: Ok; sheet?: Sheet; title: string; left: number; draft?: Draft; onDraft: (d: Draft) => void; onDone: (r: Saved) => void; onError: (e: unknown) => void; onRetake: () => void }) {
  const [answers, setAnswers] = useState<Answers>(() => draft?.answers ?? answersFromResult(res));
  const [variant, setVariant] = useState<string>(() => draft?.variant ?? String(variantFromResult(res) ?? ''));
  const [student, setStudent] = useState(draft?.student ?? '');
  const [all, setAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false); // второе нажатие до перерисовки не должно сохранить работу дважды
  const [done, setDone] = useState<Set<CellId>>(draft?.done ?? new Set());
  const [hadDraft] = useState(!!draft);
  useEffect(() => { onDraft({ answers, variant, student, done }); }, [answers, variant, student, done]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => doubtRows(res, false), [res]);
  const doubtful = useMemo(() => new Set(rows.filter((d) => !done.has(d.id)).map((d) => d.id)), [rows, done]);
  const hints = useDigitHints(api, res, setAnswers, !hadDraft);
  const key = src.keys[Number(variant)];
  const score = key ? scoreAnswers(key, answers) : null;
  const variants = Object.keys(src.keys).sort((a, b) => Number(a) - Number(b));
  const read = variantFromResult(res);
  const max = maxPoints(src.comp);

  async function save() {
    if (!key || !score || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const r = await api<{ id: string }>('check_save', {
        batchId: src.batchId, ticketNumber: Number(variant), comp: src.comp, layout: src.layouts[0], student,
        answers, ...(src.kind === 'custom' ? { key } : {}),
      });
      if (collectEnabled()) {
        const samples = collectSamples(res.open, answers.open, hints);
        if (samples.length) void api('digits_save', { samples, layout: src.layouts[0] }).catch(() => { /* сбор не мешает работе */ });
      }
      onDone({ id: r.id, student: student.trim(), score: score.score, max: score.max, ticket: Number(variant), createdAt: new Date().toISOString() });
    } catch (e) { onError(e); setSaving(false); busy.current = false; }
  }

  return (
    <div className="ck-withdock">
      <h1>{title}</h1>
      <p className="ck-p">{left > 1 ? `В стопке ещё ${count(left - 1, 'работа', 'работы', 'работ')}` : 'Последняя работа в стопке'}</p>
      <QualityNote res={res} onRetake={onRetake} label="Переснять" />
      {sheet && <SheetPhoto sheet={sheet} />}
      <div className="ck-card">
        <b>Вариант</b>
        {read === null && sheet && <Crop sheet={sheet} rect={variantRect} label="Вариант на бланке" />}
        {read === null && <p className="ck-sub">На бланке вариант не отмечен или отмечено несколько. Выберите сами.</p>}
        {read !== null && !src.keys[read] && <p className="ck-sub">На бланке отмечен вариант {read}, но ключа для него нет.</p>}
        <div className="tg-chips">
          {variants.map((v) => <button key={v} className={`tg-chip ${variant === v ? 'on' : ''}`} aria-pressed={variant === v} onClick={() => setVariant(v)}>{v}</button>)}
        </div>
        <label className="tg-field" style={{ margin: '12px 0 0' }}><span>Ученик, если нужно</span><input value={student} maxLength={120} onChange={(e) => setStudent(e.target.value)} placeholder="Фамилия и имя или номер" /></label>
      </div>
      <Doubts rows={rows} sheet={sheet} done={done} answers={answers} setAnswers={setAnswers} onDone={(id) => setDone((s) => new Set(s).add(id))} />
      <OpenAnswers res={res} sheet={sheet} answers={answers} setAnswers={setAnswers} hints={hints} />
      <button className="tg-btn-secondary" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Скрыть все ответы' : 'Показать все ответы'}</button>
      {all && (
        <div className="ck-card" style={{ marginTop: 10 }}>
          {key && <CompareLegend />}
          <SheetGrid comp={src.comp} answers={answers} onChange={setAnswers} compare={key} doubtful={doubtful} hideOpen />
        </div>
      )}
      <div className="ck-dock"><div className="ck-dock-in">
        <div aria-live="polite">
          {score
            ? <><div className={`ck-score ck-${tone(score.score, max)}`}>{score.score} <small>из {max}</small></div><span className="ck-sub" style={{ margin: 0 }}>{percent(score.score, max)} %{doubtful.size ? `, проверить ${count(doubtful.size, 'ответ', 'ответа', 'ответов')}` : ''}</span></>
            : <span className="ck-sub">Выберите вариант, чтобы увидеть балл</span>}
        </div>
        <button className="tg-btn-primary" disabled={saving || !key} onClick={() => void save()}>{saving ? 'Сохраняю…' : 'Сохранить'}</button>
      </div></div>
    </div>
  );
}

export function RefReview({ api, c, res, sheet, onSave, onRetake }: { api: Api; c: CustomKey; res: Ok; sheet?: Sheet; onSave: (n: number, key: TicketKey) => void; onRetake: () => void }) {
  const [answers, setAnswers] = useState<Answers>(() => answersFromResult(res));
  const [variant, setVariant] = useState<string>(() => String(variantFromResult(res) ?? ''));
  const [done, setDone] = useState<Set<CellId>>(new Set());
  const hints = useDigitHints(api, res, setAnswers);
  const rows = useMemo(() => doubtRows(res, true), [res]);
  const doubtful = useMemo(() => new Set(rows.filter((d) => !done.has(d.id)).map((d) => d.id)), [rows, done]);
  const missing = missingCount(answers);
  const replace = variant && c.keys[Number(variant)];
  return (
    <div className="ck-withdock">
      <h1>Ключ с эталона</h1>
      <p className="ck-p">Сверьте прочитанное с бланком. В ключе должны быть заполнены все задания.</p>
      <QualityNote res={res} onRetake={onRetake} label="Другое фото" />
      {sheet && <SheetPhoto sheet={sheet} />}
      <div className="ck-card">
        <b>Вариант</b>
        {variantFromResult(res) === null && <p className="ck-sub">На бланке вариант не отмечен или отмечено несколько. Выберите сами.</p>}
        <div className="tg-chips">
          {VARIANTS.map((v) => <button key={v} className={`tg-chip ${variant === v ? 'on' : ''}`} aria-pressed={variant === v} onClick={() => setVariant(v)}>{v}</button>)}
        </div>
        {replace && <p className="ck-sub" style={{ marginTop: 8 }}>Ключ варианта {variant} уже записан, он заменится.</p>}
      </div>
      <Doubts rows={rows} sheet={sheet} done={done} answers={answers} setAnswers={setAnswers} onDone={(id) => setDone((s) => new Set(s).add(id))} />
      <OpenAnswers res={res} sheet={sheet} answers={answers} setAnswers={setAnswers} hints={hints} />
      <h2 className="ck-section">Все ответы<small>{missing ? `не заполнено: ${missing}` : 'заполнено'}</small></h2>
      <div className="ck-card"><SheetGrid comp={c.comp} answers={answers} onChange={setAnswers} doubtful={doubtful} openMax={openCells(c.layouts)} hideOpen /></div>
      <div className="ck-dock"><div className="ck-dock-in">
        <button className="tg-btn-primary wide" disabled={!variant || missing > 0} onClick={() => onSave(Number(variant), keyFromAnswers(answers, c.comp))}>
          {!variant ? 'Выберите вариант' : missing ? `Осталось заполнить: ${missing}` : `Записать ключ варианта ${variant}`}
        </button>
      </div></div>
    </div>
  );
}
