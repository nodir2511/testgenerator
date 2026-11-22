import React from 'react';
import { Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { FormulaEditor } from '../FormulaEditor';
import type { FormMode } from './types';

interface QuestionTextFieldsProps {
  formMode: FormMode;
  contentRu: string;
  setContentRu: React.Dispatch<React.SetStateAction<string>>;
  contentTg: string;
  setContentTg: React.Dispatch<React.SetStateAction<string>>;
  imageUrl: string | null;
  setImageUrl: React.Dispatch<React.SetStateAction<string | null>>;
  uploadingImage: boolean;
  handleMainImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// Текст вопроса на двух языках и картинка к вопросу
export const QuestionTextFields: React.FC<QuestionTextFieldsProps> = ({
  formMode,
  contentRu,
  setContentRu,
  contentTg,
  setContentTg,
  imageUrl,
  setImageUrl,
  uploadingImage,
  handleMainImageUpload,
}) => {
  return (
        <div id="qf-text" className="scroll-mt-24 space-y-4">
          {formMode === 'both' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormulaEditor
                label="Текст вопроса (Русский) *"
                value={contentRu}
                onChange={setContentRu}
                placeholder="Например: Укажите формулу серной кислоты или решите уравнение реакции..."
                rows={4}
              />
              <FormulaEditor
                label="Матни савол (Тоҷикӣ)"
                value={contentTg}
                onChange={setContentTg}
                placeholder="Масалан: Формулаи кислотаи сулфатро муайян намоед..."
                rows={4}
              />
            </div>
          ) : formMode === 'ru' ? (
            <FormulaEditor
              label="Текст вопроса (Русский) *"
              value={contentRu}
              onChange={setContentRu}
              placeholder="Например: Укажите формулу серной кислоты или решите уравнение реакции..."
              rows={4}
            />
          ) : (
            <FormulaEditor
              label="Матни савол (Тоҷикӣ) *"
              value={contentTg}
              onChange={setContentTg}
              placeholder="Масалан: Формулаи кислотаи сулфатро муайян намоед..."
              rows={4}
            />
          )}

          {/* Картинка к вопросу + вставка из буфера (Ctrl+V) */}
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex-1 min-w-0 flex items-center space-x-3">
              {imageUrl ? (
                <div className="relative group h-20 w-auto min-w-[80px] max-w-[200px] rounded-lg overflow-hidden border border-slate-300 bg-white shrink-0 p-1">
                  <img loading="lazy" decoding="async" src={imageUrl} alt="Вопрос" className="h-full w-full object-contain" />
                  <button
                    type="button"
                    onClick={() => setImageUrl(null)}
                    className="absolute inset-0 bg-red-600/80 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 flex items-center justify-center transition"
                    title="Удалить картинку"
                    aria-label="Удалить картинку"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="w-12 h-12 rounded-lg bg-slate-200 text-slate-400 flex items-center justify-center shrink-0">
                  <ImageIcon className="w-6 h-6" />
                </div>
              )}
              <div className="text-xs min-w-0 flex-1">
                <span className="font-medium text-slate-700 block">
                  {imageUrl ? 'Изображение прикреплено' : 'Добавить схему, рисунок или формулу'}
                </span>
                <span className="text-slate-500">
                  Можно нажать Ctrl+V для вставки скриншота или загрузить файл (WebP, PNG, JPG)
                </span>
              </div>
            </div>

            <label className="cursor-pointer shrink-0 min-h-[40px] px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg border border-slate-300 flex items-center space-x-1 transition shadow-sm">
              {uploadingImage ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : (
                <Upload className="w-3.5 h-3.5 mr-1" />
              )}
              <span>{imageUrl ? 'Заменить' : 'Загрузить файл'}</span>
              <input
                type="file"
                accept="image/*"
                disabled={uploadingImage}
                onChange={handleMainImageUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>
  );
};
