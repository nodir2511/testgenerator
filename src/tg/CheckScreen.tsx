import React, { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  BLANKS, MATCHING_ROWS, blankFor, keyToText, maxPoints, parseKey, scoreAnswers,
  type Answers, type Composition, type TicketKey,
} from '../../supabase/functions/_shared/omrScore';
import { OMR_LAYOUTS } from '../lib/omr/layouts.generated';
import { omrRead } from '../lib/omr/recognize';
import { loadGrayImage } from '../lib/omr/image';
import { answersFromResult, doubts, keyFromAnswers, qualityWarnings, variantFromResult, type Doubt } from '../lib/omr/answers';
import type { OmrResult } from '../lib/omr/types';
import { PIX, pixFromBase64 } from '../lib/omr/digits';
import { collectEnabled, collectSamples, guessOpen, loadDigitModel, setCollectEnabled, type OpenHint } from '../lib/omr/model';

// Раздел «Проверка» мини-приложения: фото бланка → ответы → баллы.
// Ключ берётся из набора билетов, вводится вручную или снимается с эталонного бланка (один билет — одно фото).
// Цифры в клетках открытых вопросов подсказывает классификатор (ближайшие соседи по собранным картинкам); последнее слово за проверяющим.

type Api = <T>(action: string, payload?: Record<string, unknown>) => Promise<T>;
type Ok = Extract<OmrResult, { ok: true }>;

interface SetRow { id: string; title: string; createdAt: string; subject: string; tickets: number | null; comp: Composition; supported: boolean }
interface KeySource {
  kind: 'set' | 'custom';
  id: string;
  batchId?: string;
  title: string;
  comp: Composition;
  layouts: string[];
  keys: Record<number, TicketKey>;
}
interface CustomKey { id: string; name: string; comp: Composition; layouts: string[]; keys: Record<number, TicketKey> }
interface SavedCheck { id: string; created_at: string; student: string; ticket_number: number | null; score: number; max_score: number }

const CUSTOM_KEY = 'omr_custom_keys_v1';
function loadCustom(): CustomKey[] {
  try { const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveCustom(list: CustomKey[]) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* память недоступна */ }
}

const FAIL_TEXT = 'Не видно четыре чёрных метки по углам бланка. Снимите бланк целиком при хорошем свете, чтобы все метки попали в кадр.';
const CODE_TEXT = 'Не удалось определить вид бланка. Проверьте, что снят бланк нужного предмета, и переснимите: бланк целиком, без бликов и теней.';

const compText = (c: Composition) => `${c.test} тестов, ${c.matching} соответствий, ${c.open} открытых`;
const doubtLabel = (d: Doubt) => (d.kind === 'test' ? `Тест ${d.q}` : d.kind === 'matching' ? `Соответствие ${d.q}, пункт ${d.row}` : d.kind === 'variant' ? 'Вариант' : `Открытый ${d.q}`);
const WHY: Record<Doubt['why'], string> = { multi: 'отмечено несколько — засчитано неверно', unsure: 'неуверенно', empty: 'не отмечено', digit: 'цифры' };

type View =
  | { name: 'home' }
  | { name: 'sets' }
  | { name: 'custom' }
  | { name: 'customEdit'; id: string }
  | { name: 'scan'; src: KeySource }
  | { name: 'review'; src: KeySource; res: Ok; mode: 'check' }
  | { name: 'refScan'; custom: string }
  | { name: 'refReview'; custom: string; res: Ok }
  | { name: 'results' }
  | { name: 'digits' };

