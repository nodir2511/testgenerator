// Импорт: итог последнего импорта (добавлено, пропущено как дубли, не удалось)
import React from 'react';
import { X } from 'lucide-react';
import type { ImportReport } from '../../lib/importParse';
import { IconButton } from '../ui';

interface Props {
  importReport: ImportReport;
  setImportReport: (r: ImportReport | null) => void;
}

export const ImportReportCard: React.FC<Props> = ({ importReport, setImportReport }) => (
  <div className={`p-4 rounded-xl border text-xs space-y-2 ${importReport.failed.length ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="font-bold text-slate-900">
        Итог импорта: добавлено {importReport.inserted} из {importReport.total}
        {importReport.skipped > 0 && <> • пропущено как дубли: {importReport.skipped}</>}
        {importReport.failed.length > 0 && <> • не удалось: <span className="text-red-600">{importReport.failed.length}</span></>}
      </div>
      <IconButton icon={X} label="Закрыть отчёт" onClick={() => setImportReport(null)} className="w-10 h-10 -m-2 text-slate-500 hover:text-slate-700" />
    </div>
    {importReport.skipped > 0 && (
      <p className="text-slate-600">Дубли — вопросы с тем же текстом и вариантами, которые уже есть в этой теме. Повторный запуск импорта безопасен.</p>
    )}
    {importReport.failed.length > 0 && (
      <ul className="max-h-40 overflow-y-auto space-y-0.5 text-red-700">
        {importReport.failed.map((f, i) => (
          <li key={i}>№ {f.rowNum}: {f.message}</li>
        ))}
      </ul>
    )}
  </div>
);
