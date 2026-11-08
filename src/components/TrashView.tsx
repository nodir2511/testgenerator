import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from './ui';
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
      qc.invalidateQueries({ queryKey: ['question_counts'] });
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>;
  const list = data?.list ?? [];

  return (
    <div className="space-y-3 max-w-5xl mx-auto">
      <PageHeader
        icon={Trash2}
        title="Корзина"
        description="Удалённые вопросы. Восстановленный вопрос вернётся в банк на прежнее место."
      />
      {list.length === 0 && (
        <Card>
          <EmptyState
            icon={Trash2}
            title="Корзина пуста"
            description="Сюда попадают вопросы, удалённые из банка. Отсюда их можно вернуть."
          />
        </Card>
      )}
      {list.map((r) => (
        <Card key={r.id} padding="sm" className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-800 line-clamp-3 break-words">{r.content_ru || r.content || '(без текста)'}</div>
            <div className="text-xs text-slate-600 mt-1">
              {r.topics?.name ? `${r.topics.name} · ` : ''}
              {r.deleted_at ? new Date(r.deleted_at).toLocaleString('ru-RU') : 'дата неизвестна'}
              {' · '}{r.deleted_by ? (data?.names[r.deleted_by] ?? 'удалил пользователь') : 'кто удалил — неизвестно'}
            </div>
          </div>
          <Button variant="secondary" icon={RotateCcw} onClick={() => restore.mutate(r.id)} loading={restore.isPending} className="shrink-0 text-primary-ink border-indigo-200">
            Вернуть
          </Button>
        </Card>
      ))}
      {list.length >= limit && (
        <Button variant="ghost" onClick={() => setLimit(limit + PAGE)} className="w-full text-primary-ink">Показать ещё</Button>
      )}
    </div>
  );
};