export default function CheckScreen({ api, onExit, haptic }: { api: Api; onExit: () => void; haptic: (kind: 'light' | 'ok' | 'err') => void }) {
  const [view, setView] = useState<View>({ name: 'home' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState<CustomKey[]>(() => loadCustom());
  const [sets, setSets] = useState<SetRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [done, setDone] = useState<Array<{ student: string; score: number; max: number }>>([]);
  const [owner, setOwner] = useState(false);
  useEffect(() => { void api<{ owner: boolean }>('digits_admin').then((r) => setOwner(!!r.owner)).catch(() => {}); }, [api]);

  const upCustom = (fn: (l: CustomKey[]) => CustomKey[]) => setCustom((l) => { const n = fn(l); saveCustom(n); return n; });
  const go = (v: View) => { setError(''); setView(v); };
  const fail = (e: unknown) => { haptic('err'); setError((e as Error).message || 'Ошибка'); };

  // Список наборов: при открытии и при поиске (с небольшой задержкой, чтобы не слать запрос на каждую букву)
  useEffect(() => {
    if (view.name !== 'sets') return;
    let off = false;
    const id = setTimeout(() => {
      setBusy(true);
      api<{ sets: SetRow[] }>('check_sets', search.trim() ? { q: search.trim() } : {})
        .then((r) => { if (!off) setSets(r.sets); })
        .catch((e) => { if (!off) fail(e); })
        .finally(() => { if (!off) setBusy(false); });
    }, search ? 300 : 0);
    return () => { off = true; clearTimeout(id); };
  }, [view.name, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const openSets = () => go({ name: 'sets' });

  async function pickSet(s: SetRow) {
    setBusy(true); setError('');
    try {
      const r = await api<{ title: string; comp: Composition; layouts: string[]; tickets: Array<{ number: number; key: TicketKey }> }>('check_key', { batchId: s.id });
      const keys: Record<number, TicketKey> = {};
      r.tickets.forEach((t) => { keys[t.number] = t.key; });
      go({ name: 'scan', src: { kind: 'set', id: s.id, batchId: s.id, title: r.title, comp: r.comp, layouts: r.layouts, keys } });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const back = () => {
    setError('');
    if (view.name === 'home') return onExit();
    if (view.name === 'review') return setView({ name: 'scan', src: view.src });
    if (view.name === 'refScan' || view.name === 'refReview') return setView({ name: 'customEdit', id: view.custom });
    if (view.name === 'customEdit') return setView({ name: 'custom' });
    if (view.name === 'scan') return setView(view.src.kind === 'set' ? { name: 'sets' } : { name: 'custom' });
    setView({ name: 'home' });
  };

  return (
    <>
      <div className="tg-actions">
        <button className="tg-link" onClick={back}>← Назад</button>
      </div>
      {error && <div className="tg-error" role="alert">{error}</div>}
      {busy && <p className="tg-hint">Загрузка…</p>}

      {view.name === 'home' && (
        <>
          <h1>Проверка работ</h1>
          <p className="tg-hint">Сфотографируйте заполненный бланк — приложение прочитает отметки и посчитает баллы: тест 1, каждый пункт соответствия 1, открытый вопрос 2.</p>
          <button className="tg-row" onClick={() => void openSets()}><span className="tg-subject-icon">📋</span><span className="tg-grow"><b>По моим билетам</b><br /><span className="tg-hint">ключ берётся из созданного набора</span></span><span className="tg-chev">›</span></button>
          <button className="tg-row" onClick={() => go({ name: 'custom' })}><span className="tg-subject-icon">🔑</span><span className="tg-grow"><b>По своему ключу</b><br /><span className="tg-hint">ввести ответы или снять эталонный бланк</span></span><span className="tg-chev">›</span></button>
          <button className="tg-row" onClick={() => go({ name: 'results' })}><span className="tg-subject-icon">📊</span><span className="tg-grow"><b>Результаты</b></span><span className="tg-chev">›</span></button>
          {owner && <button className="tg-row" onClick={() => go({ name: 'digits' })}><span className="tg-subject-icon">🔢</span><span className="tg-grow"><b>Собранные цифры</b><br /><span className="tg-hint">просмотр и чистка картинок для подсказок</span></span><span className="tg-chev">›</span></button>}
        </>
      )}

      {view.name === 'sets' && (
        <>
          <h1>Набор билетов</h1>
          <p className="tg-hint">Подходят наборы с составом 18/2/7, 20/4/2 или 8/2/2 (тесты / соответствия / открытые).</p>
          <label className="tg-field"><span>Поиск</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="название, предмет или дата (например 14.11.2026)" /></label>
          {sets?.length === 0 && <p className="tg-hint">{search.trim() ? 'Ничего не найдено.' : 'Наборов пока нет — создайте билеты в конструкторе.'}</p>}
          {sets?.map((s) => (
            <button key={s.id} className="tg-row" disabled={busy || !s.supported} onClick={() => void pickSet(s)}>
              <span className="tg-grow"><b>{s.title}</b><br /><span className="tg-hint">{s.subject} · {new Date(s.createdAt).toLocaleDateString('ru-RU')} · {s.comp.test}/{s.comp.matching}/{s.comp.open}{s.tickets ? ` · ${s.tickets} вар.` : ''}{s.supported ? '' : ' · нет бланка'}</span></span>
              <span className="tg-chev">›</span>
            </button>
          ))}
        </>
      )}

      {view.name === 'custom' && (
        <CustomList
          list={custom}
          onUse={(c) => go({ name: 'scan', src: { kind: 'custom', id: c.id, title: c.name, comp: c.comp, layouts: c.layouts, keys: c.keys } })}
          onEdit={(c) => go({ name: 'customEdit', id: c.id })}
          onCreate={(name, comp) => {
            const b = blankFor(comp);
            if (!b || !name.trim()) return;
            const c: CustomKey = { id: `c${Date.now()}`, name: name.trim().slice(0, 60), comp, layouts: b.layouts, keys: {} };
            upCustom((l) => [...l, c]);
            go({ name: 'customEdit', id: c.id });
          }}
          onDelete={(c) => upCustom((l) => l.filter((x) => x.id !== c.id))}
        />
      )}

      {view.name === 'customEdit' && (() => {
        const c = custom.find((x) => x.id === view.id);
        if (!c) return <p className="tg-hint">Ключ не найден.</p>;
        return (
          <CustomEdit
            c={c}
            onSave={(n, key) => upCustom((l) => l.map((x) => (x.id === c.id ? { ...x, keys: { ...x.keys, [n]: key } } : x)))}
            onRemove={(n) => upCustom((l) => l.map((x) => { const k = { ...x.keys }; if (x.id === c.id) delete k[n]; return { ...x, keys: k }; }))}
            onScan={() => go({ name: 'refScan', custom: c.id })}
            onUse={() => go({ name: 'scan', src: { kind: 'custom', id: c.id, title: c.name, comp: c.comp, layouts: c.layouts, keys: c.keys } })}
          />
        );
      })()}

      {view.name === 'scan' && (
        <>
          <h1>{view.src.title}</h1>
          <p className="tg-hint">Варианты с ключом: {Object.keys(view.src.keys).sort((a, b) => Number(a) - Number(b)).join(', ') || 'нет'}. Состав: {compText(view.src.comp)}.</p>
          {done.length > 0 && <p className="tg-hint">Проверено за сеанс: {done.length}. Последний: {done[done.length - 1].student || 'без имени'} — {done[done.length - 1].score} из {done[done.length - 1].max}.</p>}
          <Capture
            label="📷 Сфотографировать бланк"
            layouts={view.src.layouts}
            onResult={(res) => go({ name: 'review', src: view.src, res, mode: 'check' })}
            onError={(m) => { haptic('err'); setError(m); }}
          />
          <p className="tg-hint">Снимайте один бланк целиком (одну полоску): все четыре чёрных метки по углам должны быть в кадре, свет ровный, без бликов.</p>
        </>
      )}

      {view.name === 'review' && (
        <Review
          key={`${view.src.id}-${view.res.rotation}-${done.length}`}
          api={api}
          src={view.src}
          res={view.res}
          onDone={(r) => { setDone((d) => [...d, r]); haptic('ok'); go({ name: 'scan', src: view.src }); }}
          onError={fail}
          onRetake={() => go({ name: 'scan', src: view.src })}
        />
      )}

      {view.name === 'refScan' && (() => {
        const c = custom.find((x) => x.id === view.custom);
        if (!c) return null;
        return (
          <>
            <h1>Эталонный бланк</h1>
            <p className="tg-hint">Заполните бланк правильными ответами, отметьте номер варианта, впишите цифры открытых вопросов и сфотографируйте: ключ этого варианта запишется по снимку.</p>
            <Capture label="📷 Сфотографировать эталон" layouts={c.layouts} onResult={(res) => go({ name: 'refReview', custom: c.id, res })} onError={(m) => { haptic('err'); setError(m); }} />
          </>
        );
      })()}

      {view.name === 'refReview' && (() => {
        const c = custom.find((x) => x.id === view.custom);
        if (!c) return null;
        return (
          <RefReview
            api={api}
            c={c}
            res={view.res}
            onSave={(n, key) => {
              upCustom((l) => l.map((x) => (x.id === c.id ? { ...x, keys: { ...x.keys, [n]: key } } : x)));
              haptic('ok');
              go({ name: 'customEdit', id: c.id });
            }}
          />
        );
      })()}

      {view.name === 'results' && <Results api={api} onError={fail} />}
      {view.name === 'digits' && <DigitsAdmin api={api} onError={fail} />}
    </>
  );
}

// ---------- съёмка и чтение ----------
function Capture({ label, layouts, onResult, onError }: { label: string; layouts: string[]; onResult: (r: Ok) => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const img = await loadGrayImage(f);
      const layout = OMR_LAYOUTS[layouts[0]];
      const res = omrRead(img, layout, { codes: layouts.map((id) => OMR_LAYOUTS[id].code) });
      if (!res.ok) return onError(FAIL_TEXT);
      if (!res.codeOk) return onError(CODE_TEXT);
      onResult(res);
    } catch {
      onError('Не удалось обработать фото. Попробуйте ещё раз.');
    } finally { setBusy(false); }
  }
  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => void onFile(e)} />
      <button className="tg-btn-primary" disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Распознаю…' : label}</button>
    </>
  );
}

// ---------- просмотр и правка ответов ----------
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
  return <canvas ref={ref} style={{ height: 44, width: 'auto', border: '1px solid var(--hint)', borderRadius: 4, background: '#fff' }} />;
}

/** Подставляет подсказки по цифрам в пустые поля открытых вопросов, когда модель загрузилась */
function useDigitHints(api: Api, res: Ok, setAnswers: Dispatch<SetStateAction<Answers>>): Array<OpenHint | null> {
  const [hints, setHints] = useState<Array<OpenHint | null>>([]);
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    let off = false;
    void loadDigitModel(async () => (await apiRef.current<{ samples: Array<{ d: number; px: string }> }>('digits_get')).samples).then((knn) => {
      if (off) return;
      const h = res.open.map((o) => guessOpen(knn, o));
      setHints(h);
      setAnswers((a) => ({ ...a, open: a.open.map((x, i) => (x === '' && h[i] ? h[i]!.text : x)) }));
    });
    return () => { off = true; };
  }, [res, setAnswers]);
  return hints;
}

