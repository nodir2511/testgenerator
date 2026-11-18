// Экспорт ведомости проверенных бланков в Excel (.xlsx).
// Загрузка библиотеки write-excel-file динамическая (Code-splitting).

export interface CheckExportRow {
  id?: string;
  student: string;
  ticket_number?: number | null;
  score: number;
  max_score: number;
  created_at?: string;
}

const gradeFromPct = (pct: number): number => {
  if (pct >= 85) return 5;
  if (pct >= 70) return 4;
  if (pct >= 50) return 3;
  return 2;
};

export async function exportOmrChecksToExcel(checks: CheckExportRow[], title = 'Ведомость_проверки'): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const { saveAs } = await import('file-saver');

  const head = (cols: string[]) => cols.map((c) => ({
    value: c,
    fontWeight: 'bold' as const,
    backgroundColor: '#6C5DD3',
    color: '#FFFFFF',
    align: 'center' as const,
  }));

  const rows = [
    head(['№', 'Ученик', 'Вариант', 'Баллы', 'Максимум', '% выполнения', 'Оценка', 'Дата и время']),
    ...checks.map((c, i) => {
      const pct = c.max_score > 0 ? Math.round((c.score / c.max_score) * 100) : 0;
      const dateStr = c.created_at ? new Date(c.created_at).toLocaleString('ru-RU') : new Date().toLocaleString('ru-RU');
      return [
        { value: i + 1, align: 'center' as const },
        { value: c.student || 'Без имени' },
        { value: c.ticket_number ? `Вариант ${c.ticket_number}` : '—', align: 'center' as const },
        { value: c.score, align: 'right' as const, fontWeight: 'bold' as const },
        { value: c.max_score, align: 'right' as const },
        { value: `${pct}%`, align: 'right' as const },
        { value: gradeFromPct(pct), align: 'center' as const, fontWeight: 'bold' as const },
        { value: dateStr, align: 'center' as const },
      ];
    }),
  ];

  const columns = [
    { width: 6 },
    { width: 32 },
    { width: 14 },
    { width: 10 },
    { width: 12 },
    { width: 14 },
    { width: 10 },
    { width: 22 },
  ];

  const blob = await writeExcelFile([
    { data: rows, sheet: 'Ведомость', columns },
  ] as any).toBlob();

  const safeName = title.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g, '_').slice(0, 50);
  saveAs(blob, `${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
