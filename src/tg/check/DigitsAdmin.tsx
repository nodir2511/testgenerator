import { useEffect, useRef, useState } from 'react';
import { PIX, pixFromBase64 } from '../../lib/omr/digits';
import type { Api } from './Results';
import { confirmDialog } from './telegram';

// Чистка собранных цифр — только главный админ.
function PxPic({ px, on, label, onClick }: { px: string; on: boolean; label: string; onClick: () => void }) {
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
      if (v) { ctx.fillStyle = `rgba(0,0,0,${v / 255})`; ctx.fillRect(x * k, y * k, k, k); }
    }
  }, [px]);
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onClick} style={{ padding: 0, border: on ? '2px solid #dc2626' : '1px solid var(--line)', borderRadius: 6, background: '#fff', lineHeight: 0 }}>
      <canvas ref={ref} style={{ width: 48, height: 48, borderRadius: 5 }} />
    </button>
  );
}

export function DigitsAdmin({ api, onError }: { api: Api; onError: (e: unknown) => void }) {
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

  const digits = Array.from({ length: 10 }, (_, d) => d);
  return (
    <>
      <h1>Собранные цифры</h1>
      <p className="ck-p">Картинки, из которых строятся подсказки. Выберите цифру, отметьте ошибочные картинки и удалите их или перенесите в нужную цифру. Показаны 150 последних.</p>
      <div className="tg-chips" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {digits.map((d) => (
          <button key={d} className={`tg-chip ${digit === d ? 'on' : ''}`} onClick={() => { setDigit(d); void load(d); }}>{d}<span className="ck-sub" style={{ color: 'inherit', margin: 0 }}>{counts[d] ?? '…'}</span></button>
        ))}
      </div>
      {busy && <p className="ck-p" style={{ marginTop: 12 }}>Загрузка…</p>}
      {digit !== null && !busy && items.length === 0 && <p className="ck-p" style={{ marginTop: 12 }}>Картинок этой цифры пока нет.</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
        {items.map((it) => (
          <PxPic key={it.id} px={it.px} label={`Картинка ${it.id}`} on={sel.has(it.id)} onClick={() => setSel((s) => { const n = new Set(s); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })} />
        ))}
      </div>
      {sel.size > 0 && (
        <div className="ck-card">
          <b>Выбрано: {sel.size}</b>
          <p className="ck-sub">Перенести в цифру:</p>
          <div className="tg-chips" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
            {digits.map((d) => (d === digit ? null : <button key={d} className="tg-chip" disabled={busy} onClick={() => void act('digits_admin_relabel', { digit: d })}>{d}</button>))}
          </div>
          <button className="ck-text danger" disabled={busy} onClick={() => void confirmDialog(`Удалить выбранные картинки (${sel.size})? Это нельзя отменить.`).then((ok) => { if (ok) void act('digits_admin_delete'); })}>Удалить выбранные</button>
        </div>
      )}
    </>
  );
}
