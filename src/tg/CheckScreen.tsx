import { useCallback, useEffect, useRef, useState } from 'react';
import { ChartNoAxesColumn, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleX, ClipboardList, Download, Hash, KeyRound, Play, RotateCcw, X } from 'lucide-react';
import { blankFor, type Composition, type TicketKey } from '../../supabase/functions/_shared/omrScore';
import { exportOmrChecksToExcel } from '../lib/omr/exportExcel';
import { collectEnabled, setCollectEnabled } from '../lib/omr/model';
import { DebugPicture, QueueCapture, RefCapture, type Item } from './check/capture';
import { CustomEdit, CustomList, type CustomKey } from './check/CustomKeys';
import { DigitsAdmin } from './check/DigitsAdmin';
import { cloudAvailable, loadCloudKeys, mergeKeys, removeCloudKey, saveCloudKey } from './check/keySync';
import { SheetPhoto } from './check/pictures';
import type { Sheet } from '../lib/omr/process';
import { RefReview, Review, digitModel, type Draft, type KeySource, type Saved } from './check/Review';
import { ResultDetail, Results, type Api } from './check/Results';
import { compText, count, nextReady, parseLastSource, queueNote, queueStatus, type LastSource, type Ok, type SavedCheck } from './check/logic';
import { confirmDialog, hasNativeBack, useBack, useClosingGuard } from './check/telegram';
import './check/check.css';

// Раздел «Проверка» мини-приложения: фото бланка → ответы → баллы. Здесь — переходы между экранами, сами экраны в check/.
// Ключ берётся из набора билетов, вводится вручную или читается с фото эталонного бланка — с камеры или из галереи (один билет — одно фото).
// Цифры в клетках открытых вопросов подсказывает классификатор; последнее слово за проверяющим.

interface SetRow { id: string; title: string; createdAt: string; subject: string; tickets: number | null; comp: Composition; supported: boolean }

