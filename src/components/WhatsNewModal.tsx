import React from 'react';
import { Megaphone, X } from 'lucide-react';
import { SiteRelease } from '../types/database';
import { ReleaseCard } from './ReleaseCard';

/** Окно «Что нового» с непрочитанными версиями (только пункты уровня пользователя) */
export const WhatsNewModal: React.FC<{ releases: SiteRelease[]; onClose: () => void; onOpenHistory: () => void }> = ({ releases, onClose, onOpenHistory }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
    <div
      role="dialog"
      aria-label="Что нового"
      className="bg-slate-50 rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <Megaphone className="w-5 h-5 text-blue-600" /> Что нового
        </div>
        <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg" aria-label="Закрыть">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="overflow-y-auto p-4 space-y-3">
        {releases.map((r) => <ReleaseCard key={r.id} release={r} />)}
      </div>
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200">
        <button onClick={onOpenHistory} className="text-xs font-semibold text-blue-600 hover:underline">Вся история обновлений</button>
        <button onClick={onClose} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">Понятно</button>
      </div>
    </div>
  </div>
);
