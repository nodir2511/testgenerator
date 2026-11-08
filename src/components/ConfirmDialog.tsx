import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { registerConfirmHost, type ConfirmRequest } from '../lib/confirm';

// Единое окно подтверждения (на телефоне — шторка снизу, на компьютере — по центру).
// Подключается один раз на странице; запросы из confirmAction() встают в очередь.
export default function ConfirmDialog() {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const req = queue[0];

  useEffect(() => registerConfirmHost((r) => setQueue((q) => [...q, r])), []);

  const answer = useCallback((ok: boolean) => {
    setQueue((q) => {
      q[0]?.resolve(ok);
      return q.slice(1);
    });
  }, []);

  // Фокус: на опасное действие сразу попасть Enter-ом нельзя — фокус на «Отмена»
  useEffect(() => {
    if (!req) return;
    const prev = document.activeElement as HTMLElement | null;
    (req.tone === 'danger' ? cancelRef : confirmRef).current?.focus();
    const scrollY = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = scrollY;
      prev?.focus?.();
    };
  }, [req?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(false); }
      if (e.key === 'Tab') {
        // Фокус не выходит за пределы окна
        const first = cancelRef.current, last = confirmRef.current;
        if (!first || !last) return;
        const order = [first, last];
        const i = order.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [req, answer]);

  if (!req) return null;
  const danger = req.tone === 'danger';
  const Icon = danger ? AlertTriangle : HelpCircle;
  const titleId = `confirm-title-${req.id}`;

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-slate-950/50 sm:p-4" onClick={() => answer(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-6 animate-in fade-in slide-in-from-bottom-4 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600'}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold text-slate-900 leading-snug break-words">{req.title}</h2>
            {req.message && <p className="mt-1.5 text-sm text-slate-700 leading-relaxed break-words">{req.message}</p>}
            {req.details && req.details.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-800">
                {req.details.map((d) => (
                  <li key={d} className="flex gap-2"><span className="text-slate-400">•</span><span className="break-words">{d}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => answer(false)}
            className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {req.cancelLabel ?? 'Отмена'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => answer(true)}
            className={`min-h-[44px] px-5 rounded-xl text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
              danger ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500' : 'bg-indigo-600 hover:bg-indigo-700 focus-visible:ring-indigo-500'
            }`}
          >
            {req.confirmLabel ?? 'Подтвердить'}
          </button>
        </div>
      </div>
    </div>
  );
}