function Choice({ value, options, onChange }: { value: string | null; options: string[]; onChange: (v: string | null) => void }) {
  return (
    <div className="tg-chips">
      {options.map((o) => (
        <button key={o} className={`tg-chip ${value === o ? 'on' : ''}`} onClick={() => onChange(value === o ? null : o)}>{o}</button>
      ))}
    </div>
  );
}

function AnswerEditor({ res, answers, setAnswers, onlyDoubts, withEmpty, hints }: { res: Ok; answers: Answers; setAnswers: (a: Answers) => void; onlyDoubts: boolean; withEmpty: boolean; hints?: Array<OpenHint | null> }) {
  const dl = useMemo(() => doubts(res).filter((d) => d.kind !== 'variant' && (withEmpty || d.why !== 'empty')), [res, withEmpty]);
  const isDoubt = (kind: Doubt['kind'], q: number, row?: string) => dl.find((d) => d.kind === kind && d.q === q && d.row === row);
  const setTest = (i: number, v: string | null) => setAnswers({ ...answers, tests: answers.tests.map((x, j) => (j === i ? v : x)) });
  const setMatch = (i: number, r: number, v: string | null) => setAnswers({ ...answers, matching: answers.matching.map((row, j) => (j === i ? row.map((x, k) => (k === r ? v : x)) : row)) });
  const setOpen = (i: number, v: string) => setAnswers({ ...answers, open: answers.open.map((x, j) => (j === i ? v.replace(/\D/g, '').slice(0, 4) : x)) });
  const LET = ['A', 'B', 'C', 'D'];
  const ROWS = ['A', 'B', 'C', 'D'].slice(0, MATCHING_ROWS);

  return (
    <>
      {res.tests.map((t, i) => {
        const d = isDoubt('test', t.q);
        if (onlyDoubts && !d) return null;
        return (
          <div key={`t${t.q}`} className="tg-card">
            <b>Тест {t.q}</b> {d && <span className="tg-badge warn">{WHY[d.why]}</span>}
            <Choice value={answers.tests[i]} options={LET} onChange={(v) => setTest(i, v)} />
          </div>
        );
      })}
      {res.matching.map((m, i) => m.rows.map((r, k) => {
        const d = isDoubt('matching', m.q, r.row);
        if (onlyDoubts && !d) return null;
        return (
          <div key={`m${m.q}${r.row}`} className="tg-card">
            <b>Соответствие {m.q}, пункт {ROWS[k]}</b> {d && <span className="tg-badge warn">{WHY[d.why]}</span>}
            <Choice value={answers.matching[i][k]} options={['1', '2', '3', '4', '5']} onChange={(v) => setMatch(i, k, v)} />
          </div>
        );
      }))}
      {res.open.map((o, i) => (
        <div key={`o${o.q}`} className="tg-card">
          <b>Открытый {o.q}</b> {hints?.[i] && answers.open[i] === hints[i]!.text && <span className={`tg-badge ${hints[i]!.unsure ? 'warn' : ''}`}>{hints[i]!.unsure ? 'подсказка — проверьте' : 'подсказка'}</span>}
          <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
            {o.boxes.map((b, j) => (b.hasDigit ? <DigitPic key={j} box={b} /> : <span key={j} className="tg-hint" style={{ width: 28, textAlign: 'center' }}>·</span>))}
          </div>
          <label className="tg-field">
            <span>Число (целое, до четырёх цифр)</span>
            <input inputMode="numeric" maxLength={4} value={answers.open[i]} onChange={(e) => setOpen(i, e.target.value)} placeholder={o.boxes.some((b) => b.hasDigit) ? 'впишите цифры с картинки' : 'пусто'} />
          </label>
        </div>
      ))}
    </>
  );
}

