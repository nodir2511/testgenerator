import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { examAttemptsFullKey, examTicketsKey, fetchAttemptsWithAnswers, fetchExamTickets } from '../../lib/examLinks';
import { questionStats } from '../../lib/examStats';

const barColor = (pct: number) => (pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-500');

/** Разбор по вопросам: от самых проваленных; считаются только сданные работы */
export const QuestionStats: React.FC<{ code: string; batchId: string }> = ({ code, batchId }) => {
  const tickets = useQuery({
    queryKey: examTicketsKey(batchId),
    queryFn: () => fetchExamTickets(batchId),
    staleTime: 60_000,
    meta: { action: 'Не удалось загрузить билеты набора' },
  });
  const attempts = useQuery({
    queryKey: examAttemptsFullKey(code),
    queryFn: () => fetchAttemptsWithAnswers(code),
    meta: { action: 'Не удалось загрузить ответы учеников' },
  });
  const stats = useMemo(() => questionStats(tickets.data ?? [], attempts.data ?? []), [tickets.data, attempts.data]);

  if (tickets.isLoading || attempts.isLoading) {
    return <div className="flex items-center text-sm text-slate-500 py-3"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Считаю…</div>;
  }
  if (stats.length === 0) {
    return <p className="text-sm text-slate-500 py-3">Разбор появится, когда хотя бы один ученик сдаст билет.</p>;
  }
  return (
    <ol className="space-y-3 py-2">
      {stats.map((s, i) => {
        const pct = Math.round(s.avgShare * 100);
        return (
          <li key={s.questionId ?? `${i}-${s.label}`} className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm text-slate-900 break-words">{s.label}</p>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={`Верно ${pct} %`}>
                <div className={`h-full ${barColor(pct)}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">верно {pct} %</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              ответили верно {s.correct} из {s.total}
              {s.wrongTop && <> · чаще всего выбирали неверное «{s.wrongTop.text}» ({s.wrongTop.count})</>}
            </p>
          </li>
        );
      })}
    </ol>
  );
};
