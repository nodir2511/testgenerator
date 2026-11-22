import React from 'react';
import { Languages } from 'lucide-react';
import type { QuestionType } from '../../types/database';
import type { FormMode } from './types';

interface TypeAndLangBarProps {
  type: QuestionType;
  setType: React.Dispatch<React.SetStateAction<QuestionType>>;
  formMode: FormMode;
  setFormMode: React.Dispatch<React.SetStateAction<FormMode>>;
}

// Выбор типа вопроса и языкового режима редактора
export const TypeAndLangBar: React.FC<TypeAndLangBarProps> = ({
  type,
  setType,
  formMode,
  setFormMode,
}) => {
  return (
    <>
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
            Тип вопроса *
          </label>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-3">
            {[
              { id: 'test', title: 'Тестовый', desc: 'С вариантами ответа' },
              { id: 'matching', title: 'Соответствие', desc: 'Два списка (левый и правый)' },
              { id: 'open', title: 'Открытый', desc: 'Числовой ответ' },
            ].map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id as QuestionType)}
                className={`p-3 text-left rounded-xl border transition ${
                  type === t.id
                    ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500'
                    : 'border-slate-200 hover:border-slate-300'
                } min-h-[40px]`}
              >
                <div className="font-bold text-sm text-slate-900 break-words">{t.title}</div>
                <div className="text-xs text-slate-500 break-words">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ПЕРЕКЛЮЧАТЕЛЬ ДВУЯЗЫЧНОГО РЕЖИМА */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3 gap-2">
          <div className="flex items-center space-x-2">
            <Languages className="w-4 h-4 text-purple-600" />
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Языковой режим редактора:
            </span>
          </div>
          <div role="radiogroup" aria-label="Языковой режим редактора" className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-slate-100 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setFormMode('both')}
              role="radio"
              aria-checked={formMode === 'both'}
              className={`px-3 py-1.5 rounded-lg transition flex items-center space-x-1.5 ${
                formMode === 'both'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              } min-h-[40px]`}
            >
              <span>🌐 Двойной (RU + TJ)</span>
            </button>
            <button
              type="button"
              onClick={() => setFormMode('ru')}
              role="radio"
              aria-checked={formMode === 'ru'}
              className={`px-3 py-1.5 rounded-lg transition ${
                formMode === 'ru'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              } min-h-[40px]`}
            >
              <span>Русский</span>
            </button>
            <button
              type="button"
              onClick={() => setFormMode('tg')}
              role="radio"
              aria-checked={formMode === 'tg'}
              className={`px-3 py-1.5 rounded-lg transition ${
                formMode === 'tg'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              } min-h-[40px]`}
            >
              <span>Тоҷикӣ</span>
            </button>
          </div>
        </div>
    </>
  );
};