function Review({ api, src, res, onDone, onError, onRetake }: { api: Api; src: KeySource; res: Ok; onDone: (r: { student: string; score: number; max: number }) => void; onError: (e: unknown) => void; onRetake: () => void }) {
  const warnings = useMemo(() => qualityWarnings(res), [res]);
  const [answers, setAnswers] = useState<Answers>(() => answersFromResult(res));
  const [variant, setVariant] = useState<string>(() => String(variantFromResult(res) ?? ''));
  const [student, setStudent] = useState('');
  const [all, setAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collect, setCollect] = useState<boolean>(() => collectEnabled());
  const hints = useDigitHints(api, res, setAnswers);
  const key = src.keys[Number(variant)];
  const score = key ? scoreAnswers(key, answers) : null;
  const variants = Object.keys(src.keys).sort((a, b) => Number(a) - Number(b));
  const max = maxPoints(src.comp);

  async function save() {
    if (!key || !score) return;
    setSaving(true);
    try {
      await api('check_save', {
        batchId: src.batchId, ticketNumber: Number(variant), comp: src.comp, layout: src.layouts[0], student,
        answers, ...(src.kind === 'custom' ? { key } : {}),
      });
      if (collect) {
        const samples = collectSamples(res.open, answers.open, hints);
        if (samples.length) void api('digits_save', { samples, layout: src.layouts[0] }).catch(() => { /* сбор не мешает работе */ });
      }
      onDone({ student, score: score.score, max: score.max });
    } catch (e) { onError(e); } finally { setSaving(false); }
  }

  return (
    <>
      <h1>Проверка бланка</h1>
      {warnings.length > 0 && (
        <div className="tg-card" style={{ borderLeft: '4px solid #e0a100' }}>
          <b>⚠️ Снимок читается ненадёжно</b>
          {warnings.map((w) => <p key={w} className="tg-hint">{w}</p>)}
          <button className="tg-btn-primary" onClick={onRetake}>📷 Переснять</button>
        </div>
      )}
      <div className="tg-card">
        <b>Вариант</b>
        {variantFromResult(res) === null && <p className="tg-hint">Вариант на бланке не отмечен или отмечено несколько кружков — выберите вручную.</p>}
        <Choice value={variant || null} options={variants} onChange={(v) => setVariant(v ?? '')} />
        {variant && !key && <p className="tg-error">Для варианта {variant} нет ключа.</p>}
        <label className="tg-field"><span>Ученик (по желанию)</span><input value={student} maxLength={120} onChange={(e) => setStudent(e.target.value)} placeholder="ФИО или номер" /></label>
      </div>
      {score && (
        <div className="tg-card">
          <b style={{ fontSize: 22 }}>{score.score} из {score.max}</b>
          <p className="tg-hint">Тесты {score.tests.filter(Boolean).length}/{score.tests.length} · пункты соответствий {score.matching.flat().filter(Boolean).length}/{score.matching.length * MATCHING_ROWS} · открытые {score.open.filter(Boolean).length}/{score.open.length} (максимум {max})</p>
        </div>
      )}
      <p className="tg-hint">{all ? 'Все ответы.' : 'Показаны только сомнительные ответы и открытые вопросы.'} <button className="tg-link" onClick={() => setAll(!all)}>{all ? 'Только сомнительные' : 'Показать все'}</button></p>
      <AnswerEditor res={res} answers={answers} setAnswers={setAnswers} onlyDoubts={!all} withEmpty={false} hints={hints} />
      <label className="tg-hint" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={collect} onChange={(e) => { setCollect(e.target.checked); setCollectEnabled(e.target.checked); }} />
        <span>Помочь улучшить распознавание цифр: сохранять маленькие картинки цифр (без имён и без фото бланка).</span>
      </label>
      <button className="tg-btn-primary" disabled={saving || !key} onClick={() => void save()}>{saving ? 'Сохраняю…' : 'Сохранить результат'}</button>
    </>
  );
}

