// Импорт: предпросмотр распознанных строк перед сохранением, проверка на дубли и ошибки (главный админ)
import React from 'react';
import { AlertTriangle, CheckCircle2, Image as ImageIcon } from 'lucide-react';
import type { ParsedRow } from '../../lib/importParse';
import type { RowCheck } from '../../lib/importCheck';
import { CHECK_LABELS } from '../../lib/questionChecks';
import { FormattedText } from '../FormulaEditor';
import { CustomSelect } from '../CustomSelect';
import { Badge, Button } from '../ui';

interface Props {
  parsedRows: ParsedRow[];
  setParsedRows: (rows: ParsedRow[]) => void;
  validRows: ParsedRow[];
  errorRowsCount: number;
  warningRowsCount: number;
  importMutation: { isPending: boolean; mutate: (rows: ParsedRow[]) => void };
  isOwner: boolean;
  runChecks: () => void;
  checking: boolean;
  rowChecks: Record<number, RowCheck> | null;
  flaggedCount: number;
  onlyFlagged: boolean;
  setOnlyFlagged: (v: boolean) => void;
  sectionNames: string[];
  sectionFilter: string;
  setSectionFilter: (v: string) => void;
  visibleRows: ParsedRow[];
  setPreviewImage: (url: string | null) => void;
}

