import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ERROR_EVENT, type ExplainedError } from '../lib/errors';

interface Item extends ExplainedError { id: number }

// Всплывающие предупреждения об ошибках: что не получилось и почему
export default function ErrorToaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let n = 0;
    const onError = (e: Event) => {
      const detail = (e as CustomEvent<ExplainedError>).detail;
      const id = ++n;
      setItems((prev) => [...prev.filter((p) => p.details !== detail.details || p.title !== detail.title).slice(-3), { ...detail, id }]);
      setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== id)), 15000);
    };
    window.addEventListener(ERROR_EVENT, onError);
    return () => window.removeEventListener(ERROR_EVENT, onError);
  }, []);

  if (!items.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-[min(92vw,26rem)] flex-col gap-3">
      {items.map((it) => (
        <div key={it.id} role="alert" className="rounded-xl border border-red-200 bg-white p-4 shadow-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-slate-900">{it.title}</p>
              <p className="mt-1 text-slate-700">{it.reason}</p>
              {it.details && (
                <details className="mt-2 text-xs text-slate-500">
                  <summary className="cursor-pointer">Технические подробности</summary>
                  <p className="mt-1 break-words">{it.details}</p>
                </details>
              )}
            </div>
            <button onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} className="text-slate-400 hover:text-slate-600" aria-label="Закрыть">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
