import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { saveAs } from 'file-saver';
import { Download, History, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { notifyError, notifyInfo } from '../lib/errors';
import { clusterVariantsFromBatch } from '../lib/clusterStore';
import { Button, Card } from './ui';

// История экзаменов-кластеров внизу раздела: все созданные книжки (подбор из банка, готовые билеты, архивы),
// новые сверху. Это те же партии, что в «Архиве билетов» (generation_params.source = 'cluster'); отсюда их можно скачать снова.

const LIMIT = 30;

const fmtDate = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const ClusterHistory: React.FC = () => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['cluster_history'],
    staleTime: 30_000,
    meta: { action: 'Не удалось загрузить историю кластеров' },
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_batches')
        .select('id, title, created_at, generation_params, tickets(count)')
        .eq('generation_params->>source', 'cluster')
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const download = async (batch: any) => {
    setBusyId(batch.id);
    try {
      const settings = batch.generation_params?.cluster?.settings;
      if (!settings) throw new Error('В партии нет параметров экзамена');
      const { data, error } = await supabase
        .from('tickets')
        .select('ticket_number, questions:ticket_questions(order_index, question_snapshot)')
        .eq('batch_id', batch.id)
        .order('ticket_number');
      if (error) throw error;
      const { buildClusterZip } = await import('../lib/clusterExport');
      const file = await buildClusterZip(settings, clusterVariantsFromBatch(data || [], batch.generation_params));
      saveAs(file.blob, file.fileName);
      if (file.keyUniversal) notifyInfo(`Ключей в универсальной таблице (состав не поместился в шаблон): ${file.keyUniversal}.`);
      if (file.missingAnswers) notifyError(new Error(`Нет верного ответа у заданий: ${file.missingAnswers} — клетки в ключах отмечены красным.`), 'Кластер скачан, но ключи не полные');
    } catch (err) {
      notifyError(err, 'Не удалось скачать кластер');
    } finally {
      setBusyId(null);
    }
  };

  const rows = list.data ?? [];
  return (
    <Card padding="none" className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-slate-500" />
        <h3 className="font-bold text-slate-900 text-sm">История</h3>
      </div>
      {list.isLoading && <p className="text-xs text-slate-500">Загрузка…</p>}
      {!list.isLoading && rows.length === 0 && <p className="text-xs text-slate-500">Пока нет созданных кластеров.</p>}
      <ul className="divide-y divide-slate-200">
        {rows.map((b) => {
          const subjects: Array<{ name: string }> = b.generation_params?.cluster?.subjects ?? [];
          const count = Number(b.tickets?.[0]?.count ?? b.generation_params?.ticket_count ?? 0);
          return (
            <li key={b.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{b.title}</p>
                <p className="text-xs text-slate-600">
                  {fmtDate(b.created_at)} · вариантов: {count}{subjects.length ? ` · ${subjects.map((x) => x.name).join(', ')}` : ''}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => download(b)} disabled={busyId !== null} className="shrink-0">
                {busyId === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>Скачать</span>
              </Button>
            </li>
          );
        })}
      </ul>
      {rows.length >= LIMIT && <p className="text-xs text-slate-500">Показаны последние {LIMIT}. Остальные — в «Архиве билетов».</p>}
    </Card>
  );
};