const CUSTOM_KEY = 'omr_custom_keys_v1';
const LAST_KEY = 'omr_last_source_v1';
const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* память недоступна */ } };
function loadCustom(): CustomKey[] {
  try { const v = JSON.parse(read(CUSTOM_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

type View =
  | { name: 'home' }
  | { name: 'sets' }
  | { name: 'custom' }
  | { name: 'customEdit'; id: string; variant?: number }
  | { name: 'scan'; src: KeySource }
  | { name: 'review'; src: KeySource; itemId: number }
  | { name: 'refScan'; custom: string; from?: 'camera' | 'gallery' }
  | { name: 'refReview'; custom: string; res: Ok; sheet?: Sheet }
  | { name: 'results' }
  | { name: 'result'; row: SavedCheck }
  | { name: 'digits' };

interface Toast { text: string; undo?: () => void }

export default function CheckScreen({ api, onExit, haptic }: { api: Api; onExit: () => void; haptic: (kind: 'light' | 'ok' | 'err') => void }) {
  const [view, setView] = useState<View>({ name: 'home' });
  const [error, setError] = useState('');
  const [debug, setDebug] = useState('');
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState<CustomKey[]>(() => loadCustom());
  const [sets, setSets] = useState<SetRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [done, setDone] = useState<Saved[]>([]);
  const [owner, setOwner] = useState(false);
  const [queue, setQueue] = useState<Item[]>([]);
  const [live, setLive] = useState(false);
  const [last, setLast] = useState<LastSource | null>(() => parseLastSource(read(LAST_KEY)));
  const [toast, setToast] = useState<Toast | null>(null);
  const [collect, setCollect] = useState(() => collectEnabled());
  const nextId = useRef(1);
  const shotNumber = useRef(1);
  const drafts = useRef(new Map<number, Draft>());
  const editDirty = useRef(false);
  useEffect(() => { void api<{ owner: boolean }>('digits_admin').then((r) => setOwner(!!r.owner)).catch(() => {}); }, [api]);
  useClosingGuard(queue.length > 0);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  // Свои ключи: память устройства и хранилище Telegram (одинаковы на всех устройствах пользователя)
  const customRef = useRef(custom);
  const putCustom = useCallback((n: CustomKey[]) => { customRef.current = n; write(CUSTOM_KEY, JSON.stringify(n)); setCustom(n); }, []);
  const pushKey = useCallback(async (k: CustomKey) => {
    if (await saveCloudKey(k)) putCustom(customRef.current.map((x) => (x.id === k.id && x.updatedAt === k.updatedAt ? { ...x, synced: true } : x)));
  }, [putCustom]);
  const saveKey = (k: CustomKey) => {
    const n = { ...k, updatedAt: Date.now(), synced: false };
    putCustom(customRef.current.some((x) => x.id === k.id) ? customRef.current.map((x) => (x.id === k.id ? n : x)) : [...customRef.current, n]);
    void pushKey(n);
  };
  const removedKeys = useRef(new Set<string>());
  const dropKey = (id: string) => { removedKeys.current.add(id); putCustom(customRef.current.filter((x) => x.id !== id)); void removeCloudKey(id); };
  useEffect(() => {
    let off = false;
    const known = new Set(customRef.current.filter((k) => k.synced).map((k) => k.id));
    void loadCloudKeys().then((cloud) => {
      if (off || !cloud) return;
      const r = mergeKeys(customRef.current, cloud, { known, removed: removedKeys.current });
      putCustom(r.list);
      r.push.forEach((k) => void pushKey(k));
    });
    return () => { off = true; };
  }, [putCustom, pushKey]);

  const viewName = useRef<View['name']>('home');
  const go = (v: View) => { viewName.current = v.name; editDirty.current = false; setError(''); setDebug(''); setView(v); setLive(false); window.scrollTo(0, 0); if (v.name !== 'scan' && v.name !== 'review') setToast(null); };
  const fail = (e: unknown) => { haptic('err'); setError((e as Error).message || 'Ошибка'); };
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'center' }); }, [error]);

  const addToQueue = (i: Omit<Item, 'id'>) => { const id = nextId.current++; setQueue((q) => [...q, { ...i, id }]); };
  const dropFromQueue = (id: number) => setQueue((q) => q.filter((i) => i.id !== id));
  /** Переснять: прежний снимок уходит из стопки, сразу открывается камера */
  const retake = (id: number, src: KeySource) => { dropFromQueue(id); go({ name: 'scan', src }); setLive(true); };

  const startScan = (src: KeySource) => {
    const l: LastSource = { kind: src.kind, id: src.id, title: src.title };
    setLast(l);
    write(LAST_KEY, JSON.stringify(l));
    setDone([]);
    shotNumber.current = 1;
    go({ name: 'scan', src });
  };
  const scanCustom = (c: CustomKey) => startScan({ kind: 'custom', id: c.id, title: c.name, comp: c.comp, layouts: c.layouts, keys: c.keys });

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
    return () => { off = true; clearTimeout(id); setBusy(false); };
  }, [view.name, search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openSet(id: string, from: View['name']) {
    setBusy(true); setError('');
    try {
      const r = await api<{ title: string; comp: Composition; layouts: string[]; tickets: Array<{ number: number; key: TicketKey }> }>('check_key', { batchId: id });
      const keys: Record<number, TicketKey> = {};
      r.tickets.forEach((t) => { keys[t.number] = t.key; });
      if (viewName.current !== from) return; // пока шёл запрос, пользователь ушёл с экрана
      startScan({ kind: 'set', id, batchId: id, title: r.title, comp: r.comp, layouts: r.layouts, keys });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  const lastCustom = last?.kind === 'custom' ? custom.find((c) => c.id === last.id && Object.keys(c.keys).length) : undefined;
  const canContinue = last && (last.kind === 'set' || lastCustom);

  async function back() {
    if (view.name === 'home') return onExit();
    if (view.name === 'review') return go({ name: 'scan', src: view.src });
    if (view.name === 'refReview') return go({ name: 'refScan', custom: view.custom });
    if (view.name === 'refScan') return go({ name: 'customEdit', id: view.custom });
    if (view.name === 'result') return go({ name: 'results' });
    if (view.name === 'customEdit') {
      if (editDirty.current && !(await confirmDialog('Ключ не записан. Выйти и потерять правки?'))) return;
      return go({ name: 'custom' });
    }
    if (view.name === 'scan') {
      if (live) return setLive(false);
      if (queue.length && !(await confirmDialog(`В стопке ${count(queue.length, 'несохранённый снимок', 'несохранённых снимка', 'несохранённых снимков')}. Выйти и потерять?`))) return;
      setQueue([]);
      return go(view.src.kind === 'set' ? { name: 'sets' } : { name: 'custom' });
    }
    go({ name: 'home' });
  }
  useBack(() => void back());

  function onSaved(src: KeySource, item: Item, r: Saved) {
    setDone((d) => [...d, r]);
    haptic('ok');
    const next = nextReady(queue, item.id);
    dropFromQueue(item.id);
    go(next ? { name: 'review', src, itemId: next.id } : { name: 'scan', src });
    setToast({
      text: `Сохранено: ${r.student || item.name}, ${r.score} из ${r.max}`,
      undo: () => {
        setToast(null);
        api('check_delete', { id: r.id }).then(() => {
          setDone((d) => d.filter((x) => x.id !== r.id));
          setQueue((q) => [item, ...q]);
          if (viewName.current === 'scan' || viewName.current === 'review') go({ name: 'review', src, itemId: item.id });
        }).catch((e) => fail(/Неизвестное действие/.test((e as Error).message) ? new Error('Отмена пока недоступна: сервер ещё обновляется. Результат сохранён.') : e));
      },
    });
  }

  return (
    <div className="ck">
      {!hasNativeBack() && <button className="ck-back" onClick={() => void back()}><ChevronLeft size={20} aria-hidden="true" />Назад</button>}
      {error && <div ref={errorRef} className="ck-note bad" role="alert">{error}{debug && <DebugPicture src={debug} />}</div>}

      {view.name === 'home' && (
        <>
          <h1>Проверка работ</h1>
          <p className="ck-p">Снимите заполненный бланк — приложение прочитает отметки и посчитает балл.</p>
          {canContinue && (
            <button className="tg-btn-primary ck-continue" disabled={busy} onClick={() => (lastCustom ? scanCustom(lastCustom) : void openSet(last!.id, 'home'))}>
              <Play size={18} aria-hidden="true" /><span>{busy ? 'Открываю…' : `Продолжить: ${lastCustom?.name ?? last!.title}`}</span>
            </button>
          )}
          <button className="tg-row" onClick={() => go({ name: 'sets' })}><span className="ck-leading"><ClipboardList size={22} aria-hidden="true" /></span><span className="tg-grow"><b>По набору билетов</b><span className="ck-sub">ключ уже есть в созданном наборе</span></span><ChevronRight size={20} className="tg-chev" aria-hidden="true" /></button>
          <button className="tg-row" onClick={() => go({ name: 'custom' })}><span className="ck-leading"><KeyRound size={22} aria-hidden="true" /></span><span className="tg-grow"><b>По своему ключу</b><span className="ck-sub">ввести ответы или снять эталонный бланк</span></span><ChevronRight size={20} className="tg-chev" aria-hidden="true" /></button>
          <button className="tg-row" onClick={() => go({ name: 'results' })}><span className="ck-leading"><ChartNoAxesColumn size={22} aria-hidden="true" /></span><span className="tg-grow"><b>Результаты</b><span className="ck-sub">сохранённые работы и выгрузка в Excel</span></span><ChevronRight size={20} className="tg-chev" aria-hidden="true" /></button>
          <p className="ck-p" style={{ marginTop: 14 }}>Баллы: тест — 1, пункт соответствия — 1, открытый вопрос — 2.</p>
          <h2 className="ck-section">Настройки</h2>
          <label className="ck-toggle">
            <input type="checkbox" checked={collect} onChange={(e) => { setCollect(e.target.checked); setCollectEnabled(e.target.checked); }} />
            <span>Помогать распознаванию цифр<span className="ck-sub">сохранять маленькие картинки цифр, без имён и без фото бланка</span></span>
          </label>
          {owner && <button className="ck-text" style={{ paddingLeft: 0 }} onClick={() => go({ name: 'digits' })}><Hash size={18} aria-hidden="true" />Собранные цифры</button>}
        </>
      )}

      {view.name === 'sets' && (
        <>
          <h1>Набор билетов</h1>
          <label className="tg-field"><span>Поиск</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="название, предмет или дата 14.11.2026" /></label>
          {!sets && busy && <div className="ck-loading" aria-label="Загрузка"><i /><i /><i /></div>}
          {sets?.length === 0 && <p className="ck-p">{search.trim() ? 'Ничего не найдено.' : 'Наборов пока нет. Создайте билеты в разделе «Сделать билет».'}</p>}
          {!!sets?.length && (
            <div className="ck-list" aria-busy={busy}>
              {sets.map((s) => (
                <button key={s.id} className="ck-item" disabled={busy || !s.supported} onClick={() => void openSet(s.id, 'sets')}>
                  <span className="tg-grow">{s.title}<span className="ck-sub">{s.subject}, {new Date(s.createdAt).toLocaleDateString('ru-RU')}{s.tickets ? `, ${count(s.tickets, 'вариант', 'варианта', 'вариантов')}` : ''}</span>{!s.supported && <span className="ck-sub ck-mid">для состава {s.comp.test}/{s.comp.matching}/{s.comp.open} нет бланка</span>}</span>
                  {s.supported && <ChevronRight size={18} className="tg-chev" aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
          <p className="ck-p" style={{ marginTop: 14 }}>Бланки есть для составов 18/2/7, 20/4/2 и 8/2/2 (тесты, соответствия, открытые).</p>
        </>
      )}

      {view.name === 'custom' && (
        <CustomList
          list={custom}
          note={cloudAvailable() ? 'Ключи сохраняются в вашем Telegram и видны на всех ваших устройствах.' : 'Ключи хранятся на этом устройстве.'}
          onOpen={(c) => go({ name: 'customEdit', id: c.id, variant: Number(Object.keys(c.keys)[0]) || 1 })}
          onCreate={(name, comp) => {
            const b = blankFor(comp);
            if (!b || !name.trim()) return;
            const c: CustomKey = { id: `c${Date.now()}`, name: name.trim().slice(0, 60), comp, layouts: b.layouts, keys: {} };
            saveKey(c);
            go({ name: 'customEdit', id: c.id });
          }}
        />
      )}

      {view.name === 'customEdit' && (() => {
        const c = custom.find((x) => x.id === view.id);
        if (!c) return <p className="ck-p">Ключ не найден.</p>;
        return (
          <div className="ck-withdock">
            <CustomEdit
              c={c}
              startVariant={view.variant}
              onDirty={(d) => { editDirty.current = d; }}
              onSave={(n, key) => { saveKey({ ...c, keys: { ...c.keys, [n]: key } }); haptic('ok'); setToast({ text: `Ключ варианта ${n} записан` }); }}
              onRemove={(n) => { const k = { ...c.keys }; delete k[n]; saveKey({ ...c, keys: k }); }}
              onScan={(from) => go({ name: 'refScan', custom: c.id, from })}
              onDelete={() => { dropKey(c.id); go({ name: 'custom' }); }}
              onUse={() => scanCustom(c)}
            />
          </div>
        );
      })()}

      {view.name === 'scan' && (() => {
        const src = view.src;
        const ready = queue.filter((i) => i.res);
        return (
          <div className={ready.length ? 'ck-withdock' : ''}>
            <h1>{src.title}</h1>
            <p className="ck-p">{compText(src.comp)}. Ключ есть для вариантов: {Object.keys(src.keys).sort((a, b) => Number(a) - Number(b)).join(', ') || 'нет'}.</p>
            <QueueCapture layouts={src.layouts} keys={src.keys} loadDigits={() => digitModel(api)} queue={queue} live={live} setLive={setLive} nextNumber={() => shotNumber.current++} onAdd={(i) => { addToQueue(i); if (i.res) haptic('ok'); }} onFail={() => haptic('err')} />
            {queue.length > 0 && (
              <>
                <h2 className="ck-section">Стопка<small>{queue.length}</small></h2>
                <div className="ck-list">
                  {queue.map((i) => {
                    const st = queueStatus(i);
                    return (
                      <div key={i.id} className={`ck-shot ${st}`}>
                        <div className="ck-shot-row">
                          <button className="ck-item-main" disabled={!i.res} onClick={() => go({ name: 'review', src, itemId: i.id })}>
                            {i.sheet && <SheetPhoto sheet={i.sheet} small />}
                            <span className="tg-grow">{i.name}<span className="ck-sub ck-shot-note">{st === 'ok' ? <CircleCheck size={15} aria-hidden="true" /> : st === 'warn' ? <CircleAlert size={15} aria-hidden="true" /> : <CircleX size={15} aria-hidden="true" />}<span>{queueNote(i)}</span></span></span>
                            {i.res && <ChevronRight size={18} className="tg-chev" aria-hidden="true" />}
                          </button>
                          <button className="ck-icon" aria-label={`Убрать ${i.name}`} onClick={() => dropFromQueue(i.id)}><X size={18} aria-hidden="true" /></button>
                        </div>
                        {st !== 'ok' && <button className="ck-text" style={{ paddingLeft: 0 }} onClick={() => retake(i.id, src)}><RotateCcw size={16} aria-hidden="true" />Переснять</button>}
                        {i.debug && <DebugPicture src={i.debug} />}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {done.length > 0 && (
              <>
                <h2 className="ck-section">Проверено сейчас<small>{done.length}</small></h2>
                <div className="ck-list">
                  {done.slice(-30).reverse().map((d) => <div key={d.id} className="ck-item" style={{ cursor: 'default' }}><span className="tg-grow">{d.student || 'Без имени'}<span className="ck-sub">вариант {d.ticket}</span></span><span className="pts">{d.score} из {d.max}</span></div>)}
                </div>
                <button className="tg-btn-secondary" style={{ marginTop: 10 }} onClick={() => void exportOmrChecksToExcel(done.map((d) => ({ student: d.student, score: d.score, max_score: d.max, ticket_number: d.ticket, created_at: d.createdAt })), src.title).catch(() => fail(new Error('Не удалось сохранить файл Excel. Попробуйте ещё раз.')))}><Download size={18} aria-hidden="true" />Скачать в Excel</button>
              </>
            )}
            {ready.length > 0 && (
              <div className="ck-dock"><div className="ck-dock-in"><button className="tg-btn-primary wide" onClick={() => go({ name: 'review', src, itemId: ready[0].id })}>Проверить {count(ready.length, 'работу', 'работы', 'работ')}</button></div></div>
            )}
          </div>
        );
      })()}

      {view.name === 'review' && (() => {
        const item = queue.find((i) => i.id === view.itemId);
        const src = view.src;
        if (!item?.res) return <p className="ck-p">Снимок уже проверен или убран. <button className="ck-text" onClick={() => go({ name: 'scan', src })}>К стопке</button></p>;
        return (
          <Review
            key={`${src.id}-${item.id}`}
            api={api}
            src={src}
            res={item.res}
            sheet={item.sheet}
            title={item.name}
            draft={drafts.current.get(item.id)}
            onDraft={(d) => drafts.current.set(item.id, d)}
            left={queue.filter((i) => i.res).length}
            onDone={(r) => onSaved(src, item, r)}
            onError={fail}
            onRetake={() => retake(item.id, src)}
          />
        );
      })()}

      {view.name === 'refScan' && (() => {
        const c = custom.find((x) => x.id === view.custom);
        if (!c) return null;
        return (
          <>
            <h1>Эталонный бланк</h1>
            <p className="ck-p">На фото должен быть один бланк целиком: отмечен вариант, заполнены все ответы, видны четыре чёрных метки по углам. Фото читается в телефоне и никуда не отправляется.</p>
            <RefCapture
              layouts={c.layouts}
              from={view.from}
              onStart={() => { setError(''); setDebug(''); }}
              onResult={(r) => go({ name: 'refReview', custom: c.id, res: r.res, sheet: r.sheet })}
              onError={(m, d) => { haptic('err'); setError(m); setDebug(d ?? ''); }}
            />
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
            sheet={view.sheet}
            onRetake={() => go({ name: 'refScan', custom: c.id })}
            onSave={(n, key) => {
              saveKey({ ...c, keys: { ...c.keys, [n]: key } });
              haptic('ok');
              go({ name: 'customEdit', id: c.id, variant: n });
              setToast({ text: `Ключ варианта ${n} записан` });
            }}
          />
        );
      })()}

      {view.name === 'results' && <Results api={api} onError={fail} onOpen={(row) => go({ name: 'result', row })} />}
      {view.name === 'result' && <ResultDetail api={api} row={view.row} onError={fail} onDeleted={() => { haptic('ok'); go({ name: 'results' }); setToast({ text: 'Результат удалён' }); }} />}
      {view.name === 'digits' && <DigitsAdmin api={api} onError={fail} />}

      {toast && <div className="ck-toast" role="status"><span>{toast.text}</span>{toast.undo && <button onClick={toast.undo}>Отменить</button>}</div>}
    </div>
  );
}
