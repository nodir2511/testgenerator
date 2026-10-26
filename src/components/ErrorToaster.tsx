import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, RotateCcw, Trash2, X } from 'lucide-react';
import { ERROR_EVENT, SUCCESS_EVENT, INFO_EVENT, UNDO_EVENT, type ExplainedError, type UndoToast } from '../lib/errors';

type Item =
  | (ExplainedError & { id: number; kind: 'error' })
  | { id: number; kind: 'success' | 'info'; title: string }
  | { id: number; kind: 'undo'; title: string; ms: number; undo: () => void };
type NewItem = Item extends infer T ? (T extends Item ? Omit<T, 'id'> : never) : never;

// Всплывающие уведомления (единые для всего сайта): ошибки (что не получилось и почему),
// подтверждения (изменение внесено в базу), подсказки и «Удалено · Отменить»
export default function ErrorToaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let n = 0;
    const push = (item: NewItem, ttl: number) => {
      const id = ++n;
      setItems((prev) => [...prev.filter((p) => !(p.kind === item.kind && p.title === item.title)).slice(-3), { ...item, id } as Item]);
      setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== id)), ttl);
    };
    const onError = (e: Event) => push({ ...(e as CustomEvent<ExplainedError>).detail, kind: 'error' }, 15000);
    const onSuccess = (e: Event) => push({ kind: 'success', title: (e as CustomEvent<string>).detail }, 4000);
    window.addEventListener(ERROR_EVENT, onError);
    window.addEventListener(SUCCESS_EVENT, onSuccess);
    const onInfo = (e: Event) => push({ kind: 'info', title: (e as CustomEvent<string>).detail }, 12000);
    window.addEventListener(INFO_EVENT, onInfo);
    const onUndo = (e: Event) => {
      const d = (e as CustomEvent<UndoToast>).detail;
      push({ kind: 'undo', title: d.title, ms: d.ms, undo: d.undo }, d.ms);
    };
    window.addEventListener(UNDO_EVENT, onUndo);
    return () => {
      window.removeEventListener(UNDO_EVENT, onUndo);
      window.removeEventListener(ERROR_EVENT, onError);
      window.removeEventListener(SUCCESS_EVENT, onSuccess);
      window.removeEventListener(INFO_EVENT, onInfo);
    };
  }, []);

  if (!items.length) return null;
  const close = (id: number) => setItems((p) => p.filter((x) => x.id !== id));
  return (
    <div className="fixed left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] md:left-auto md:translate-x-0 md:top-auto md:bottom-4 md:right-4 z-[100] flex w-[min(92vw,26rem)] flex-col gap-3">
      {items.map((it) =>
        it.kind === 'undo' ? (
          <div key={it.id} role="status" className="relative overflow-hidden rounded-xl bg-slate-900 text-white shadow-lg">
            <div className="flex items-center gap-3 p-2 pl-4">
              <Trash2 className="h-5 w-5 shrink-0 text-slate-500" />
              <p className="min-w-0 flex-1 text-sm font-semibold">{it.title}</p>
              <button
                onClick={() => { it.undo(); close(it.id); }}
                className="min-h-[44px] px-4 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold text-amber-300 flex items-center gap-1.5"
              >
                <RotateCcw className="h-4 w-4" /> Отменить
              </button>
            </div>
            <div className="absolute bottom-0 left-0 h-1 bg-amber-400 toast-countdown" style={{ animationDuration: `${it.ms}ms` }} />
          </div>
        ) : it.kind !== 'error' ? (
          <div key={it.id} role="status" className={`rounded-xl border bg-white p-4 shadow-lg ${it.kind === 'info' ? 'border-amber-200' : 'border-emerald-200'}`}>
            <div className="flex items-center gap-3">
              {it.kind === 'info'
                ? <Info className="h-5 w-5 shrink-0 text-amber-600" />
                : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />}
              <p className={`min-w-0 flex-1 text-sm ${it.kind === "info" ? "text-slate-700" : "font-semibold text-slate-900"}`}>{it.title}</p>
              <button onClick={() => close(it.id)} className="text-slate-500 hover:text-slate-600" aria-label="Закрыть">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
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
              <button onClick={() => close(it.id)} className="text-slate-500 hover:text-slate-600" aria-label="Закрыть">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
