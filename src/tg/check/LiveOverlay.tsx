import { useEffect, useRef } from 'react';
import { coverMap, markPolygon, type LiveResult, type MarkTone } from './liveMarks';

/** Что показать поверх камеры: отметки последней пробы кадра */
export interface LiveView { result: LiveResult; toPhoto: number[]; w: number; h: number; stale: boolean }

// Цвета по белой бумаге, одинаковые в светлой и тёмной теме
const COLOR: Record<MarkTone, string> = { ok: '#16a34a', warn: '#f97316', bad: '#dc2626', read: '#2563eb' };
const PAD_MM = 0.5;

function draw(cv: HTMLCanvasElement, v: LiveView | null) {
  const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(3, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!v) return;
  const map = coverMap(v.w, v.h, W, H);
  ctx.lineJoin = 'round';
  for (const m of v.result.marks) {
    const p = markPolygon(m, v.toPhoto, map, PAD_MM);
    ctx.beginPath();
    p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    // Белая подложка отделяет цвет от чёрных линий бланка и от закрашенного кружка
    ctx.lineWidth = 5.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
    // Не только цвет: сомнительное — пунктиром, неверное — перечёркнуто
    ctx.setLineDash(m.tone === 'warn' ? [6, 3] : []);
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR[m.tone];
    ctx.stroke();
    ctx.setLineDash([]);
    if (m.tone === 'bad') {
      const a = p[m.round ? 3 : 0], b = p[m.round ? 15 : 2];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }
}

export function LiveOverlay({ view }: { view: LiveView | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef(view);
  last.current = view;
  useEffect(() => { if (ref.current) draw(ref.current, view); }, [view]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || typeof ResizeObserver === 'undefined') return;
    const o = new ResizeObserver(() => draw(cv, last.current));
    o.observe(cv);
    return () => o.disconnect();
  }, []);
  return <canvas ref={ref} className={`ck-live ${view?.stale ? 'stale' : ''}`} aria-hidden="true" />;
}

/** Легенда с числами: что значит каждый цвет и сколько таких ответов */
export function LiveLegend({ view, compare }: { view: LiveView | null; compare: boolean }) {
  const { counts, variant, problem } = view?.result ?? { counts: null, variant: null, problem: null };
  const checked = compare && !problem;
  const items: Array<[MarkTone, string]> = checked ? [['ok', 'верно'], ['warn', 'сомнения'], ['bad', 'неверно']] : [['read', 'прочитано'], ['warn', 'сомнения']];
  if (checked && counts?.read) items.push(['read', 'нет в ключе']);
  return (
    <div className="ck-live-legend">
      {problem ? <b className="problem">{problem}</b> : variant !== null && <b>Вариант {variant}</b>}
      {items.map(([t, text]) => <span key={t}><i style={{ background: COLOR[t] }} />{text}{counts ? ` ${counts[t]}` : ''}</span>)}
    </div>
  );
}
