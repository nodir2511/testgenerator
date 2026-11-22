import { attemptsSheet, type SheetAttempt, type StatTicket } from './examStats';

// Выгрузка попыток запуска в Excel. Библиотеки грузятся только при нажатии (как в src/lib/omr/exportExcel.ts).

export function examExcelName(title: string, date = new Date()): string {
  const safe = title.replace(/[\\/:*?"<>|\[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'набор';
  return `Билеты классу — ${safe} — ${date.toISOString().slice(0, 10)}.xlsx`;
}

export async function exportExamToExcel(title: string, attempts: SheetAttempt[], tickets: StatTicket[]): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const { saveAs } = await import('file-saver');
  const [head, ...body] = attemptsSheet(attempts, tickets);
  const rows = [
    head.map((c) => ({ ...c, fontWeight: 'bold' as const, backgroundColor: '#6C5DD3', color: '#FFFFFF', align: 'center' as const })),
    ...body,
  ];
  const columns = [{ width: 30 }, { width: 22 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 8 }, { width: 12 }];
  const blob = await writeExcelFile([{ data: rows, sheet: 'Попытки', columns }] as any).toBlob();
  saveAs(blob, examExcelName(title));
}