function RefReview({ api, c, res, onSave }: { api: Api; c: CustomKey; res: Ok; onSave: (n: number, key: TicketKey) => void }) {
  const [answers, setAnswers] = useState<Answers>(() => answersFromResult(res));
  const [variant, setVariant] = useState<string>(() => String(variantFromResult(res) ?? ''));
  const [all, setAll] = useState(false);
  const hints = useDigitHints(api, res, setAnswers);
  const missing = answers.tests.filter((x) => x === null).length + answers.matching.flat().filter((x) => x === null).length + answers.open.filter((x) => x.trim() === '').length;
  return (
    <>
      <h1>Ключ по эталону</h1>
      <div className="tg-card">
        <b>Номер варианта</b>
        <Choice value={variant || null} options={Array.from({ length: 4 }, (_, i) => String(i + 1))} onChange={(v) => setVariant(v ?? '')} />
      </div>
      <p className="tg-hint">В ключе должны быть заполнены все задания. Не заполнено: {missing}. <button className="tg-link" onClick={() => setAll(!all)}>{all ? 'Только сомнительные' : 'Показать все'}</button></p>
      <AnswerEditor res={res} answers={answers} setAnswers={setAnswers} onlyDoubts={!all} withEmpty hints={hints} />
      <button className="tg-btn-primary" disabled={!variant || missing > 0} onClick={() => onSave(Number(variant), keyFromAnswers(answers, c.comp))}>Записать ключ варианта {variant || '…'}</button>
    </>
  );
}

