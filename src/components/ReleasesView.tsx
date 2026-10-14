import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useReleases } from '../hooks/useReleases';
import { KIND_LABELS, RANK_LABELS } from '../lib/releases';
import { ReleaseItemKind, ReleaseRank, SiteRelease } from '../types/database';
import { ReleaseCard } from './ReleaseCard';

interface DraftItem { kind: ReleaseItemKind; text: string; min_rank: ReleaseRank }
interface Draft { id?: string; version: string; title: string; released_at: string; items: DraftItem[] }

const today = () => new Date().toISOString().slice(0, 10);
const emptyDraft = (): Draft => ({ version: '', title: '', released_at: today(), items: [{ kind: 'new', text: '', min_rank: 1 }] });

/** Форма главного админа: добавление и правка записей об обновлениях */
const ReleaseEditor: React.FC<{ initial: Draft; onClose: () => void }> = ({ initial, onClose }) => {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(initial);
  const items = draft.items.filter((i) => i.text.trim());
  const valid = draft.version.trim() !== '' && items.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const row = { version: draft.version.trim(), title: draft.title.trim(), released_at: new Date(draft.released_at).toISOString() };
      let id = draft.id;
      if (id) {
        const { error } = await supabase.from('site_releases').update(row).eq('id', id);
        if (error) throw error;
        const { error: delErr } = await supabase.from('site_release_items').delete().eq('release_id', id);
        if (delErr) throw delErr;
      } else {
        const { data, error } = await supabase.from('site_releases').insert(row).select('id').single();
        if (error) throw error;
        id = data.id as string;
      }
      const { error } = await supabase.from('site_release_items').insert(
        items.map((i, n) => ({ release_id: id, kind: i.kind, text: i.text.trim(), min_rank: i.min_rank, order_index: n })),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-releases'] });
      onClose();
    },
    meta: { action: 'Не удалось сохранить обновление', success: 'Обновление сохранено' },
  });

  const setItem = (n: number, patch: Partial<DraftItem>) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, k) => (k === n ? { ...it, ...patch } : it)) }));
  const field = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';

  return (
    <div className="bg-white border border-blue-200 rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-slate-900">{draft.id ? 'Правка обновления' : 'Новое обновление'}</h3>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Закрыть"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input className={field} placeholder="Версия, напр. 0.3.0" value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} />
        <input className={`${field} sm:col-span-1`} placeholder="Заголовок (необязательно)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <input type="date" className={field} value={draft.released_at} onChange={(e) => setDraft({ ...draft, released_at: e.target.value })} />
      </div>
      <div className="space-y-2">
        {draft.items.map((it, n) => (
          <div key={n} className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_16rem_auto] gap-2 items-start">
            <select className={field} value={it.kind} onChange={(e) => setItem(n, { kind: e.target.value as ReleaseItemKind })}>
              {(Object.keys(KIND_LABELS) as ReleaseItemKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
            <textarea className={field} rows={2} placeholder="Что изменилось" value={it.text} onChange={(e) => setItem(n, { text: e.target.value })} />
            <select className={field} value={it.min_rank} onChange={(e) => setItem(n, { min_rank: Number(e.target.value) as ReleaseRank })}>
              {([1, 2, 3, 4] as ReleaseRank[]).map((r) => <option key={r} value={r}>{RANK_LABELS[r]}</option>)}
            </select>
            <button
              onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((_, k) => k !== n) }))}
              className="p-2 text-slate-400 hover:text-red-600" aria-label="Удалить пункт"
            ><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button onClick={() => setDraft((d) => ({ ...d, items: [...d.items, { kind: 'new', text: '', min_rank: 1 }] }))} className="text-xs font-semibold text-blue-600 hover:underline">
          + Добавить пункт
        </button>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Отмена</button>
        <button disabled={!valid || save.isPending} onClick={() => save.mutate()} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
          {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Сохранить
        </button>
      </div>
    </div>
  );
};

/** История обновлений: пользователь видит версии и пункты только своего уровня и ниже */
export const ReleasesView: React.FC = () => {
  const { isOwner } = useAuth();
  const qc = useQueryClient();
  const { releases, unread, isLoading, markRead } = useReleases();
  const [draft, setDraft] = useState<Draft | null>(null);
  const unreadIds = new Set(unread.map((r) => r.id));

  React.useEffect(() => {
    if (unread.length > 0) markRead(unread.map((r) => r.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread.length]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('site_releases').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-releases'] });
    },
    meta: { action: 'Не удалось удалить обновление', success: 'Обновление удалено' },
  });

  const edit = (r: SiteRelease) =>
    setDraft({
      id: r.id, version: r.version, title: r.title, released_at: r.released_at.slice(0, 10),
      items: [...r.site_release_items].sort((a, b) => a.order_index - b.order_index).map((i) => ({ kind: i.kind, text: i.text, min_rank: i.min_rank })),
    });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">История обновлений</h2>
          <p className="text-xs text-slate-500">Показаны изменения, относящиеся к вашей роли</p>
        </div>
        {isOwner && !draft && (
          <button onClick={() => setDraft(emptyDraft())} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Добавить
          </button>
        )}
      </div>

      {draft && <ReleaseEditor key={draft.id ?? 'new'} initial={draft} onClose={() => setDraft(null)} />}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-600 animate-spin" /></div>
      ) : releases.length === 0 ? (
        <div className="text-sm text-slate-500 py-8 text-center">Пока нет записей об обновлениях</div>
      ) : (
        releases.map((r) => (
          <div key={r.id} className="relative">
            <ReleaseCard release={r} showAudience={isOwner} unread={unreadIds.has(r.id)} />
            {isOwner && (
              <div className="absolute top-3 right-3 flex gap-1">
                <button onClick={() => edit(r)} className="p-1.5 text-slate-400 hover:text-blue-600" aria-label="Править"><Pencil className="w-4 h-4" /></button>
                <button
                  onClick={() => { if (window.confirm(`Удалить версию ${r.version}?`)) remove.mutate(r.id); }}
                  className="p-1.5 text-slate-400 hover:text-red-600" aria-label="Удалить"
                ><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};
