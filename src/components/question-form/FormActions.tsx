import React from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import type { Question } from '../../types/database';

interface FormActionsProps {
  initialData?: Question | null;
  onCancel: () => void;
  /** Мутация сохранения: true — «Сохранить и добавить следующий» */
  saveMutation: { isPending: boolean; mutate: (next: boolean) => void };
  uploadingImage: boolean;
  pendingUploads: number;
}

// Кнопки «Отмена», «Сохранить + ещё» и «Сохранить» (на телефоне закреплены над нижним меню)
export const FormActions: React.FC<FormActionsProps> = ({
  initialData,
  onCancel,
  saveMutation,
  uploadingImage,
  pendingUploads,
}) => {
  return (
        <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3 bg-white/95 backdrop-blur border-t border-slate-200 rounded-b-2xl grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saveMutation.isPending || uploadingImage || pendingUploads > 0}
            className="min-h-[44px] px-4 border border-slate-300 hover:bg-slate-100 text-slate-700 text-sm font-semibold rounded-xl transition"
          >
            Отмена
          </button>
          {!initialData && (
            <button
              type="button"
              onClick={() => saveMutation.mutate(true)}
              disabled={saveMutation.isPending || uploadingImage || pendingUploads > 0}
              className="min-h-[44px] px-4 border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-700 text-sm font-semibold rounded-xl transition disabled:opacity-50"
            >
              Сохранить + ещё
            </button>
          )}
          <button
            type="button"
            onClick={() => saveMutation.mutate(false)}
            disabled={saveMutation.isPending || uploadingImage || pendingUploads > 0}
            className={`${initialData ? '' : 'col-span-2 order-first sm:order-none'} min-h-[48px] px-5 bg-indigo-600 hover:bg-indigo-700 text-white text-base sm:text-sm font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2 disabled:opacity-50`}
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>{initialData ? 'Сохранить' : 'Создать вопрос'}</span>
          </button>
        </div>
  );
};
