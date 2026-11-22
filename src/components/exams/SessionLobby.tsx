import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
import { EXAM_LINKS_KEY, examAttemptsKey, examTicketNumbersKey, fetchAttempts, fetchExamTicketNumbers, setAttemptVariant, startSession, type ExamLinkRow } from '../../lib/examLinks';
import { canStartSession, langName, startedMinutesNotice } from '../../lib/examView';
import { EXAM_MAX_MINUTES, EXAM_MIN_MINUTES, EXAM_POLL_MS } from '../../../supabase/functions/_shared/exam';
import { confirmAction } from '../../lib/confirm';
import { notifyError, notifyInfo } from '../../lib/errors';
import { Button, inputClass } from '../ui';

const DEFAULT_MINUTES = 30;
const MINUTE_OPTIONS = Array.from({ length: (EXAM_MAX_MINUTES - EXAM_MIN_MINUTES) / 5 + 1 }, (_, i) => EXAM_MIN_MINUTES + i * 5);

const studentsWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'ученика' : 'учеников');

/** Зал ожидания для преподавателя: кто пришёл, вариант каждого (можно сменить), время и «Начать». Пока старта нет, список обновляется каждые 3 секунды */
export const SessionLobby: React.FC<{ link: ExamLinkRow }> = ({ link }) => {
  const queryClient = useQueryClient();
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);

  const { data, isLoading } = useQuery({
    queryKey: examAttemptsKey(link.code),
    queryFn: () => fetchAttempts(link.code),
    refetchInterval: EXAM_POLL_MS,
    meta: { action: 'Не удалось загрузить список учеников' },
  });
  const { data: tickets } = useQuery({
    queryKey: examTicketNumbersKey(link.batch_id),
    queryFn: () => fetchExamTicketNumbers(link.batch_id),
    meta: { action: 'Не удалось загрузить билеты набора' },
  });
  const attempts = data ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: examAttemptsKey(link.code) });
  };

  const change = useMutation({
    mutationFn: (v: { attemptId: string; ticketId: string }) => setAttemptVariant(v.attemptId, v.ticketId),
    onSuccess: refresh,
    onError: (e) => { notifyError(e, 'Не удалось сменить вариант'); refresh(); },
  });

  const start = useMutation({
    mutationFn: () => startSession(link.code, minutes),
    onSuccess: (started) => {
      // Сессию уже запустили раньше (другая вкладка, двойное нажатие) — время прежнее
      const notice = startedMinutesNotice(minutes, started?.duration_min);
      if (notice) notifyInfo(notice);
      queryClient.invalidateQueries({ queryKey: EXAM_LINKS_KEY });
      refresh();
    },
    onError: (e) => notifyError(e, 'Не удалось начать'),
  });

  // Двойной щелчок не должен открыть два окна подтверждения
  const busy = useRef(false);
  const onStart = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!(await confirmAction({
        title: `Начать для ${attempts.length} ${studentsWord(attempts.length)}?`,
        message: `Время: ${minutes} минут. Через несколько секунд у учеников пойдёт отсчёт 3-2-1. Начать?`,
        confirmLabel: 'Начать',
        cancelLabel: 'Отмена',
      }))) return;
      start.mutate();
    } finally { busy.current = false; }
  };

  const canStart = canStartSession(link, attempts.length, Date.now());

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Пришло: <span className="font-semibold text-slate-900">{attempts.length}</span>. Список обновляется сам; опоздавшие смогут зайти и после начала.</p>

      {isLoading ? (
        <div className="flex items-center text-sm text-slate-500 py-4"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Загружаю…</div>
      ) : attempts.length === 0 ? (
        <p className="text-sm text-slate-500 py-4">Пока никого нет. Ученики появятся здесь, как только откроют ссылку и введут имя.</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-2 py-2 font-semibold">Имя</th>
                <th className="px-2 py-2 font-semibold">Аккаунт</th>
                <th className="px-2 py-2 font-semibold">Язык</th>
                <th className="px-2 py-2 font-semibold">Вариант</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-2 py-2.5 font-semibold text-slate-900">{a.student_name}</td>
                  <td className="px-2 py-2.5 text-slate-600">{a.tg_username ? `@${a.tg_username}` : (a.tg_name ?? '')}</td>
                  <td className="px-2 py-2.5 text-slate-600">{langName(a.lang)}</td>
                  <td className="px-2 py-2.5">
                    <select
                      aria-label={`Вариант: ${a.student_name}`}
                      className={`${inputClass} min-h-[40px] py-1.5 w-24`}
                      value={a.ticket_id ?? ''}
                      disabled={!tickets || change.isPending}
                      onChange={(e) => change.mutate({ attemptId: a.id, ticketId: e.target.value })}
                    >
                      {/* Пока билеты не загрузились или билета нет в списке — показываем текущий номер */}
                      {!(tickets ?? []).some((t) => t.id === a.ticket_id) && <option value={a.ticket_id ?? ''}>{a.ticket?.ticket_number ?? '—'}</option>}
                      {(tickets ?? []).map((t) => <option key={t.id} value={t.id}>{t.ticket_number}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Время
          <select className={`${inputClass} min-h-[40px] py-1.5 w-28`} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{m} мин</option>)}
          </select>
        </label>
        <Button size="sm" icon={Play} loading={start.isPending} disabled={!canStart} onClick={onStart} title={canStart ? undefined : 'Начать можно, когда придёт хотя бы один ученик'}>
          Начать для {attempts.length} {studentsWord(attempts.length)}
        </Button>
      </div>
    </div>
  );
};