// ---------- свои ключи ----------
function CustomList({ list, onUse, onEdit, onCreate, onDelete }: { list: CustomKey[]; onUse: (c: CustomKey) => void; onEdit: (c: CustomKey) => void; onCreate: (name: string, comp: Composition) => void; onDelete: (c: CustomKey) => void }) {
  const [name, setName] = useState('');
  const [blank, setBlank] = useState(0);
  return (
    <>
      <h1>Свои ключи</h1>
      <p className="tg-hint">Ключи хранятся на этом устройстве.</p>
      {list.map((c) => (
        <div key={c.id} className="tg-card">
          <b>{c.name}</b>
          <p className="tg-hint">{compText(c.comp)} · вариантов с ключом: {Object.keys(c.keys).length}</p>
          <div className="tg-actions">
            <button className="tg-link" disabled={!Object.keys(c.keys).length} onClick={() => onUse(c)}>Проверять</button>
            <button className="tg-link" onClick={() => onEdit(c)}>Ключи</button>
            <button className="tg-link" onClick={() => { if (window.confirm(`Удалить ключ «${c.name}»?`)) onDelete(c); }}>Удалить</button>
          </div>
        </div>
      ))}
      <h2>Новый ключ</h2>
      <label className="tg-field"><span>Название</span><input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Например: химия, пробный экзамен" /></label>
      <div className="tg-seg" style={{ flexDirection: 'column' }}>
        {BLANKS.map((b, i) => <button key={b.label} className={blank === i ? 'on' : ''} onClick={() => setBlank(i)}>{b.label}</button>)}
      </div>
      <button className="tg-btn-primary" disabled={!name.trim()} onClick={() => onCreate(name, BLANKS[blank].comp)}>Создать</button>
    </>
  );
}

