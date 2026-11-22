import React from 'react';
import { Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import type { MatchingItemState } from '../../lib/questionDraft';
import { CustomSelect } from '../CustomSelect';
import { Badge, IconButton } from '../ui';
import type { FormMode } from './types';

interface MatchingEditorProps {
  leftItems: MatchingItemState[];
  setLeftItems: React.Dispatch<React.SetStateAction<MatchingItemState[]>>;
  rightItems: MatchingItemState[];
  setRightItems: React.Dispatch<React.SetStateAction<MatchingItemState[]>>;
  formMode: FormMode;
  handleMatchingImageUpload: (side: 'left' | 'right', index: number, file: File) => void;
}

// Две колонки задания на соответствие и ответы к левой колонке
export const MatchingEditor: React.FC<MatchingEditorProps> = ({
  leftItems,
  setLeftItems,
  rightItems,
  setRightItems,
  formMode,
  handleMatchingImageUpload,
}) => {
  return (
          <div id="qf-answers" className="scroll-mt-24 space-y-4 pt-3 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              Левая колонка маркируется буквами (A, B, C, D), правая колонка — цифрами (1, 2, 3, 4, 5). В двойном режиме можно заполнять русский и таджикский варианты параллельно.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Левая колонка (A, B, C, D) */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-700">Левая часть (A, B, C, D...)</span>
                  <button
                    type="button"
                    onClick={() => setLeftItems([...leftItems, { side: 'left', text: '', text_ru: '', text_tg: '' }])}
                    className="text-sm text-indigo-600 hover:text-indigo-700 font-semibold flex items-center space-x-1 min-h-[40px]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить</span>
                  </button>
                </div>

                {leftItems.map((item, idx) => {
                  const letter = ['A', 'B', 'C', 'D', 'E', 'F'][idx] || String.fromCharCode(65 + idx);
                  return (
                    <div key={idx} className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge tone="primary" className="px-1.5 font-bold">
                            {letter}
                          </Badge>
                          <label className="flex items-center gap-1 text-xs text-slate-500">
                            <span>ответ →</span>
                            <CustomSelect
                              value={item.match ?? ''}
                              onChange={(val) => {
                                const updated = [...leftItems];
                                updated[idx] = { ...updated[idx], match: val === '' ? null : Number(val) };
                                setLeftItems(updated);
                              }}
                              className={`text-sm font-bold px-2 py-0.5 border rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 min-w-[54px] ${item.match == null ? 'border-red-300 bg-red-50 text-red-600' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}`}
                            >
                              <option value="">—</option>
                              {rightItems.map((_, k) => (
                                <option key={k} value={k}>{k + 1}</option>
                              ))}
                            </CustomSelect>
                          </label>
                        </div>
                        <div className="flex items-center space-x-1">
                          <label className="cursor-pointer min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-500 hover:text-slate-600 rounded-lg border border-slate-200" title="Прикрепить картинку" aria-label="Прикрепить картинку">
                            <ImageIcon className="w-3 h-3" />
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => e.target.files?.[0] && handleMatchingImageUpload('left', idx, e.target.files[0])}
                              className="hidden"
                            />
                          </label>
                          {leftItems.length > 1 && (
                            <IconButton
                              icon={Trash2}
                              label="Удалить элемент левой колонки"
                              onClick={() => setLeftItems(leftItems.filter((_, i) => i !== idx))}
                              className="w-10 h-10 text-slate-500 hover:text-red-600 hover:bg-red-50"
                            />
                          )}
                        </div>
                      </div>

                      {formMode === 'both' ? (
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={item.text_ru ?? item.text ?? ''}
                            onChange={(e) => {
                              const updated = [...leftItems];
                              updated[idx].text_ru = e.target.value;
                              updated[idx].text = e.target.value;
                              setLeftItems(updated);
                            }}
                            placeholder={`Элемент ${letter} (RU)`}
                            className="w-full text-sm p-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                          <input
                            type="text"
                            value={item.text_tg ?? ''}
                            onChange={(e) => {
                              const updated = [...leftItems];
                              updated[idx].text_tg = e.target.value;
                              setLeftItems(updated);
                            }}
                            placeholder={`Элементи ${letter} (TJ)`}
                            className="w-full text-sm p-1.5 border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </div>
                      ) : formMode === 'ru' ? (
                        <input
                          type="text"
                          value={item.text_ru ?? item.text ?? ''}
                          onChange={(e) => {
                            const updated = [...leftItems];
                            updated[idx].text_ru = e.target.value;
                            updated[idx].text = e.target.value;
                            setLeftItems(updated);
                          }}
                          placeholder={`Элемент ${letter} (RU)`}
                          className="w-full text-sm p-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      ) : (
                        <input
                          type="text"
                          value={item.text_tg ?? ''}
                          onChange={(e) => {
                            const updated = [...leftItems];
                            updated[idx].text_tg = e.target.value;
                            setLeftItems(updated);
                          }}
                          placeholder={`Элементи ${letter} (TJ)`}
                          className="w-full text-sm p-1.5 border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      )}

                      {item.image_url && (
                        <div className="flex items-center space-x-1 pt-1">
                          <img loading="lazy" decoding="async" src={item.image_url} alt="" className="h-10 w-auto object-contain rounded border" />
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...leftItems];
                              updated[idx].image_url = null;
                              setLeftItems(updated);
                            }}
                            className="text-sm text-red-500 hover:underline min-h-[40px]"
                          >
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Правая колонка (1, 2, 3, 4, 5) */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs uppercase tracking-wider text-slate-700">Правая часть (1, 2, 3...)</span>
                  <button
                    type="button"
                    onClick={() => setRightItems([...rightItems, { side: 'right', text: '', text_ru: '', text_tg: '' }])}
                    className="text-sm text-indigo-600 hover:text-indigo-700 font-semibold flex items-center space-x-1 min-h-[40px]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить</span>
                  </button>
                </div>

                {rightItems.map((item, idx) => (
                  <div key={idx} className="p-2.5 bg-white border border-slate-200 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Badge tone="neutral" className="px-1.5 font-bold">
                        {idx + 1}
                      </Badge>
                      <div className="flex items-center space-x-1">
                        <label className="cursor-pointer min-w-[40px] min-h-[40px] inline-flex items-center justify-center text-slate-500 hover:text-slate-600 rounded-lg border border-slate-200" title="Прикрепить картинку" aria-label="Прикрепить картинку">
                          <ImageIcon className="w-3 h-3" />
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => e.target.files?.[0] && handleMatchingImageUpload('right', idx, e.target.files[0])}
                            className="hidden"
                          />
                        </label>
                        {rightItems.length > 1 && (
                          <IconButton
                            icon={Trash2}
                            label="Удалить элемент правой колонки"
                            onClick={() => {
                              setRightItems(rightItems.filter((_, i) => i !== idx));
                              setLeftItems(leftItems.map(l => ({ ...l, match: l.match == null ? null : l.match === idx ? null : l.match > idx ? l.match - 1 : l.match })));
                            }}
                            className="w-10 h-10 text-slate-500 hover:text-red-600 hover:bg-red-50"
                          />
                        )}
                      </div>
                    </div>

                    {formMode === 'both' ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={item.text_ru ?? item.text ?? ''}
                          onChange={(e) => {
                            const updated = [...rightItems];
                            updated[idx].text_ru = e.target.value;
                            updated[idx].text = e.target.value;
                            setRightItems(updated);
                          }}
                          placeholder={`Элемент ${idx + 1} (RU)`}
                          className="w-full text-sm p-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <input
                          type="text"
                          value={item.text_tg ?? ''}
                          onChange={(e) => {
                            const updated = [...rightItems];
                            updated[idx].text_tg = e.target.value;
                            setRightItems(updated);
                          }}
                          placeholder={`Элементи ${idx + 1} (TJ)`}
                          className="w-full text-sm p-1.5 border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    ) : formMode === 'ru' ? (
                      <input
                        type="text"
                        value={item.text_ru ?? item.text ?? ''}
                        onChange={(e) => {
                          const updated = [...rightItems];
                          updated[idx].text_ru = e.target.value;
                          updated[idx].text = e.target.value;
                          setRightItems(updated);
                        }}
                        placeholder={`Элемент ${idx + 1} (RU)`}
                        className="w-full text-sm p-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    ) : (
                      <input
                        type="text"
                        value={item.text_tg ?? ''}
                        onChange={(e) => {
                          const updated = [...rightItems];
                          updated[idx].text_tg = e.target.value;
                          setRightItems(updated);
                        }}
                        placeholder={`Элементи ${idx + 1} (TJ)`}
                        className="w-full text-sm p-1.5 border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    )}

                    {item.image_url && (
                      <div className="flex items-center space-x-1 pt-1">
                        <img loading="lazy" decoding="async" src={item.image_url} alt="" className="h-10 w-auto object-contain rounded border" />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...rightItems];
                            updated[idx].image_url = null;
                            setRightItems(updated);
                          }}
                          className="text-sm text-red-500 hover:underline min-h-[40px]"
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
  );
};
