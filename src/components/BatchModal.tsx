// Окно правки набора билетов: замена вопроса, снятие темы, правка вопроса в наборе.
import React from 'react';
import { X } from 'lucide-react';

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }> = ({ title, onClose, children, footer }) => {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/50 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-xl max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-xl">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-900 text-base leading-snug">{title}</h3>
          <button onClick={onClose} className="w-10 h-10 -mr-2 -mt-2 rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center shrink-0" aria-label="Закрыть"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 overflow-y-auto space-y-3 text-sm text-slate-700">{children}</div>
        {footer && <div className="p-4 border-t border-slate-100 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};