export const PreviewTable: React.FC<Props> = ({ parsedRows, setParsedRows, validRows, errorRowsCount, warningRowsCount, importMutation, isOwner, runChecks, checking, rowChecks, flaggedCount, onlyFlagged, setOnlyFlagged, sectionNames, sectionFilter, setSectionFilter, visibleRows, setPreviewImage }) => (
  <div className="space-y-4 pt-4 border-t border-slate-200 xl:border-t-0 xl:pt-0 min-w-0">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h3 className="font-bold text-slate-900 text-sm">Предварительный просмотр перед сохранением</h3>
        <p className="text-xs text-slate-500">
          Готово к импорту: <span className="font-bold text-emerald-600">{validRows.length}</span> • 
          Ошибок: <span className="font-bold text-red-600">{errorRowsCount}</span>
          {warningRowsCount > 0 && (
            <> • С предупреждениями: <span className="font-bold text-amber-600">{warningRowsCount}</span></>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => setParsedRows([])} className="text-slate-600">Очистить</Button>
        <Button
          variant="primary"
          icon={CheckCircle2}
          loading={importMutation.isPending}
          disabled={validRows.length === 0}
          onClick={() => importMutation.mutate(validRows)}
          className="whitespace-nowrap"
        >
          Импортировать в базу ({validRows.length})
        </Button>
      </div>
    </div>

    {isOwner && (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <Button variant="secondary" onClick={runChecks} loading={checking} className="whitespace-nowrap">
          {rowChecks ? 'Проверить заново' : 'Проверить на дубли и ошибки'}
        </Button>
        {rowChecks && (
          <>
            <span className="text-slate-700">
              {flaggedCount === 0 ? 'Замечаний нет' : <>С замечаниями: <b>{flaggedCount}</b> из {parsedRows.length}</>}
            </span>
            {flaggedCount > 0 && (
              <label className="flex items-center gap-2 cursor-pointer select-none text-slate-800">
                <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} className="w-4 h-4 rounded text-indigo-600" />
                Только с замечаниями
              </label>
            )}
          </>
        )}
      </div>
    )}

    {sectionNames.length > 1 && (
      <div className="flex items-center gap-2 text-xs">
        <label className="font-semibold text-slate-600 shrink-0">Раздел документа:</label>
        <CustomSelect
          value={sectionFilter}
          onChange={(val) => setSectionFilter(val)}
          className="flex-1 min-w-0 text-sm px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Все разделы ({parsedRows.length} вопр.)</option>
          {sectionNames.map(name => (
            <option key={name} value={name}>
              {name} ({parsedRows.filter(r => r.section === name).length})
            </option>
          ))}
        </CustomSelect>
      </div>
    )}

    <div className="max-h-96 xl:max-h-[calc(100vh-18rem)] overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 text-sm">
      {visibleRows.map((r, i) => (
        <div key={i} className={`p-3 ${r.errors.length > 0 ? 'bg-red-50/50' : 'bg-white'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-1">
              <div className="flex items-center space-x-2">
                <span className="font-mono text-slate-500 font-semibold">#{r.rowNum}</span>
                <Badge tone={r.type === 'test' ? 'primary' : r.type === 'matching' ? 'purple' : 'success'} className="px-1.5 font-bold uppercase">
                  {r.type === 'test' ? 'Тест' : r.type === 'matching' ? 'Соответствие' : 'Открытый'}
                </Badge>
                <div className="font-semibold text-slate-800 leading-snug">
                  <FormattedText text={r.content} />
                  {r.lang === 'tg' && r.contentTg === undefined && (
                    <Badge tone="warning" className="ml-2 px-1 font-bold">ТЖ</Badge>
                  )}
                </div>
              </div>
              {r.contentTg && (
                <div className="pl-8 text-slate-600 leading-snug">
                  <Badge tone="warning" className="mr-1.5 px-1 font-bold">ТЖ</Badge>
                  <FormattedText text={r.contentTg} />
                </div>
              )}

              {r.errors.length > 0 ? (
                <div className="mt-1 text-red-600 text-xs flex items-center space-x-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{r.errors.join('; ')}</span>
                </div>
              ) : (
                <div className="mt-1 text-slate-500 text-xs">
                  {r.type === 'test' && r.rawOptions && (
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      {r.rawOptions.map((opt, oIdx) => (
                        <Badge tone="neutral" className="font-normal" key={oIdx}>
                          <strong className="mr-1">{['A', 'B', 'C', 'D', 'E'][oIdx] || String(oIdx + 1)})</strong>
                          <FormattedText text={opt.text} />
                          {opt.textTg && opt.textTg !== opt.text && (
                            <span className="ml-1 text-slate-500">/ <FormattedText text={opt.textTg} /></span>
                          )}
                          {opt.imageUrl && <ImageIcon className="w-3 h-3 text-indigo-500 ml-1 inline" />}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {r.type === 'test' && !r.rawOptions && r.optionsText && (
                    <span>Варианты: {r.optionsText}</span>
                  )}
                  {r.type === 'test' && r.correctAnswer && (
                    <div className="pt-0.5">Ответ: <strong className="text-slate-700">{r.correctAnswer}</strong></div>
                  )}
                  {r.type === 'matching' && r.rawMatchingItems && (
                    <span className="text-purple-700 font-medium">
                      Элементов соответствия: {r.rawMatchingItems.length} (ABCD / 12345)
                    </span>
                  )}
                  {r.type === 'open' && (
                    <span>Ответ: <strong className="text-slate-700">{r.correctAnswer || 'не указан'}</strong></span>
                  )}
                </div>
              )}
              {r.errors.length === 0 && r.warnings && r.warnings.length > 0 && (
                <div className="mt-1 text-amber-700 text-xs flex items-start space-x-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>{r.warnings.join('; ')}</span>
                </div>
              )}
              {rowChecks?.[r.rowNum] && (() => {
                const c = rowChecks[r.rowNum];
                return (
                  <div className="mt-1 space-y-1 text-xs">
                    {c.codes.length > 0 && (
                      <div className="flex flex-wrap gap-1">{c.codes.map((k) => <Badge key={k} tone="warning">{CHECK_LABELS[k]}</Badge>)}</div>
                    )}
                    {c.inFile.map((d) => (
                      <div key={d.rowNum} className={'text-amber-700'}>
                        {d.answerDiffers ? 'Те же варианты, но верный ответ другой, чем в строке' : d.exact ? 'Повторяет строку' : `Похож на ${Math.round(d.score * 100)}% на строку`} #{d.rowNum} этого файла
                      </div>
                    ))}
                    {c.bank.map((d) => (
                      <div key={d.id} className={'text-amber-700'}>
                        {d.answerDiffers ? 'Такой вопрос с теми же вариантами есть в банке, но верный ответ другой — проверьте' : d.exact ? 'Уже есть в банке' : `Похож на ${Math.round(d.score * 100)}% на вопрос из банка`}: «{d.text}» <span className="text-slate-500">({d.where})</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="flex items-center space-x-3 shrink-0">
              {r.imageUrl && (
                <img loading="lazy" decoding="async"
                  src={r.imageUrl}
                  alt="Изображение"
                  onClick={() => setPreviewImage(r.imageUrl || null)}
                  className="w-12 h-12 object-contain rounded-lg border border-slate-200 bg-slate-50 p-0.5 cursor-pointer hover:opacity-90 hover:scale-105 transition shadow-sm"
                  title="Нажмите для просмотра"
                />
              )}
              <div className="text-xs text-slate-500 text-right">
                <div>{r.subjectName}</div>
                <div className="text-xs text-slate-500">{r.chapterName}</div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);