function CustomEdit({ c, onSave, onRemove, onScan, onUse }: { c: CustomKey; onSave: (n: number, key: TicketKey) => void; onRemove: (n: number) => void; onScan: () => void; onUse: () => void }) {
  const [n, setN] = useState<string>('1');
  const [t, setT] = useState({ tests: '', matching: '', open: '' });
  const [err, setErr] = useState('');
  useEffect(() => { const k = c.keys[Number(n)]; setT(k ? keyToText(k) : { tests: '', matching: '', open: '' }); setErr(''); }, [n, c.keys]);
  const have = Object.keys(c.keys).map(Number).sort((a, b) => a - b);
  return (
    <>
      <h1>{c.name}</h1>
      <p className="tg-hint">{compText(c.comp)}. Варианты с ключом: {have.join(', ') || 'пока нет'}.</p>
      <button className="tg-btn-secondary" onClick={onScan}>📷 Снять эталонный бланк</button>
      <h2>Ввести ключ вручную</h2>
      <Choice value={n} options={Array.from({ length: 4 }, (_, i) => String(i + 1))} onChange={(v) => setN(v ?? n)} />
      <label className="tg-field"><span>Тесты: {c.comp.test} букв (ABCD…)</span><input value={t.tests} onChange={(e) => setT({ ...t, tests: e.target.value })} placeholder="ABCDABCD…" /></label>
      {c.comp.matching > 0 && <label className="tg-field"><span>Соответствия: {c.comp.matching} групп по 4 цифры 1–5</span><input value={t.matching} onChange={(e) => setT({ ...t, matching: e.target.value })} placeholder="3124 2541" /></label>}
      {c.comp.open > 0 && <label className="tg-field"><span>Открытые: {c.comp.open} чисел через пробел</span><input value={t.open} onChange={(e) => setT({ ...t, open: e.target.value })} placeholder="12 5 700" /></label>}
      {err && <div className="tg-error">{err}</div>}
      <button className="tg-btn-secondary" onClick={() => {
        const r = parseKey(t, c.comp);
        if ('error' in r) return setErr(r.error);
        onSave(Number(n), r.value);
      }}>Записать ключ варианта {n}</button>
      {c.keys[Number(n)] && <button className="tg-link" onClick={() => onRemove(Number(n))}>Удалить ключ варианта {n}</button>}
      <button className="tg-btn-primary" disabled={!have.length} onClick={onUse}>Проверять работы</button>
    </>
  );
}

