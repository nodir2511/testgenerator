import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2, X, Megaphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useReleases } from '../hooks/useReleases';
import { KIND_LABELS, RANK_LABELS, SCOPE_LABELS } from '../lib/releases';
import { ReleaseItemKind, ReleaseItemScope, ReleaseRank, SiteRelease } from '../types/database';
import { ReleaseCard } from './ReleaseCard';
import { CustomSelect } from './CustomSelect';
import { confirmAction } from '../lib/confirm';
import { Button, Card, EmptyState, PageHeader, SkeletonList } from './ui';

interface DraftItem { kind: ReleaseItemKind; scope: ReleaseItemScope; text: string; min_rank: ReleaseRank; subject_id: string }
type SubjectOpt = { id: string; name: string };
interface Draft { id?: string; version: string; title: string; released_at: string; items: DraftItem[] }

const today = () => new Date().toISOString().slice(0, 10);
const emptyDraft = (): Draft => ({ version: '', title: '', released_at: today(), items: [{ kind: 'new', scope: 'site', text: '', min_rank: 1, subject_id: '' }] });

/** Форма главного админа: добавление и правка записей об обновлениях */
const ReleaseEditor: React.FC<{ initial: Draft; subjects: SubjectOpt[]; onClose: () => void }> = ({ initial, subjects, onClose }) => {
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
        items.map((i, n) => ({ release_id: id, kind: i.kind, scope: i.scope, text: i.text.trim(), min_rank: i.min_rank, subject_id: i.subject_id || null, order_index: n })),
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
    <div className="bg-white border border-indigo-200 rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-slate-900">{draft.id ? 'Правка обновления' : 'Новое обновление'}</h3>
        <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-700 min-h-[40px]" aria-label="Закрыть"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input className={field} placeholder="Версия, напр. 0.3.0" value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} />
        <input className={`${field} sm:col-span-1`} placeholder="Заголовок (необязательно)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <input type="date" className={field} value={draft.released_at} onChange={(e) => setDraft({ ...draft, released_at: e.target.value })} />
      </div>
      <div className="space-y-2">
        {draft.items.map((it, n) => (
          <div key={n} className="grid grid-cols-1 sm:grid-cols-[8rem_9rem_1fr_14rem_10rem_auto] gap-2 items-start">
            <CustomSelect className={field} value={it.kind} onChange={(val) => setItem(n, { kind: val as ReleaseItemKind })}>
              {(Object.keys(KIND_LABELS) as ReleaseItemKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </CustomSelect>
            <CustomSelect className={field} value={it.scope} onChange={(val) => setItem(n, { scope: val as ReleaseItemScope })}>
              {(Object.keys(SCOPE_LABELS) as ReleaseItemScope[]).map((k) => <option key={k} value={k}>{SCOPE_LABELS[k]}</option>)}
            </CustomSelect>
            <textarea className={field} rows={2} placeholder="Что изменилось" value={it.text} onChange={(e) => setItem(n, { text: e.target.value })} />
            <CustomSelect className={field} value={it.min_rank} onChange={(val) => setItem(n, { min_rank: Number(val) as ReleaseRank })}>
              {([1, 2, 3, 4] as ReleaseRank[]).map((r) => <option key={r} value={r}>{RANK_LABELS[r]}</option>)}
            </CustomSelect>
            <CustomSelect className={field} value={it.subject_id} onChange={(val) => setItem(n, { subject_id: val })}>
              <option value="">Любой предмет</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </CustomSelect>
            <button
              onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((_, k) => k !== n) }))}
              className="p-2 text-slate-500 hover:text-red-600 min-h-[40px]" aria-label="Удалить пункт"
            ><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button onClick={() => setDraft((d) => ({ ...d, items: [...d.items, { kind: 'new', scope: 'site', text: '', min_rank: 1, subject_id: '' }] }))} className="text-sm font-semibold text-indigo-600 hover:underline min-h-[40px]">
          + Добавить пункт
        </button>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 min-h-[40px]">Отмена</button>
        <Button variant="primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Сохранить
        </Button>
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
  const subjectsQ = useQuery({
    queryKey: ['subjects-for-releases'],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('id, name').eq('is_deleted', false).order('name');
      if (error) throw error;
      return (data ?? []) as SubjectOpt[];
    },
  });
  const subjects = subjectsQ.data ?? [];
  const subjectNames = Object.fromEntries(subjects.map((s) => [s.id, s.name]));
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
      items: [...r.site_release_items].sort((a, b) => a.order_index - b.order_index).map((i) => ({ kind: i.kind, scope: i.scope ?? 'site', text: i.text, min_rank: i.min_rank, subject_id: i.subject_id ?? '' })),
    });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="История обновлений"
        description="Показаны изменения, относящиеся к вашей роли"
        actions={isOwner && !draft && <Button variant="primary" icon={Plus} onClick={() => setDraft(emptyDraft())}>Добавить</Button>}
      />

      {draft && <ReleaseEditor key={draft.id ?? 'new'} initial={draft} subjects={subjects} onClose={() => setDraft(null)} />}

      {isLoading ? (
        <SkeletonList rows={2} />
      ) : releases.length === 0 ? (
        <Card><EmptyState icon={Megaphone} title="Пока нет записей об обновлениях" description="Когда на сайте что-то изменится, это появится здесь." /></Card>
      ) : (
        releases.map((r) => (
          <div key={r.id} className="relative">
            <ReleaseCard release={r} showAudience={isOwner} subjectNames={subjectNames} unread={unreadIds.has(r.id)} />
            {isOwner && (
              <div className="absolute top-3 right-3 flex gap-1">
                <button onClick={() => edit(r)} className="p-1.5 text-slate-500 hover:text-indigo-600 min-h-[40px]" aria-label="Править"><Pencil className="w-4 h-4" /></button>
                <button
                  onClick={async () => {
                    if (await confirmAction({ title: `Удалить версию ${r.version}?`, message: 'Запись пропадёт из истории обновлений у всех пользователей.', confirmLabel: 'Удалить версию', cancelLabel: 'Оставить', tone: 'danger' })) remove.mutate(r.id);
                  }}
                  className="p-1.5 text-slate-500 hover:text-red-600 min-h-[40px]" aria-label="Удалить"
                ><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};
