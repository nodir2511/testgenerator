import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Send, Users } from 'lucide-react';
import { fetchAttempts, fetchInviteSources, sendInvites } from '../../lib/examLinks';
import { inviteResultText, inviteSourceLabel } from '../../lib/examView';
import { notifyError, notifyInfo, notifySuccess } from '../../lib/errors';
import { Button, inputClass } from '../ui';

/**
 * Пригласить на этот запуск учеников своего прошлого запуска: бот пришлёт каждому выбранному ссылку личным сообщением.
 * Список свёрнут, пока преподаватель не нажал кнопку (лишних запросов нет).
 */
export const InviteStudents: React.FC<{ code: string }> = ({ code }) => {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const sources = useQuery({
    queryKey: ['exam_invite_sources', code],
    queryFn: () => fetchInviteSources(code),
    enabled: open,
    meta: { action: 'Не удалось загрузить прошлые запуски' },
  });
  const students = useQuery({
    queryKey: ['exam_invite_students', from],
    queryFn: () => fetchAttempts(from),
    enabled: open && !!from,
    meta: { action: 'Не удалось загрузить учеников прошлого запуска' },
  });

  // Первый (самый свежий) прошлый запуск выбран сразу; при смене запуска отмечены все его ученики
  useEffect(() => { if (!from && sources.data?.length) setFrom(sources.data[0].code); }, [from, sources.data]);
  useEffect(() => { setPicked(new Set((students.data ?? []).map((a) => a.id))); }, [students.data]);

  const send = useMutation({
    mutationFn: () => sendInvites(code, from, [...picked]),
    onSuccess: (r) => (r.failed > 0 ? notifyInfo : notifySuccess)(inviteResultText(r.sent, r.failed)),
    onError: (e) => notifyError(e, 'Не удалось отправить приглашения'),
  });

  if (!open) {
    return <Button variant="secondary" size="sm" icon={Users} onClick={() => setOpen(true)}>Пригласить учеников прошлого запуска</Button>;
  }

  const list = students.data ?? [];
  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2 w-full">
      <div className="text-sm font-semibold text-slate-900">Пригласить учеников прошлого запуска</div>
      {sources.isLoading ? (
        <div className="flex items-center text-sm text-slate-500"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Загружаю…</div>
      ) : !sources.data?.length ? (
        <p className="text-sm text-slate-500">Прошлых запусков с учениками пока нет.</p>
      ) : (
        <>
          <select aria-label="Прошлый запуск" className={`${inputClass} min-h-[40px] py-1.5 w-full`} value={from} onChange={(e) => setFrom(e.target.value)}>
            {sources.data.map((s) => <option key={s.code} value={s.code}>{inviteSourceLabel(s)}</option>)}
          </select>
          {students.isLoading ? (
            <div className="flex items-center text-sm text-slate-500"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Загружаю учеников…</div>
          ) : list.length === 0 ? (
            <p className="text-sm text-slate-500">В этом запуске учеников не было.</p>
          ) : (
            <>
              <div className="flex items-center gap-3 text-xs">
                <button type="button" className="text-indigo-700 font-semibold min-h-[32px]" onClick={() => setPicked(new Set(list.map((a) => a.id)))}>Выбрать всех</button>
                <button type="button" className="text-indigo-700 font-semibold min-h-[32px]" onClick={() => setPicked(new Set())}>Снять всех</button>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-0.5">
                {list.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm text-slate-800 min-h-[36px] px-1 rounded-lg hover:bg-slate-50">
                    <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                    <span className="font-medium">{a.student_name}</span>
                    <span className="text-slate-500 truncate">{a.tg_username ? `@${a.tg_username}` : (a.tg_name ?? '')}</span>
                  </label>
                ))}
              </div>
              <Button variant="primary" size="sm" icon={Send} loading={send.isPending} disabled={picked.size === 0} onClick={() => send.mutate()}>
                Отправить ссылку в Telegram: {picked.size}
              </Button>
              <p className="text-xs text-slate-500">Бот напишет каждому выбранному ученику лично. Сообщение не дойдёт тому, кто остановил бота.</p>
            </>
          )}
        </>
      )}
    </div>
  );
};
