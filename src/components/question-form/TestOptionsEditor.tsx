import React from 'react';
import { CheckCircle2, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import type { TestOptionState } from '../../lib/questionDraft';
import { Field, IconButton } from '../ui';
import type { FormMode } from './types';

interface TestOptionsEditorProps {
  options: TestOptionState[];
  setOptions: React.Dispatch<React.SetStateAction<TestOptionState[]>>;
  formMode: FormMode;
  handleOptionImageUpload: (index: number, e: React.ChangeEvent<HTMLInputElement>) => void;
}

// Варианты ответа тестового вопроса
export const TestOptionsEditor: React.FC<TestOptionsEditorProps> = ({
  options,
  setOptions,
  formMode,
  handleOptionImageUpload,
}) => {
  return (
          <div id="qf-answers" className="scroll-mt-24 space-y-3 pt-3 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Варианты ответа (A, B, C, D...)
              </label>
              <button
                type="button"
                onClick={() => setOptions([...options, { text: '', text_ru: '', text_tg: '', is_correct: false }])}
                className="text-sm text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg font-semibold flex items-center space-x-1 transition min-h-[40px]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить вариант</span>
              </button>
            </div>

            <div className="space-y-3">
              {options.map((opt, idx) => {
                const optLetter = ['A', 'B', 'C', 'D', 'E', 'F'][idx] || String.fromCharCode(65 + idx);

                return (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-800 text-xs font-bold flex items-center justify-center shrink-0">
                          {optLetter}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...options];
                            updated[idx].is_correct = !updated[idx].is_correct;
                            setOptions(updated);
                          }}
                          className={`px-2 py-0.5 rounded text-sm font-semibold border flex items-center space-x-1 transition ${
                            opt.is_correct
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                              : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                          } min-h-[40px]`}
                        >
                          <CheckCircle2 className={`w-3.5 h-3.5 ${opt.is_correct ? 'text-emerald-600' : 'text-slate-500'}`} />
                          <span>{opt.is_correct ? 'Верный ответ' : 'Отметить как верный'}</span>
                        </button>
                      </div>

                      <div className="flex items-center space-x-1">
                        <label 
                          className="cursor-pointer p-1.5 bg-white hover:bg-slate-100 text-slate-500 rounded-lg border border-slate-300 transition" 
                          title="Прикрепить изображение формулы к варианту"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleOptionImageUpload(idx, e)}
                            className="hidden"
                          />
                        </label>
                        {options.length > 2 && (
                          <IconButton
                            icon={Trash2}
                            label="Удалить вариант"
                            onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                            className="w-10 h-10 text-slate-500 hover:text-red-600 hover:bg-red-50"
                          />
                        )}
                      </div>
                    </div>

                    {/* Поля ввода варианта в зависимости от выбранного режима */}
                    {formMode === 'both' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <Field label="Русский (RU)">
<input
                            type="text"
                            value={opt.text_ru ?? opt.text ?? ''}
                            onChange={(e) => {
                              const updated = [...options];
                              updated[idx].text_ru = e.target.value;
                              updated[idx].text = e.target.value;
                              setOptions(updated);
                            }}
                            placeholder={`Вариант ${optLetter} (RU)`}
                            className="w-full text-sm p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                          />
</Field>
                        <Field label="Тоҷикӣ (TJ)">
<input
                            type="text"
                            value={opt.text_tg ?? ''}
                            onChange={(e) => {
                              const updated = [...options];
                              updated[idx].text_tg = e.target.value;
                              setOptions(updated);
                            }}
                            placeholder={`Варианти ${optLetter} (TJ)`}
                            className="w-full text-sm p-2 bg-white border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                          />
</Field>
                      </div>
                    ) : formMode === 'ru' ? (
                      <div>
                        <input
                          type="text"
                          value={opt.text_ru ?? opt.text ?? ''}
                          onChange={(e) => {
                            const updated = [...options];
                            updated[idx].text_ru = e.target.value;
                            updated[idx].text = e.target.value;
                            setOptions(updated);
                          }}
                          placeholder={`Вариант ${optLetter} (RU)`}
                          className="w-full text-sm p-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                        />
                      </div>
                    ) : (
                      <div>
                        <input
                          type="text"
                          value={opt.text_tg ?? ''}
                          onChange={(e) => {
                            const updated = [...options];
                            updated[idx].text_tg = e.target.value;
                            setOptions(updated);
                          }}
                          placeholder={`Варианти ${optLetter} (TJ)`}
                          className="w-full text-sm p-2 bg-white border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                        />
                      </div>
                    )}

                    {/* Превью картинки варианта */}
                    {opt.image_url && (
                      <div className="flex items-center space-x-2 pt-1">
                        <img loading="lazy" decoding="async" 
                          src={opt.image_url} 
                          alt="Превью" 
                          className="h-16 w-auto max-w-[150px] object-contain rounded border bg-white p-1" 
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...options];
                            updated[idx].image_url = null;
                            setOptions(updated);
                          }}
                          className="text-sm text-red-500 hover:underline min-h-[40px]"
                        >
                          Удалить картинку
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
  );
};
