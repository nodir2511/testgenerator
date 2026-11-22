// Импорт: вкладка «Файл» — один файл (Word, Excel, CSV) или пара файлов «русский + таджикский»
import React from 'react';
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import type { ImportLang } from '../../lib/importParse';
import { CustomSelect } from '../CustomSelect';
import { Button, Field } from '../ui';

interface Props {
  pairMode: boolean;
  setPairMode: (v: boolean) => void;
  fileLang: ImportLang;
  setFileLang: (v: ImportLang) => void;
  pairRu: File | null;
  setPairRu: (f: File | null) => void;
  pairTg: File | null;
  setPairTg: (f: File | null) => void;
  isProcessing: boolean;
  statusMessage: string | null;
  handleParsePair: () => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const FileTab: React.FC<Props> = ({ pairMode, setPairMode, fileLang, setFileLang, pairRu, setPairRu, pairTg, setPairTg, isProcessing, statusMessage, handleParsePair, handleFileUpload }) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
        <button
          type="button"
          onClick={() => setPairMode(false)}
          className={`px-3 py-1.5 font-semibold ${!pairMode ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'} min-h-[40px]`}
        >
          Один файл
        </button>
        <button
          type="button"
          onClick={() => setPairMode(true)}
          className={`px-3 py-1.5 font-semibold border-l border-slate-300 ${pairMode ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'} min-h-[40px]`}
        >
          Пара файлов: русский + таджикский
        </button>
      </div>
      {!pairMode && (
        <div className="flex items-center gap-2 text-slate-600">
          <span className="font-semibold">Язык файла:</span>
          <CustomSelect
            value={fileLang}
            onChange={(val) => setFileLang(val as ImportLang)}
            className="text-sm px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ru">Русский</option>
            <option value="tg">Таджикский</option>
          </CustomSelect>
        </div>
      )}
    </div>

    {pairMode ? (
      <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5 space-y-4">
        <p className="text-xs text-slate-600">
          Загрузите два варианта одного документа Word. Вопросы сопоставляются по разделу (§) и номеру,
          варианты ответов — по ключу ответов и по формулам/числам (порядок вариантов в файлах разный).
          Получатся двуязычные вопросы; несовпадения будут показаны в предпросмотре.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([['Русский файл (.docx)', pairRu, setPairRu], ['Таджикский файл (.docx)', pairTg, setPairTg]] as const).map(([label, file, setFile]) => (
            <Field key={label} label={label} hint={file ? <span className="block truncate">{file.name}</span> : undefined}>
              <input
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                disabled={isProcessing}
                className="block w-full text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-indigo-600 file:text-white file:font-semibold"
              />
            </Field>
          ))}
        </div>
        <Button variant="primary" onClick={handleParsePair} disabled={!pairRu || !pairTg || isProcessing}>
          {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>Распознать пару и сопоставить</span>
        </Button>
        {isProcessing && statusMessage && <p className="text-xs text-indigo-600 font-medium">{statusMessage}</p>}
      </div>
    ) : (
  <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center bg-slate-50 hover:bg-slate-100/60 transition cursor-pointer relative">
    <input
      type="file"
      accept=".docx, .xlsx, .xls, .csv, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
      onChange={handleFileUpload}
      disabled={isProcessing}
      aria-label="Файл с вопросами: Word, Excel или CSV"
      className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
    />
    {isProcessing ? (
      <div className="space-y-2 py-4">
        <Loader2 className="w-10 h-10 text-indigo-600 mx-auto animate-spin" />
        <p className="font-bold text-slate-800 text-sm">Обработка документа...</p>
        {statusMessage && <p className="text-xs text-indigo-600 font-medium">{statusMessage}</p>}
      </div>
    ) : (
      <>
        <div className="flex items-center justify-center space-x-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
            <FileText className="w-6 h-6" />
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
        </div>
        <p className="font-bold text-slate-800 text-sm">
          Нажмите для выбора файла Word (.docx), Excel или CSV
        </p>
        <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
          Картинки из файлов Word (.docx) извлекаются, сжимаются и прикрепляются к вопросам автоматически!
        </p>
      </>
    )}
  </div>
    )}
  </div>
);
