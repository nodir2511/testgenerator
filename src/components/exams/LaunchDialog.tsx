import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Check, Copy, Loader2, Search, Send, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useDialog } from '../../hooks/useDialog';
import { notifyError, notifySuccess } from '../../lib/errors';
import { callExamTeacher, createExamLink, examUrl, EXAM_LINKS_KEY, type ExamLink } from '../../lib/examLinks';
import { canLaunchBatch, canLaunchByUser, needsRelaunchConfirm, RELAUNCH_WARNING } from '../../lib/examView';
import { confirmAction } from '../../lib/confirm';
import { cn } from '../../lib/cn';
import { Button } from '../ui';

interface BatchOption { id: string; created_by: string | null; title: string; created_at: string; generation_params: any; subject: { name: string } | null }

const SELECT = 'id, created_by, title, created_at, generation_params, subject:subjects(name)';

const batchLabel = (b: BatchOption) => `${b.subject?.name ? `${b.subject.name} · ` : ''}${b.title}`;

/** Окно запуска: выбор своего набора → ссылка, QR и отправка себе в Telegram */
export const LaunchDialog: React.FC<{ initialBatchId?: string | null; onClose: () => void; onCreated?: (link: ExamLink) => void }> = ({ initialBatchId, onClose, onCreated }) => {
  const { user, isOwner } = useAuth();
  const queryClient = useQueryClient();
  const panel = useRef<HTMLDivElement>(null);
  useDialog(panel, onClose, true);

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialBatchId ?? null);
  const [link, setLink] = useState<ExamLink | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const launching = useRef(false);

  // Свои последние наборы, кроме кластерных; поиск по названию
  const options = useQuery({
    queryKey: ['exam_batch_options', user?.id, search],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      let q = supabase.from('ticket_batches').select(SELECT).eq('created_by', user!.id).order('created_at', { ascending: false }).limit(60);
      if (search.trim()) q = q.ilike('title', `%${search.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as unknown as BatchOption[]).filter(canLaunchBatch);
    },
    meta: { action: 'Не удалось загрузить ваши наборы билетов' },
  });

  // Набор, пришедший по ссылке #exams/<id>, может не попасть в последние — читаем его отдельно
  const preselected = useQuery({
    queryKey: ['exam_batch', initialBatchId],
    enabled: Boolean(initialBatchId),
    queryFn: async () => {
      const { data, error } = await supabase.from('ticket_batches').select(SELECT).eq('id', initialBatchId!).maybeSingle();
      if (error) throw error;
      return (data as unknown as BatchOption | null) ?? null;
    },
    meta: { action: 'Не удалось загрузить набор билетов' },
  });
  const pre = preselected.data && canLaunchByUser(preselected.data, user?.id, isOwner) ? preselected.data : null;
  const list = options.data ?? [];
  const shown = pre && !search.trim() && !list.some((b) => b.id === pre.id) ? [pre, ...list] : list;
  const selected = shown.find((b) => b.id === selectedId) ?? (selectedId === pre?.id ? pre : null);

  const { data: tgLinked, isLoading: tgLoading } = useQuery({
    queryKey: ['telegram_link', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data } = await supabase.from('telegram_links').select('chat_id').eq('user_id', user!.id).maybeSingle();
      return Boolean(data);
    },
  });

  const create = useMutation({
    mutationFn: () => createExamLink(selectedId!),
    meta: { action: 'Не удалось запустить набор классу' },
    onSuccess: (l) => {
      setLink(l);
      queryClient.invalidateQueries({ queryKey: EXAM_LINKS_KEY });
      onCreated?.(l);
    },
  });

  // Ответы набора уже у другого класса (разбор разослан): без отдельного подтверждения новый запуск не создаём
  const onLaunch = async () => {
    if (!selectedId || launching.current || create.isPending) return;
    launching.current = true;
    try {
      let sent: Array<{ batch_id: string; review_sent_at: string | null }> = [];
      try {
        const { data } = await supabase.from('exam_links').select('batch_id, review_sent_at').eq('batch_id', selectedId).not('review_sent_at', 'is', null).limit(1);
        sent = (data ?? []) as typeof sent;
      } catch { /* предупреждение — дополнение: без него запуск не блокируем */ }
      if (needsRelaunchConfirm(sent, selectedId)) {
        const ok = await confirmAction({ title: 'Набор уже разбирали с другим классом', message: RELAUNCH_WARNING, confirmLabel: 'Запустить всё равно', cancelLabel: 'Отмена', tone: 'danger' });
        if (!ok) return;
      }
      create.mutate();
    } finally {
      launching.current = false;
    }
  };

  const url = link ? examUrl(link.code) : '';
  useEffect(() => {
    if (!url) { setQr(null); return; }
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 280 }).then((d) => { if (live) setQr(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [url]);

  const send = useMutation({
    mutationFn: () => callExamTeacher('link_send', link!.code),
    onSuccess: () => notifySuccess('Ссылка отправлена вам в Telegram'),
    onError: (e) => notifyError(e, 'Не удалось отправить ссылку в Telegram'),
  });

  const copy = () => {
    const text = url || link?.code || '';
    if (!navigator.clipboard?.writeText) { notifyError(new Error('Копирование недоступно в этом браузере'), 'Не удалось скопировать ссылку'); return; }
    navigator.clipboard.writeText(text).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      (e) => notifyError(e, 'Не удалось скопировать ссылку'),
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Запустить билеты классу"
        className="bg-white rounded-t-3xl sm:rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto -mt-1 sm:hidden" />
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg text-slate-900">{link ? 'Билеты запущены' : 'Запустить классу'}</h3>
          <button onClick={onClose} className="w-10 h-10 -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100" aria-label="Закрыть"><X className="w-5 h-5" /></button>
        </div>

        {!link ? (
          <>
            <p className="text-sm text-slate-600">Выберите свой набор билетов. Каждый ученик получит свой билет из набора и пройдёт его в Telegram.</p>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию набора"
                aria-label="Поиск по названию набора"
                className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div role="radiogroup" aria-label="Набор билетов" className="max-h-72 overflow-y-auto space-y-1.5">
              {options.isLoading && <div className="flex items-center text-sm text-slate-500 py-3"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Загружаю наборы…</div>}
              {!options.isLoading && shown.length === 0 && (
                <p className="text-sm text-slate-500 py-3">{search.trim() ? 'Ничего не найдено.' : 'У вас пока нет наборов билетов. Создайте их в «Генераторе билетов».'}</p>
              )}
              {shown.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={b.id === selectedId}
                  onClick={() => setSelectedId(b.id)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 rounded-xl border min-h-[44px] transition',
                    b.id === selectedId ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50',
                  )}
                >
                  <div className="text-sm font-semibold text-slate-900 truncate">{b.title}</div>
                  <div className="text-xs text-slate-500">
                    {b.subject?.name ? `${b.subject.name} · ` : ''}{new Date(b.created_at).toLocaleDateString('ru-RU')}
                  </div>
                </button>
              ))}
            </div>
            {initialBatchId && !preselected.isLoading && !pre && !selected && (
              <p className="text-xs text-amber-700">Этот набор нельзя запустить: он не найден, это экзамен-кластер или создан не вами. Выберите свой набор из списка.</p>
            )}
            <Button variant="primary" size="lg" className="w-full" disabled={!selected} loading={create.isPending} onClick={() => void onLaunch()}>
              Запустить{selected ? `: ${batchLabel(selected)}` : ''}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Отправьте ученикам ссылку или покажите QR-код. Ссылка действует 24 часа, на билет даётся {link.duration_min} минут, попытка одна.
            </p>
            {url ? (
              <div className="flex flex-col items-center gap-3">
                {qr && <img src={qr} alt="QR-код ссылки на билет" width={200} height={200} className="rounded-xl border border-slate-200" />}
                <code className="w-full break-all bg-slate-100 rounded-lg px-3 py-2 text-sm font-mono text-center">{url}</code>
              </div>
            ) : null}
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="secondary" className="flex-1" icon={copied ? Check : Copy} onClick={copy}>{copied ? 'Скопировано' : url ? 'Копировать' : 'Копировать код'}</Button>
              <Button
                variant="primary"
                className="flex-1"
                icon={Send}
                loading={send.isPending}
                disabled={!tgLinked || tgLoading}
                onClick={() => send.mutate()}
              >
                Отправить мне в Telegram
              </Button>
            </div>
            {!tgLoading && !tgLinked && (
              <p className="text-xs text-slate-500">Telegram не привязан к вашему аккаунту. Привяжите его кнопкой с самолётиком в шапке сайта, и ссылку можно будет отправлять себе.</p>
            )}
            <Button variant="ghost" className="w-full" onClick={onClose}>Готово</Button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};
