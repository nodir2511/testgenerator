import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Loader2, Lock } from 'lucide-react';
import { ExamExcelButton } from './ExamExcelButton';
import { QuestionStats } from './QuestionStats';
import { callExamTeacher, NotLinkedError, closeExamLink, EXAM_LINKS_KEY, examAttemptsKey, examAttemptsFullKey, fetchAttempts, type ExamLinkRow } from '../../lib/examLinks';
import { linkState, mapAttemptRow } from '../../lib/examView';
import { confirmAction } from '../../lib/confirm';
import { notifyError, notifyInfo, notifySuccess } from '../../lib/errors';
import { Button } from '../ui';

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');

/** Таблица попыток одного запуска; пока запуск открыт, обновляется каждые 5 секунд */
export const ExamBoard: React.FC<{ link: ExamLinkRow }> = ({ link }) => {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [showStats, setShowStats] = useState(false);
  // Остаток времени у идущих пересчитывается без запроса к базе
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const open = linkState(link, now) === 'open';
  const { data, isLoading } = useQuery({
    queryKey: examAttemptsKey(link.code),
    queryFn: () => fetchAttempts(link.code),
    refetchInterval: open ? 5000 : false,
    meta: { action: 'Не удалось загрузить попытки учеников' },
  });
  useEffect(() => { setNow(Date.now()); }, [data]);

  const rows = (data ?? []).map((a) => mapAttemptRow(a, now, link.closed_at ?? link.closes_at));

  const close = useMutation({
    mutationFn: async () => {
      await closeExamLink(link.code);
      // Итог в Telegram — приятное дополнение: если не вышло, запуск всё равно закрыт
      try {
        await callExamTeacher('notify_closed', link.code);
      } catch (e) {
        // Telegram не привязан: итог слать некуда, это не ошибка закрытия
        if (e instanceof NotLinkedError) return;
        notifyInfo(`Запуск закрыт, но итог в Telegram не отправлен: ${(e as Error).message}`);
      }
    },
    onSuccess: () => {
      notifySuccess('Запуск закрыт');
      queryClient.invalidateQueries({ queryKey: EXAM_LINKS_KEY });
      queryClient.invalidateQueries({ queryKey: examAttemptsKey(link.code) });
      queryClient.invalidateQueries({ queryKey: examAttemptsFullKey(link.code) });
    },
    onError: (e) => notifyError(e, 'Не удалось закрыть запуск'),
  });

  const onClose = async () => {
    if (!(await confirmAction({
      title: 'Закрыть запуск?',
      message: 'Новые ученики больше не смогут начать билет, а работы тех, кто не успел сдать, будут засчитаны по сохранённым ответам. Если Telegram привязан, итог придёт вам туда.',
      confirmLabel: 'Закрыть запуск',
      cancelLabel: 'Оставить открытым',
      tone: 'danger',
    }))) return;
    close.mutate();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{open ? 'Таблица обновляется сама.' : 'Запуск закрыт.'}</p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={BarChart3} onClick={() => setShowStats((v) => !v)}>{showStats ? 'Скрыть разбор' : 'Разбор по вопросам'}</Button>
          <ExamExcelButton link={link} />
          {open && <Button variant="danger-soft" size="sm" icon={Lock} loading={close.isPending} onClick={onClose}>Закрыть</Button>}
        </div>
      </div>
      {showStats && <QuestionStats code={link.code} batchId={link.batch_id} />}

      {isLoading ? (
        <div className="flex items-center text-sm text-slate-500 py-4"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Загружаю…</div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500 py-4">Пока никто не начал. Ученики появятся здесь, как только откроют ссылку и нажмут «Начать билет».</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-2 py-2 font-semibold">Имя</th>
                <th className="px-2 py-2 font-semibold">Аккаунт</th>
                <th className="px-2 py-2 font-semibold">Вариант</th>
                <th className="px-2 py-2 font-semibold">Баллы</th>
                <th className="px-2 py-2 font-semibold">Сдал</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-2 py-2.5 font-semibold text-slate-900">{r.name}</td>
                  <td className="px-2 py-2.5 text-slate-600">{r.account}</td>
                  <td className="px-2 py-2.5 text-slate-700">{r.variant}</td>
                  {r.status === 'finished' ? (
                    <>
                      <td className="px-2 py-2.5 font-semibold text-slate-900 whitespace-nowrap">{r.score}</td>
                      <td className="px-2 py-2.5 text-slate-600 whitespace-nowrap">{fmtTime(r.finishedAt)}</td>
                    </>
                  ) : (
                    <td colSpan={2} className={r.status === 'running' ? 'px-2 py-2.5 text-indigo-700' : 'px-2 py-2.5 text-amber-700'}>{r.note}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
