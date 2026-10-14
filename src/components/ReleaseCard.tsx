import React from 'react';
import { KIND_LABELS, RANK_LABELS } from '../lib/releases';
import { SiteRelease } from '../types/database';

const KIND_STYLES = {
  new: 'bg-emerald-100 text-emerald-700',
  fixed: 'bg-amber-100 text-amber-700',
  improved: 'bg-blue-100 text-blue-700',
} as const;

export const formatReleaseDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/** Версия со списком пунктов; showAudience — подпись уровня для главного админа */
export const ReleaseCard: React.FC<{ release: SiteRelease; showAudience?: boolean; unread?: boolean }> = ({ release, showAudience, unread }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-sm font-bold text-slate-900">v{release.version}</span>
      {unread && <span className="text-[10px] font-bold uppercase bg-blue-600 text-white px-1.5 py-0.5 rounded">Новое</span>}
      <span className="text-xs text-slate-400">{formatReleaseDate(release.released_at)}</span>
    </div>
    {release.title && <div className="mt-1 text-sm font-semibold text-slate-700">{release.title}</div>}
    <ul className="mt-3 space-y-2">
      {release.site_release_items.map((i) => (
        <li key={i.id} className="flex items-start gap-2 text-sm text-slate-700">
          <span className={`shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${KIND_STYLES[i.kind]}`}>{KIND_LABELS[i.kind]}</span>
          <span className="min-w-0 break-words">
            {i.text}
            {showAudience && i.min_rank > 1 && <span className="ml-2 text-[11px] text-slate-400">({RANK_LABELS[i.min_rank]})</span>}
          </span>
        </li>
      ))}
    </ul>
  </div>
);
