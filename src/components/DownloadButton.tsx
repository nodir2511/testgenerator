import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, Download, Loader2 } from 'lucide-react';

export type Lang = 'ru' | 'tg' | 'both';
export const LANG_LABEL: Record<Lang, string> = { ru: 'Русский', tg: 'Тоҷикӣ', both: 'RU + TJ' };

// Язык скачивания общий для генератора и архива: сайт запоминает последний выбранный
const LANG_KEY = 'examiner_tg_export_lang';
const readLang = (): Lang => {
  const v = localStorage.getItem(LANG_KEY);
  return v === 'tg' || v === 'both' ? v : 'ru';
};
export function useExportLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>(readLang);
  const set = (l: Lang) => {
    setLang(l);
    localStorage.setItem(LANG_KEY, l);
  };
  return [lang, set];
}

// Одна главная кнопка «Скачать · язык»; стрелка открывает выбор другого языка
export const DownloadButton: React.FC<{
  lang: Lang;
  busy: boolean;
  onDownload: (lang: Lang) => void;
  size?: 'lg' | 'md';
}> = ({ lang, busy, onDownload, size = 'lg' }) => {
  const [open, setOpen] = useState(false);
  const h = size === 'lg' ? 'min-h-[52px] text-base' : 'min-h-[44px] text-sm';
  const pick = (l: Lang) => {
    setOpen(false);
    onDownload(l);
  };
  return (
    <div className="relative">
      <div className="flex">
        <button
          onClick={() => pick(lang)}
          disabled={busy}
          className={`flex-1 ${h} px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-l-xl font-bold flex items-center justify-center gap-2 transition active:scale-[0.99] disabled:opacity-70`}
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          <span>{busy ? 'Готовим файл…' : `Скачать · ${LANG_LABEL[lang]}`}</span>
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          className={`w-12 ${h} bg-indigo-600 hover:bg-indigo-700 text-white rounded-r-xl border-l border-indigo-400/60 flex items-center justify-center transition disabled:opacity-70`}
          aria-label="Выбрать язык"
          aria-expanded={open}
        >
          <ChevronDown className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div className="mt-2 bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden">
          <div className="px-4 pt-3 pb-1 text-xs font-semibold text-slate-600">Язык билетов</div>
          {(Object.keys(LANG_LABEL) as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => pick(l)}
              className={`w-full min-h-[48px] px-4 text-left text-base flex items-center justify-between hover:bg-indigo-50 ${l === lang ? 'font-bold text-indigo-700' : 'text-slate-800'}`}
            >
              <span>{l === 'both' ? 'Русский + Тоҷикӣ' : LANG_LABEL[l]}</span>
              {l === lang && <CheckCircle2 className="w-5 h-5 text-indigo-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
