import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera as CameraIcon, CircleHelp, Image as ImageIcon } from 'lucide-react';
import { BLANKS, type TicketKey } from '../../../supabase/functions/_shared/omrScore';
import { OMR_LAYOUTS } from '../../lib/omr/layouts.generated';
import { DECODE_TEXT, fileProblem } from '../../lib/omr/readPhoto';
import { debugPicture, loadGrayImage } from '../../lib/omr/image';
import type { DigitKnn } from '../../lib/omr/knn';
import { readInBackground } from '../../lib/omr/omrClient';
import type { Sheet } from '../../lib/omr/process';
import { sameSheet } from './autosnap';
import { Camera, liveCameraSupported, type ShotNote } from './Camera';
import { HowTo } from './pictures';
import { queueName, queueNote, queueStatus, type Ok, type QItem } from './logic';

export type Item = QItem<Sheet>;
export type PhotoResult = { res?: Ok; sheet?: Sheet; error?: string; debug?: string };
const OOPS = 'Не удалось обработать фото. Попробуйте ещё раз.';
const NO_CAMERA = 'Камера недоступна. Разрешите Telegram доступ к камере или снимите обычной камерой телефона.';

/** Один путь для кадра видоискателя, снимка камеры телефона и фото из галереи */
export async function readPhoto(src: File | HTMLCanvasElement, layouts: string[]): Promise<PhotoResult> {
  const problem = src instanceof File ? fileProblem(src) : null;
  if (problem) return { error: problem };
  let img: Awaited<ReturnType<typeof loadGrayImage>>;
  try { img = await loadGrayImage(src); } catch { return { error: DECODE_TEXT }; }
  try {
    const r = await readInBackground(img, layouts);
    if (r.res) return { res: r.res, sheet: r.sheet };
    return { error: r.error ?? OOPS, debug: r.debug ? debugPicture(r.debug, r.debug.bin, r.debug.markers) : undefined };
  } catch {
    return { error: OOPS };
  }
}

const blankLabel = (layouts: string[]) => BLANKS.find((b) => b.layouts.includes(layouts[0]))?.label ?? 'Бланк';

/** Подсказка при неудачном снимке: как программа «увидела» фото */
export function DebugPicture({ src }: { src: string }) {
  return (
    <details className="ck-debug">
      <summary>Что видит программа</summary>
      <img src={src} alt="Снимок в чёрно-белом виде с найденными метками" style={{ width: '100%', borderRadius: 8 }} />
      <p>Чёрное программа сочла тёмным, красные кружки — найденные угловые метки. Если кружков нет или они не на четырёх углах бланка, переснимите ровнее и при хорошем свете.</p>
    </details>
  );
}

const HOWTO_KEY = 'omr_howto_seen_v1';
/** Памятка раскрыта при первом заходе, дальше — по нажатию */
function HowToBlock({ layouts, started }: { layouts: string[]; started?: boolean }) {
  const [open, setOpen] = useState(() => {
    try {
      const first = localStorage.getItem(HOWTO_KEY) !== '1';
      localStorage.setItem(HOWTO_KEY, '1');
      return first;
    } catch { return true; }
  });
  useEffect(() => { if (started) setOpen(false); }, [started]); // снимки уже есть — место нужнее стопке
  return (
    <>
      <button className="ck-text" aria-expanded={open} onClick={() => setOpen(!open)}><CircleHelp size={18} aria-hidden="true" />Как снимать</button>
      {open && <HowTo layout={OMR_LAYOUTS[layouts[0]]} />}
    </>
  );
}

