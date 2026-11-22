import React from 'react';
import { CheckCircle2, Loader2, Download, ChevronDown, Share2, X } from 'lucide-react';
import { buildTicketsFile, keyArchiveExtras } from '../../lib/exportLazy';
import { isEnglishName, plural } from '../../lib/generatorHelpers';
import { SendToTelegramButton } from '../SendToTelegramButton';
import { DownloadButton, type Lang } from '../DownloadButton';
import { Button } from '../ui';
import { BatchTopicsBar, BatchVariants } from '../BatchEditor';

interface GeneratedBatchPanelProps {
  resultRef: React.RefObject<HTMLDivElement | null>;
  /** набор с билетами — как пришёл из базы (save_ticket_batch) */
  generatedBatch: any;
  setGeneratedBatch: React.Dispatch<React.SetStateAction<any | null>>;
  generatedSubjectName: string;
  generatedHasKey: boolean;
  handleBatchChanged: (params: any, tickets: any[]) => Promise<void>;
  selectionOf: () => { subjectId: any; params: any };
  exportLang: Lang;
  isDownloading: boolean;
  handleDownload: (lang: Lang) => Promise<void>;
  canShare: boolean;
  isSharing: boolean;
  handleShareTickets: () => Promise<void>;
  handleExportKey: () => Promise<void>;
  showVariants: boolean;
  setShowVariants: React.Dispatch<React.SetStateAction<boolean>>;
  exportSingleWithKey: (t: any, lang: 'ru' | 'tg') => Promise<void>;
}

// Результат генерации: скачивание, отправка, правка тем и просмотр вариантов. Состояние и обработчики — в TicketGenerator
export const GeneratedBatchPanel: React.FC<GeneratedBatchPanelProps> = ({
  resultRef, generatedBatch, setGeneratedBatch, generatedSubjectName, generatedHasKey, handleBatchChanged, selectionOf, exportLang, isDownloading,
  handleDownload, canShare, isSharing, handleShareTickets, handleExportKey, showVariants, setShowVariants, exportSingleWithKey,
}) => (
  <div ref={resultRef} className="scroll-mt-24 bento-card rounded-2xl p-4 sm:p-5 border-emerald-200 space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" />
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900 text-base leading-tight">
            Готово: {generatedBatch.tickets.length} {plural(generatedBatch.tickets.length, 'вариант', 'варианта', 'вариантов')}
            {generatedBatch.tickets[0] ? ` по ${generatedBatch.tickets[0].questions.length} вопр.` : ''}
          </h3>
          <p className="text-sm text-slate-600 mt-0.5 truncate">
            {generatedSubjectName}{generatedBatch.title ? ` · ${generatedBatch.title}` : ''}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Копия сохранена в архиве билетов</p>
        </div>
      </div>
      <button
        onClick={() => setGeneratedBatch(null)}
        className="w-10 h-10 -mr-2 -mt-2 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center shrink-0"
        aria-label="Закрыть результат"
      >
        <X className="w-5 h-5" />
      </button>
    </div>

    {/* Темы набора: можно убрать тему — её вопросы заменятся вопросами других тем поровну */}
    <BatchTopicsBar batch={generatedBatch} onChanged={handleBatchChanged} />

    {/* Главное действие: скачать на запомненном языке; стрелка — выбрать другой язык */}
    <div className="sm:max-w-md sm:mx-auto">
      <DownloadButton lang={exportLang} busy={isDownloading} onDownload={handleDownload} singleLang={isEnglishName(generatedSubjectName)} />
      <p className="text-xs text-slate-500 mt-2 text-center">
        {generatedHasKey ? 'В архиве: билеты + ключи ответов' : 'Билеты в формате Word'}
      </p>
    </div>

    {/* Второстепенные действия */}
    <div className="flex flex-wrap items-center gap-2">
      <SendToTelegramButton
        title={generatedBatch.title}
        batchId={generatedBatch.id}
        ticketCount={generatedBatch.tickets.length}
        singleLang={isEnglishName(generatedSubjectName)}
        build={async (lang) => buildTicketsFile(
          generatedBatch.title,
          generatedBatch.tickets,
          generatedSubjectName || 'Экзамен',
          lang,
          await keyArchiveExtras(generatedBatch.title, generatedBatch.tickets, generatedSubjectName, selectionOf(), lang)
        )}
      />
      {canShare && (
        <Button variant="secondary" className="bg-white" onClick={handleShareTickets} disabled={isSharing}>
          {isSharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
          <span>Поделиться</span>
        </Button>
      )}
      {generatedHasKey && (
        <button
          onClick={handleExportKey}
          className="min-h-[40px] px-2 text-sm font-semibold text-slate-600 hover:text-indigo-700 underline-offset-2 hover:underline"
        >
          Только ключи
        </button>
      )}
    </div>

    {/* Просмотр вариантов — по запросу, чтобы не растягивать экран */}
    <div className="border-t border-slate-100 pt-2">
      <button
        onClick={() => setShowVariants((v) => !v)}
        className="w-full min-h-[44px] flex items-center justify-between text-sm font-semibold text-slate-700"
      >
        <span>Посмотреть варианты</span>
        <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${showVariants ? 'rotate-180' : ''}`} />
      </button>
      {showVariants && (
        <div className="mt-2">
          <BatchVariants
            batch={{ ...generatedBatch, subjectName: generatedSubjectName }}
            onChanged={handleBatchChanged}
            renderActions={(t) => (
              <div className="flex items-center gap-1.5 shrink-0">
                {(isEnglishName(generatedSubjectName) ? ['ru' as const] : exportLang === 'both' ? (['ru', 'tg'] as const) : [exportLang]).map((l) => (
                  <button
                    key={l}
                    onClick={() => exportSingleWithKey(t, l)}
                    className="min-h-[36px] px-2.5 text-sm bg-white hover:bg-indigo-50 text-indigo-700 font-semibold rounded-lg border border-indigo-200/70 flex items-center gap-1 transition active:scale-95"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isEnglishName(generatedSubjectName) ? 'Word' : l === 'tg' ? 'TJ' : 'RU'}
                  </button>
                ))}
              </div>
            )}
          />
        </div>
      )}
    </div>
  </div>
);
