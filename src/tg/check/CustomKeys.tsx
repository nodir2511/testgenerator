import { useEffect, useState } from 'react';
import { Camera, ChevronRight, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import { BLANKS, keyToText, parseKey, type Answers, type Composition, type TicketKey } from '../../../supabase/functions/_shared/omrScore';
import { OMR_LAYOUTS } from '../../lib/omr/layouts.generated';
import { keyFromAnswers } from '../../lib/omr/answers';
import { VARIANTS, answersOfKey, compText, count, emptyAnswers, missingCount } from './logic';
import { SheetGrid } from './Sheet';
import { confirmDialog } from './telegram';

export interface CustomKey { id: string; name: string; comp: Composition; layouts: string[]; keys: Record<number, TicketKey>; updatedAt?: number; synced?: boolean }

/** Сколько цифр помещается в клетки бланка (наибольшее среди подходящих раскладок) */
export const openCells = (layouts: string[]) => Math.max(1, ...layouts.flatMap((id) => OMR_LAYOUTS[id]?.open.map((o) => o.boxes.length) ?? [4]));

export function CustomList({ list, note, onOpen, onCreate }: { list: CustomKey[]; note: string; onOpen: (c: CustomKey) => void; onCreate: (name: string, comp: Composition) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [blank, setBlank] = useState(0);
  const form = adding || !list.length;
  return (
    <>
      <h1>Свои ключи</h1>
      <p className="ck-p">{list.length ? note : `Ключ — верные ответы для каждого варианта. Его можно снять с заполненного бланка или ввести. ${note}`}</p>
      {list.length > 0 && (
        <div className="ck-list">
          {list.map((c) => {
            const n = Object.keys(c.keys).length;
            return (
              <button key={c.id} className="ck-item" onClick={() => onOpen(c)}>
                <span className="tg-grow">{c.name}<span className="ck-sub">{compText(c.comp)}, {n ? `${count(n, 'вариант', 'варианта', 'вариантов')} с ключом` : 'ключ пока не заполнен'}</span></span>
                <ChevronRight size={18} className="tg-chev" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
      {!form && <button className="tg-btn-secondary" style={{ marginTop: 12 }} onClick={() => setAdding(true)}><Plus size={18} aria-hidden="true" />Новый ключ</button>}
      {form && (
        <>
          {list.length > 0 && <h2 className="ck-section">Новый ключ</h2>}
          <label className="tg-field"><span>Название</span><input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Например: химия, пробный экзамен" /></label>
          <div className="tg-field"><span>Какой бланк</span>
            <div className="tg-seg" style={{ flexDirection: 'column' }} role="radiogroup" aria-label="Какой бланк">
              {BLANKS.map((b, i) => <button key={b.label} role="radio" aria-checked={blank === i} className={blank === i ? 'on' : ''} onClick={() => setBlank(i)}>{b.label}</button>)}
            </div>
          </div>
          <button className="tg-btn-primary" disabled={!name.trim()} onClick={() => onCreate(name, BLANKS[blank].comp)}>Создать ключ</button>
        </>
      )}
    </>
  );
}

export function CustomEdit({ c, startVariant, onDirty, onSave, onRemove, onScan, onDelete, onUse }: {
  c: CustomKey;
  startVariant?: number;
  onDirty: (dirty: boolean) => void;
  onSave: (n: number, key: TicketKey) => void;
  onRemove: (n: number) => void;
  onScan: (from: 'camera' | 'gallery') => void;
  onDelete: () => void;
  onUse: () => void;
}) {
  const [n, setN] = useState(String(startVariant ?? 1));
  const saved = c.keys[Number(n)];
  const [a, setA] = useState<Answers>(() => (saved ? answersOfKey(saved) : emptyAnswers(c.comp)));
  const [t, setT] = useState({ tests: '', matching: '', open: '' });
  const [err, setErr] = useState('');
  useEffect(() => {
    const k = c.keys[Number(n)];
    setA(k ? answersOfKey(k) : emptyAnswers(c.comp));
    setT(k ? keyToText(k) : { tests: '', matching: '', open: '' });
    setErr('');
  }, [n, c.keys, c.comp]);
  const have = Object.keys(c.keys).map(Number);
  const missing = missingCount(a);
  const dirty = JSON.stringify(a) !== JSON.stringify(saved ? answersOfKey(saved) : emptyAnswers(c.comp));
  useEffect(() => { onDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(v: string) {
    if (v === n) return;
    if (dirty && !(await confirmDialog(`Ключ варианта ${n} не записан. Перейти к варианту ${v} и потерять правки?`))) return;
    setN(v);
  }

  return (
    <>
      <h1>{c.name}</h1>
      <p className="ck-p">{compText(c.comp)}</p>
      <div className="ck-card">
        <b>Вариант</b>
        <div className="tg-chips">
          {VARIANTS.map((v) => <button key={v} className={`tg-chip ${n === v ? 'on' : ''}`} aria-pressed={n === v} onClick={() => void pick(v)}>{v}{have.includes(Number(v)) ? ' ✓' : ''}</button>)}
        </div>
      </div>
      <h2 className="ck-section">Взять с эталонного бланка</h2>
      <p className="ck-p">Заполните бланк верными ответами, отметьте вариант и снимите его. Номер варианта прочитается с бланка.</p>
      <div className="ck-pair">
        <button className="tg-btn-secondary" onClick={() => onScan('camera')}><Camera size={18} aria-hidden="true" />Снять</button>
        <button className="tg-btn-secondary" onClick={() => onScan('gallery')}><ImageIcon size={18} aria-hidden="true" />Из галереи</button>
      </div>
      <h2 className="ck-section">Ответы варианта {n}<small>{missing ? `не заполнено: ${missing}` : 'заполнено'}</small></h2>
      <div className="ck-card"><SheetGrid comp={c.comp} answers={a} onChange={setA} openMax={openCells(c.layouts)} /></div>
      <details className="ck-card">
        <summary style={{ fontWeight: 600, minHeight: 28 }}>Вставить текстом</summary>
        <label className="tg-field" style={{ marginTop: 10 }}><span>Тесты: {c.comp.test} букв подряд</span><input value={t.tests} autoCapitalize="characters" onChange={(e) => setT({ ...t, tests: e.target.value })} placeholder="ABCDABCD…" /></label>
        {c.comp.matching > 0 && <label className="tg-field"><span>Соответствия: {c.comp.matching} группы по 4 цифры от 1 до 5</span><input value={t.matching} onChange={(e) => setT({ ...t, matching: e.target.value })} placeholder="3124 2541" /></label>}
        {c.comp.open > 0 && <label className="tg-field"><span>Открытые: {c.comp.open} чисел через пробел</span><input value={t.open} onChange={(e) => setT({ ...t, open: e.target.value })} placeholder="12 5 700" /></label>}
        {err && <div className="ck-note bad" role="alert">{err}</div>}
        <button className="tg-btn-secondary" onClick={() => {
          const r = parseKey(t, c.comp);
          if ('error' in r) return setErr(r.error);
          setErr('');
          setA(answersOfKey(r.value));
        }}>Перенести в сетку</button>
      </details>
      {saved && <button className="ck-text danger" onClick={() => void confirmDialog(`Удалить ключ варианта ${n}?`).then((ok) => { if (ok) onRemove(Number(n)); })}><Trash2 size={18} aria-hidden="true" />Удалить ключ варианта {n}</button>}
      <button className="ck-text danger" onClick={() => void confirmDialog(`Удалить «${c.name}» со всеми вариантами?`).then((ok) => { if (ok) onDelete(); })}><Trash2 size={18} aria-hidden="true" />Удалить весь ключ</button>
      <div className="ck-dock"><div className="ck-dock-in">
        {dirty || !have.length
          ? <button className="tg-btn-primary wide" disabled={missing > 0} onClick={() => onSave(Number(n), keyFromAnswers(a, c.comp))}>{missing ? `Осталось заполнить: ${missing}` : `Записать ключ варианта ${n}`}</button>
          : <button className="tg-btn-primary wide" onClick={onUse}>Проверять работы</button>}
      </div></div>
    </>
  );
}