function Results({ api, onError }: { api: Api; onError: (e: unknown) => void }) {
  const [rows, setRows] = useState<SavedCheck[] | null>(null);
  useEffect(() => { api<{ checks: SavedCheck[] }>('check_list').then((r) => setRows(r.checks)).catch(onError); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return (
    <>
      <h1>Результаты</h1>
      {!rows && <p className="tg-hint">Загрузка…</p>}
      {rows?.length === 0 && <p className="tg-hint">Проверенных работ пока нет.</p>}
      {rows?.map((r) => (
        <div key={r.id} className="tg-row" style={{ cursor: 'default' }}>
          <span className="tg-grow"><b>{r.student || 'Без имени'}</b><br /><span className="tg-hint">{new Date(r.created_at).toLocaleString('ru-RU')}{r.ticket_number ? ` · вариант ${r.ticket_number}` : ''}</span></span>
          <span className="tg-badge">{r.score} / {r.max_score}</span>
        </div>
      ))}
    </>
  );
}

// ---------- чистка собранных цифр (главный админ) ----------
function PxPic({ px, on, onClick }: { px: string; on: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, p = pixFromBase64(px);
    if (!cv || !p) return;
    const k = 3;
    cv.width = cv.height = PIX * k;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < PIX; y++) for (let x = 0; x < PIX; x++) {
      const v = p[y * PIX + x];
      if (v) { ctx.fillStyle = 'rgba(0,0,0,' + v / 255 + ')'; ctx.fillRect(x * k, y * k, k, k); }
    }
  }, [px]);
  return <canvas ref={ref} onClick={onClick} style={{ width: 48, height: 48, border: on ? '2px solid #d33' : '1px solid var(--hint)', borderRadius: 4, background: '#fff' }} />;
}

function DigitsAdmin({ api, onError }: { api: Api; onError: (e: unknown) => void }) {
  const [counts, setCounts] = useState<number[]>([]);
  const [digit, setDigit] = useState<number | null>(null);
  const [items, setItems] = useState<Array<{ id: number; px: string }>>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  async function load(d: number | null) {
    setBusy(true);
    try {
      const r = await api<{ counts: number[]; items?: Array<{ id: number; px: string }> }>('digits_admin', d === null ? {} : { digit: d });
      setCounts(r.counts);
      setItems(r.items ?? []);
      setSel(new Set());
    } catch (e) { onError(e); } finally { setBusy(false); }
  }
  useEffect(() => { void load(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: 'digits_admin_delete' | 'digits_admin_relabel', extra: Record<string, unknown> = {}) {
    if (!sel.size) return;
    setBusy(true);
    try {
      await api(action, { ids: [...sel], ...extra });
      await load(digit);
    } catch (e) { onError(e); setBusy(false); }
  }

  return (
    <>
      <h1>Собранные цифры</h1>
      <p className="tg-hint">Картинки, из которых строятся подсказки. Выберите цифру, отметьте ошибочные картинки и удалите их или перенесите в нужную цифру. Показаны 150 последних.</p>
      <div className="tg-chips">
        {Array.from({ length: 10 }, (_, d) => (
          <button key={d} className={'tg-chip ' + (digit === d ? 'on' : '')} onClick={() => { setDigit(d); void load(d); }}>{d} · {counts[d] ?? '…'}</button>
        ))}
      </div>
      {busy && <p className="tg-hint">Загрузка…</p>}
      {digit !== null && !busy && items.length === 0 && <p className="tg-hint">Картинок этой цифры пока нет.</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0' }}>
        {items.map((it) => (
          <PxPic key={it.id} px={it.px} on={sel.has(it.id)} onClick={() => setSel((s) => { const n = new Set(s); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })} />
        ))}
      </div>
      {sel.size > 0 && (
        <div className="tg-card">
          <b>Выбрано: {sel.size}</b>
          <button className="tg-btn-primary" disabled={busy} onClick={() => { if (window.confirm('Удалить ' + sel.size + ' картинок? Это нельзя отменить.')) void act('digits_admin_delete'); }}>Удалить выбранные</button>
          <p className="tg-hint">Перенести в цифру:</p>
          <div className="tg-chips">
            {Array.from({ length: 10 }, (_, d) => (d === digit ? null : <button key={d} className="tg-chip" disabled={busy} onClick={() => void act('digits_admin_relabel', { digit: d })}>{d}</button>))}
          </div>
        </div>
      )}
    </>
  );
}
