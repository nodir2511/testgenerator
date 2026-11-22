import React, { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { fetchAttemptsWithAnswers, fetchExamTickets, type ExamLinkRow } from '../../lib/examLinks';
import { exportExamToExcel } from '../../lib/examExport';
import { notifyError } from '../../lib/errors';
import { Button } from '../ui';

/** Выгрузка попыток запуска в Excel: данные читаются заново в момент нажатия */
export const ExamExcelButton: React.FC<{ link: ExamLinkRow }> = ({ link }) => {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const [attempts, tickets] = await Promise.all([fetchAttemptsWithAnswers(link.code), fetchExamTickets(link.batch_id)]);
      await exportExamToExcel(link.batch?.title ?? 'набор', attempts, tickets);
    } catch (e) {
      notifyError(e, 'Не удалось выгрузить в Excel');
    } finally {
      setBusy(false);
    }
  };
  return <Button variant="secondary" size="sm" icon={FileSpreadsheet} loading={busy} onClick={run}>Excel</Button>;
};
