import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { assertRowsChanged, notifyInfo } from '../lib/errors';

const PAGE = 50;

interface Row {
  id: string; content_ru: string | null; content: string | null; deleted_at: string | null; deleted_by: string | null;
  topics: { name: string } | null;
}

/** Корзина: удалённые вопросы, кто и когда удалил, восстановление (админы) */
export const TrashView: React.FC = () => {
  const qc = useQueryClient();
  const [limit, setLimit] = useState(PAGE);

  const { data, isLoading } = useQuery({
    queryKey: ['trash', limit],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('questions')
        .select('id, content_ru, content, deleted_at, deleted_by, topics(name)')
        .eq('is_deleted', true)
        .order('deleted_at', { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) throw error;
      const list = (rows ?? []) as unknown as Row[];
      const ids = [...new Set(list.map((r) => r.deleted_by).filter(Boolean))] as string[];
      const names: Record<string, string> = {};
      if (ids.length) {
        const { data: ps } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
        (ps ?? []).forEach((p) => { names[p.id] = p.full_name || p.email; });
      }
      return { list, names };
    },
  });

  const restore = useMutation({
    mutationFn: async (id: string) => {
      const { data: d, error } = await supabase.from('questions').update({ is_deleted: false }).eq('id', id).select('id');
      if (error) throw error;
      assertRowsChanged(d, 'вопрос');
    },
    meta: { action: 'Не удалось восстановить вопрос' },
    onSuccess: () => {
      notifyInfo('Вопрос восстановлен');
      qc.invalidateQueries({ queryKey: ['trash'] });
      qc.invalidateQueries({ queryKey: ['questions'] });
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>;
  const list = data?.list ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Удалённые вопросы. Восстановленный вопрос вернётся в банк.</p>
      {list.length === 0 && <div className="text-center text-slate-500 py-10">Корзина пуста</div>}
      {list.map((r) => (
        <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-800 line-clamp-3 break-words">{r.content_ru || r.content || '(без текста)'}</div>
            <div className="text-xs text-slate-500 mt-1">
              {r.topics?.name ? `${r.topics.name} · ` : ''}
              {r.deleted_at ? new Date(r.deleted_at).toLocaleString('ru-RU') : 'дата неизвестна'}
              {' · '}{r.deleted_by ? (data?.names[r.deleted_by] ?? 'удалил пользователь') : 'кто удалил — неизвестно'}
            </div>
          </div>
          <button
            onClick={() => restore.mutate(r.id)}
            disabled={restore.isPending}
            className="min-h-[44px] px-3 text-sm font-semibold text-indigo-700 border border-indigo-200 rounded-lg flex items-center gap-1 shrink-0 disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" /> Вернуть
          </button>
        </div>
      ))}
      {list.length >= limit && (
        <button onClick={() => setLimit(limit + PAGE)} className="w-full min-h-[44px] text-sm font-semibold text-indigo-700">Показать ещё</button>
      )}
    </div>
  );
};
