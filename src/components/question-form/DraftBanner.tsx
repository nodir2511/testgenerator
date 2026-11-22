import React from 'react';
import type { Draft } from '../../lib/questionDraft';

interface DraftBannerProps {
  draft: Draft | null;
  dirty: boolean;
  restoreDraft: (d: Draft) => void;
  clearDraft: () => void;
}

// Баннер «есть несохранённый черновик» (только у нового вопроса, пока форма не тронута)
export const DraftBanner: React.FC<DraftBannerProps> = ({
  draft,
  dirty,
  restoreDraft,
  clearDraft,
}) => {
  return (
    <>
        {draft && !dirty && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex flex-wrap items-center gap-2 text-sm text-amber-900">
            <span className="flex-1 min-w-[12rem]">
              Есть несохранённый черновик от {new Date(draft.savedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
            <button type="button" onClick={() => restoreDraft(draft)} className="min-h-[40px] px-3 rounded-lg bg-amber-600 text-white font-semibold">
              Восстановить
            </button>
            <button type="button" onClick={clearDraft} className="min-h-[40px] px-3 rounded-lg bg-white border border-amber-200 font-semibold">
              Удалить
            </button>
          </div>
        )}
    </>
  );
};
