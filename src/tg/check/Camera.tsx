import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { OMR_LAYOUTS } from '../../lib/omr/layouts.generated';
import { loadGrayImage } from '../../lib/omr/image';
import { probeInBackground } from '../../lib/omr/omrClient';
import type { Sheet } from '../../lib/omr/process';
import { AUTO_START, autoStep, autoTaken } from './autosnap';
import { SheetPhoto } from './pictures';
import { useBack, useNoVerticalSwipes } from './telegram';

/** Итог снимка для строки состояния в видоискателе */
export interface ShotNote { tone: 'ok' | 'warn' | 'error'; text: string }

const AUTO_KEY = 'omr_autosnap_v1';
const PROBE_SIDE = 1000;
const PROBE_PAUSE_MS = 250;
const autoSaved = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };

export const liveCameraSupported = () => typeof navigator.mediaDevices?.getUserMedia === 'function';

/** Живой видоискатель: рамка по форме полоски, результат каждого снимка сразу на экране, автоснимок */
export function Camera({ layouts, label, count, last, onShot, onGallery, onClose, onUnavailable }: {
  layouts: string[];
  /** Какой бланк ждём */
  label: string;
  /** Сколько снимков уже в стопке; undefined — нужен один снимок (эталон) */
  count?: number;
  last?: Sheet;
  onShot: (frame: HTMLCanvasElement, auto: boolean) => Promise<ShotNote>;
  onGallery: () => void;
  onClose: () => void;
  onUnavailable: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [reading, setReading] = useState(0);
  const [note, setNote] = useState<ShotNote | null>(null);
  const [auto, setAuto] = useState(autoSaved);
  const [seen, setSeen] = useState(false);
  const [flash, setFlash] = useState(0);
  const state = useRef(AUTO_START);
  const alive = useRef(true);
  const cb = useRef({ onShot, onUnavailable });
  cb.current = { onShot, onUnavailable };
  useBack(onClose);
  useNoVerticalSwipes();

  useEffect(() => {
    alive.current = true;
    let stream: MediaStream | null = null;
    let starting = false;
    const start = async () => {
      if (starting) return;
      if (!liveCameraSupported()) { cb.current.onUnavailable(); return; }
      starting = true;
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive.current) { s.getTracks().forEach((t) => t.stop()); return; }
        stream?.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = videoRef.current;
        if (v) { v.srcObject = s; await v.play().catch(() => {}); setReady(true); }
      } catch {
        if (alive.current) cb.current.onUnavailable();
      } finally { starting = false; }
    };
    void start();
    // Вернулись из другого приложения: система могла остановить камеру
    const onShow = () => { if (!document.hidden && stream && stream.getVideoTracks().every((t) => t.readyState === 'ended')) void start(); };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onShow);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const grab = (side?: number): HTMLCanvasElement | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const k = side ? Math.min(1, side / Math.max(v.videoWidth, v.videoHeight)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k);
    c.height = Math.round(v.videoHeight * k);
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
    return c;
  };

  const shoot = useCallback(async (byAuto: boolean) => {
    const frame = grab();
    if (!frame) return;
    state.current = autoTaken(state.current);
    setFlash((n) => n + 1);
    setReading((n) => n + 1);
    try {
      const r = await cb.current.onShot(frame, byAuto);
      if (!alive.current) return;
      setNote(r);
      // Не прочиталось — тот же лист можно снова снимать автоматически
      if (byAuto && r.tone === 'error') state.current = AUTO_START;
    } finally {
      if (alive.current) setReading((n) => n - 1);
    }
  }, []);

  // Пробы кадра для автоснимка: следующая начинается, когда закончена прежняя
  const busy = reading > 0;
  useEffect(() => {
    if (!auto || !ready || busy) return;
    let off = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const c = document.hidden ? null : grab(PROBE_SIDE);
        if (c) {
          const corners = await probeInBackground(await loadGrayImage(c, PROBE_SIDE), layouts);
          if (off) return;
          const r = autoStep(state.current, corners, Math.max(c.width, c.height));
          state.current = r.state;
          setSeen(!!corners);
          if (r.snap) { void shoot(true); return; }
        }
      } catch { /* проба не удалась — попробуем на следующем кадре */ }
      if (!off) timer = setTimeout(() => void tick(), PROBE_PAUSE_MS);
    };
    timer = setTimeout(() => void tick(), PROBE_PAUSE_MS);
    return () => { off = true; clearTimeout(timer); };
  }, [auto, ready, busy, layouts, shoot]);

  const strip = OMR_LAYOUTS[layouts[0]]?.strip ?? { w: 210, h: 99 };
  const toggleAuto = () => {
    const v = !auto;
    setAuto(v);
    setSeen(false);
    try { localStorage.setItem(AUTO_KEY, v ? '1' : '0'); } catch { /* память недоступна */ }
  };

  return (
    <div className="ck-cam" role="dialog" aria-modal="true" aria-label="Съёмка бланка">
      <div className="ck-cam-top">
        <span>{label}</span>
        <button className="ck-cam-auto" role="switch" aria-checked={auto} onClick={toggleAuto}>Авто: {auto ? 'вкл' : 'выкл'}</button>
      </div>
      <div className="ck-cam-view">
        <video ref={videoRef} playsInline muted autoPlay />
        <div className={`ck-cam-frame ${seen ? 'seen' : ''}`} style={{ '--r': strip.h / strip.w } as CSSProperties}><i /><i /><i /><i /></div>
        {flash > 0 && <div key={flash} className="ck-cam-flash" />}
        <div className={`ck-cam-note ${reading ? '' : note?.tone ?? ''}`} role="status">
          {reading ? 'Читаю…' : note?.text ?? (!ready ? 'Включаю камеру…' : auto ? 'Наведите рамку на полоску — снимок сделается сам' : 'Наведите рамку на полоску и нажмите кнопку')}
        </div>
      </div>
      <div className="ck-cam-bar">
        <button className="ck-cam-side" onClick={onGallery} aria-label="Выбрать из галереи"><ImageIcon size={24} aria-hidden="true" /><small>Галерея</small></button>
        <button className="ck-cam-shutter" onClick={() => void shoot(false)} disabled={!ready || busy} aria-label="Сделать снимок" />
        <button className="ck-cam-side" onClick={onClose}>
          {last && <SheetPhoto sheet={last} small />}
          <b>{count === undefined ? 'Закрыть' : 'Готово'}</b>
          {count !== undefined && <small>в стопке: {count}</small>}
        </button>
      </div>
    </div>
  );
}
