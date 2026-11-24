import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { OMR_LAYOUTS } from '../../lib/omr/layouts.generated';
import { cropSheet, type RectMm } from '../../lib/omr/rectify';
import type { Sheet } from '../../lib/omr/process';
import type { GrayImage, OmrLayout } from '../../lib/omr/types';
import { useBack, useNoVerticalSwipes } from './telegram';

// Картинки раздела: полоска бланка, фрагменты снимка, просмотр крупно, памятка «как снимать».

/** Серое изображение на холсте; размер на экране задаёт CSS */
function Gray({ img, className, label }: { img: GrayImage; className?: string; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    cv.width = img.w;
    cv.height = img.h;
    const id = ctx.createImageData(img.w, img.h);
    for (let i = 0; i < img.w * img.h; i++) {
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = img.data[i];
      id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
  }, [img]);
  return <canvas ref={ref} className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/** Фрагмент снимка: как ответ отмечен на бумаге */
export function Crop({ sheet, rect, label }: { sheet: Sheet; rect: (l: OmrLayout) => RectMm; label: string }) {
  const [img] = useState(() => { const l = OMR_LAYOUTS[sheet.layout]; return l ? cropSheet(sheet.img, rect(l)) : null; });
  return img ? <Gray img={img} className="ck-crop" label={label} /> : null;
}

/** Снимок полоски; нажатие открывает крупно */
export function SheetPhoto({ sheet, small }: { sheet: Sheet; small?: boolean }) {
  const [open, setOpen] = useState(false);
  if (small) return <Gray img={sheet.img} className="ck-thumb" />;
  return (
    <>
      <button className="ck-photo" onClick={() => setOpen(true)} aria-label="Открыть снимок крупно"><Gray img={sheet.img} /></button>
      {open && <Zoom sheet={sheet} onClose={() => setOpen(false)} />}
    </>
  );
}

function Zoom({ sheet, onClose }: { sheet: Sheet; onClose: () => void }) {
  useBack(onClose);
  useNoVerticalSwipes();
  const [big, setBig] = useState(false);
  return (
    <div className="ck-zoom" role="dialog" aria-modal="true" aria-label="Снимок бланка">
      <div className="ck-zoom-head"><span>Нажмите на снимок, чтобы {big ? 'уменьшить' : 'увеличить'}</span><button className="ck-icon" aria-label="Закрыть снимок" onClick={onClose}><X size={22} aria-hidden="true" /></button></div>
      <div className="ck-zoom-body">
        <button className={big ? 'big' : ''} aria-label={big ? 'Уменьшить' : 'Увеличить'} onClick={() => setBig(!big)}><Gray img={sheet.img} label="Снимок бланка" /></button>
      </div>
    </div>
  );
}

/** Памятка: какую часть листа снимать и что должно быть видно */
export function HowTo({ layout }: { layout?: OmrLayout }) {
  const w = 210, h = layout?.strip.h ?? 99;
  return (
    <div className="ck-howto">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Полоска бланка с четырьмя чёрными метками по углам">
        <rect x="0.5" y="0.5" width={w - 1} height={h - 1} rx="3" className="paper" />
        {(layout?.markers ?? []).map((m) => <rect key={`${m.x}-${m.y}`} x={m.x - 4} y={m.y - 4} width="8" height="8" className="mark" />)}
        {layout && [...layout.tests.flatMap((t) => t.options), ...layout.matching.flatMap((m) => m.rows.flatMap((r) => r.options))].map((o) => <circle key={`${o.x}-${o.y}`} cx={o.x} cy={o.y} r={o.d / 2.6} className="dot" />)}
        {layout?.open.flatMap((o) => o.boxes).map((b) => <rect key={`${b.x}-${b.y}`} x={b.x} y={b.y} width={b.w} height={b.h} className="dot" />)}
      </svg>
      <ul>
        <li>В кадре одна полоска, видны все четыре чёрные метки</li>
        <li>Лист лежит ровно, телефон держите прямо над ним</li>
        <li>Свет ровный, без тени от руки и бликов</li>
      </ul>
    </div>
  );
}
