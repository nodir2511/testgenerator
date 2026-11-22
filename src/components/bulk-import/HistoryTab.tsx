// Импорт: вкладка «История партий и откат» (для админов)
import React from 'react';
import { Undo2 } from 'lucide-react';
import { confirmAction } from '../../lib/confirm';
import { Hint } from '../ui';

interface Props {
  batches: any[];
  revertBatchMutation: { mutate: (batchId: string) => void };
}

export const HistoryTab: React.FC<Props> = ({ batches, revertBatchMutation }) => (
  <div className="space-y-3">
    <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-1">
      Ранее загруженные партии вопросов
      <Hint label="Что такое партия">Партия — один загруженный файл или вставленный текст. «Откатить партию» скроет из банка все вопросы из неё, остальные вопросы не затрагиваются.</Hint>
    </h3>
    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
      {batches.map((b: any) => (
        <div key={b.id} className="p-4 flex items-center justify-between bg-white hover:bg-slate-50">
          <div>
            <div className="font-medium text-xs text-slate-900">{b.filename}</div>
            <div className="text-xs text-slate-500">
              Вопросов: {b.items_count} • Дата: {new Date(b.created_at).toLocaleString('ru-RU')}
            </div>
          </div>
          <div>
            {b.is_reverted ? (
              <span className="text-xs text-slate-500 font-medium">Откачено</span>
            ) : (
              <button
                onClick={async () => {
                  if (await confirmAction({
                    title: 'Откатить эту партию импорта?',
                    message: 'Все вопросы партии будут скрыты из банка.',
                    details: [`Вопросов: ${b.items_count}`],
                    confirmLabel: 'Откатить партию', cancelLabel: 'Оставить', tone: 'danger',
                  })) {
                    revertBatchMutation.mutate(b.id);
                  }
                }}
                className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 border border-red-200 rounded-lg flex items-center space-x-1 font-semibold min-h-[40px]"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>Откатить партию</span>
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  </div>
);