/** Съёмка в стопку: видоискатель (снимок за снимком) и галерея (много фото сразу); каждое фото читается сразу */
export function QueueCapture({ layouts, keys, loadDigits, queue, live, setLive, nextNumber, onAdd, onFail }: {
  layouts: string[];
  keys: Record<number, TicketKey>;
  loadDigits: () => Promise<DigitKnn>;
  queue: Item[];
  live: boolean;
  setLive: (v: boolean) => void;
  nextNumber: () => number;
  onAdd: (i: Omit<Item, 'id'>) => void;
  onFail: () => void;
}) {
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [noLive, setNoLive] = useState(() => !liveCameraSupported());
  const added = useRef<Ok | undefined>(undefined);

  async function process(files: File[]) {
    let failed = false;
    for (let i = 0; i < files.length; i++) {
      setProgress({ i: i + 1, n: files.length });
      const r = await readPhoto(files[i], layouts);
      if (r.error) failed = true;
      onAdd({ name: queueName(nextNumber()), ...r });
    }
    setProgress(null);
    if (failed) onFail();
  }
  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) void process(files);
  }
  // Снимок из видоискателя: прочитался — в стопку; нет — причина сразу в кадре, лист переснимают тут же
  async function onShot(frame: HTMLCanvasElement, auto: boolean): Promise<ShotNote> {
    const r = await readPhoto(frame, layouts);
    if (!r.res) { onFail(); return { tone: 'error', text: r.error ?? OOPS }; }
    if (auto && sameSheet(added.current, r.res)) return { tone: 'warn', text: 'Похоже, этот лист уже снят. Если это другая работа, нажмите кнопку съёмки.' };
    added.current = r.res;
    const item = { name: queueName(nextNumber()), ...r };
    onAdd(item);
    return { tone: queueStatus(item), text: `${item.name}: ${queueNote(item)}` };
  }
  const main = () => { if (noLive) cam.current?.click(); else setLive(true); };
  const lastItem = [...queue].reverse().find((i) => i.sheet);

  return (
    <>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
      <input ref={gal} type="file" accept="image/*" multiple hidden onChange={onFiles} />
      {live && !noLive && (
        <Camera
          layouts={layouts}
          label={blankLabel(layouts)}
          count={queue.filter((i) => i.res).length}
          last={lastItem?.sheet}
          keys={keys}
          loadDigits={loadDigits}
          onShot={onShot}
          onGallery={() => { setLive(false); gal.current?.click(); }}
          onClose={() => setLive(false)}
          onUnavailable={() => { setLive(false); setNoLive(true); }}
        />
      )}
      {noLive && liveCameraSupported() && <div className="ck-note warn">{NO_CAMERA}</div>}
      <button className="tg-btn-primary" disabled={!!progress} onClick={main}><CameraIcon size={20} aria-hidden="true" />{progress ? `Читаю ${progress.i} из ${progress.n}…` : queue.length ? 'Снять ещё' : 'Снять бланки'}</button>
      <button className="tg-btn-secondary" disabled={!!progress} onClick={() => gal.current?.click()}><ImageIcon size={18} aria-hidden="true" />Выбрать из галереи</button>
      <HowToBlock layouts={layouts} started={queue.length > 0} />
    </>
  );
}

/** Одно фото эталона: снять или выбрать готовое из галереи; оба читаются одинаково (readPhoto) */
export function RefCapture({ layouts, from, onStart, onResult, onError }: { layouts: string[]; from?: 'camera' | 'gallery'; onStart: () => void; onResult: (r: PhotoResult & { res: Ok }) => void; onError: (m: string, debug?: string) => void }) {
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [noLive, setNoLive] = useState(() => !liveCameraSupported());
  const [live, setLive] = useState(from === 'camera' && liveCameraSupported());
  // Выбор уже сделан на прошлом экране — сразу открываем. Если система не дала, остаются кнопки
  useEffect(() => { if (from === 'gallery') gal.current?.click(); else if (from === 'camera' && noLive) cam.current?.click(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    onStart();
    try {
      const r = await readPhoto(f, layouts);
      if (r.res) onResult({ ...r, res: r.res });
      else onError(r.error || OOPS, r.debug);
    } finally { setBusy(false); }
  }
  async function onShot(frame: HTMLCanvasElement): Promise<ShotNote> {
    onStart();
    const r = await readPhoto(frame, layouts);
    if (!r.res) return { tone: 'error', text: r.error ?? OOPS };
    setLive(false);
    onResult({ ...r, res: r.res });
    return { tone: 'ok', text: '' };
  }
  return (
    <>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile(e)} />
      {/* без capture: телефон предлагает галерею */}
      <input ref={gal} type="file" accept="image/*" hidden onChange={(e) => void onFile(e)} />
      {live && !noLive && (
        <Camera
          layouts={layouts}
          label={blankLabel(layouts)}
          onShot={onShot}
          onGallery={() => { setLive(false); gal.current?.click(); }}
          onClose={() => setLive(false)}
          onUnavailable={() => { setLive(false); setNoLive(true); }}
        />
      )}
      {noLive && liveCameraSupported() && <div className="ck-note warn">{NO_CAMERA}</div>}
      <button className="tg-btn-primary" disabled={busy} onClick={() => { if (noLive) cam.current?.click(); else setLive(true); }}><CameraIcon size={20} aria-hidden="true" />{busy ? 'Читаю…' : 'Снять эталон'}</button>
      <button className="tg-btn-secondary" disabled={busy} onClick={() => gal.current?.click()}><ImageIcon size={18} aria-hidden="true" />Выбрать из галереи</button>
      <HowToBlock layouts={layouts} />
    </>
  );
}
