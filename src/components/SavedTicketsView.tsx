import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { assertRowsChanged, notifyError } from '../lib/errors';
import { TicketBatch, Ticket } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { exportTicketsToDocx, exportSingleTicketDocx, buildTicketsFile } from '../lib/docxExport';
import { exportAnswerKey, hasKeyTemplate, makeSelectionInfoLoader, withSelectionInfo } from '../lib/answerKeyExport';
import { SendToTelegramButton } from './SendToTelegramButton';
import { 
  FileCheck2, 
  Download, 
  Trash2, 
  Calendar, 
  ChevronDown, 
  ChevronUp, 
  Loader2,
  BookOpen
} from 'lucide-react';

export const SavedTicketsView: React.FC = () => {
  const queryClient = useQueryClient();
  const { isAdmin, isOwner } = useAuth();
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  // Загрузка всех созданных партий билетов
  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['saved_ticket_batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_batches')
        .select(`
          *,
          subject:subjects(name),
          creator:profiles!created_by(full_name, email),
          tickets:tickets(
            id,
            ticket_number,
            created_at,
            questions:ticket_questions(
              id,
              order_index,
              question_snapshot
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      // Каждому билету — описание выбранных глав и тем (печатается в шапке варианта)
      const load = makeSelectionInfoLoader();
      return Promise.all((data || []).map(async (b: any) => ({
        ...b,
        tickets: await withSelectionInfo(b.tickets || [], b.subject_id, b.generation_params, load),
      })));
    },
  });

  const deleteBatchMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const { data, error } = await supabase.from('ticket_batches').delete().eq('id', batchId).select('id');
      if (error) throw error;
      assertRowsChanged(data, 'партия билетов');
    },
    meta: { action: 'Не удалось удалить партию билетов', success: 'Партия билетов удалена из базы' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved_ticket_batches'] });
    },
  });

  const handleKey = async (batch: any) => {
    try {
      setExportingId(`${batch.id}-key`);
      const stats = await exportAnswerKey(batch.title, batch.tickets || [], batch.subject?.name || '', { subjectId: batch.subject_id, params: batch.generation_params });
      if (stats.missing) notifyError(new Error(`В базе нет верного ответа у вопросов: ${stats.missing} — клетки в ключе пустые.`), 'Ключи готовы, но не полные');
    } catch (err: any) {
      notifyError(err, 'Ошибка при создании ключей');
    } finally {
      setExportingId(null);
    }
  };

  const handleExport = async (batch: any, lang: 'ru' | 'tg' | 'both' = 'ru') => {
    try {
      setExportingId(`${batch.id}-${lang}`);
      await exportTicketsToDocx(
        batch.title,
        batch.tickets || [],
        batch.subject?.name || 'Экзамен',
        lang
      );
    } catch (err: any) {
      notifyError(err, 'Ошибка при экспорте в Word');
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <FileCheck2 className="w-5 h-5 mr-2 text-blue-600" />
            Сохраненные экзаменационные билеты
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Архив сгенерированных билетов с зафиксированным содержанием вопросов
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-2" />
          <p className="text-sm">Загрузка архива билетов...</p>
        </div>
      ) : batches.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-2">
          <BookOpen className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-semibold text-slate-800 text-base">Нет сохраненных билетов</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Перейдите во вкладку «Генератор билетов», чтобы составить первую партию билетов.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {batches.map((batch: any) => {
            const isExpanded = expandedBatchId === batch.id;
            const tickets = batch.tickets || [];

            return (
              <div
                key={batch.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition"
              >
                <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white">
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="font-bold text-slate-900 text-base">{batch.title}</h3>
                      {batch.subject && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                          {batch.subject.name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-3 text-xs text-slate-500 mt-1">
                      <span className="flex items-center">
                        <Calendar className="w-3.5 h-3.5 mr-1 text-slate-400" />
                        {new Date(batch.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isOwner && (
                        <span title={batch.creator?.email || ''}>
                          Создал: <b className="text-slate-700">{batch.creator ? (batch.creator.full_name || batch.creator.email) : 'неизвестно'}</b>
                        </span>
                      )}
                      <span>Вариантов: {tickets.length}</span>
                      {tickets[0] && <span>Вопросов в билете: {tickets[0].questions?.length}</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => handleExport(batch, 'ru')}
                      disabled={exportingId === `${batch.id}-ru`}
                      className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center space-x-1 shadow-sm transition disabled:opacity-50"
                      title="Экспорт вариантов на русском языке"
                    >
                      {exportingId === `${batch.id}-ru` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>Рус (.docx)</span>
                    </button>

                    <button
                      onClick={() => handleExport(batch, 'tg')}
                      disabled={exportingId === `${batch.id}-tg`}
                      className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center space-x-1 shadow-sm transition disabled:opacity-50"
                      title="Экспорт вариантов на таджикском языке"
                    >
                      {exportingId === `${batch.id}-tg` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>Тоҷикӣ (.docx)</span>
                    </button>

                    <button
                      onClick={() => handleExport(batch, 'both')}
                      disabled={exportingId === `${batch.id}-both`}
                      className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-semibold flex items-center space-x-1 shadow-sm transition disabled:opacity-50"
                      title="Экспорт двуязычных вариантов (RU + TG)"
                    >
                      {exportingId === `${batch.id}-both` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>RU + TG</span>
                    </button>

                    {hasKeyTemplate(batch.subject?.name || '') && (
                      <button
                        onClick={() => handleKey(batch)}
                        disabled={exportingId === `${batch.id}-key`}
                        className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold flex items-center space-x-1 shadow-sm transition disabled:opacity-50"
                        title="Ключи ответов по шаблону (Word)"
                      >
                        {exportingId === `${batch.id}-key` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        <span>Ключи</span>
                      </button>
                    )}

                    <SendToTelegramButton
                      compact
                      title={batch.title}
                      batchId={batch.id}
                      ticketCount={tickets.length}
                      build={(lang) => buildTicketsFile(batch.title, tickets, batch.subject?.name || 'Экзамен', lang)}
                    />

                    <button
                      onClick={() => setExpandedBatchId(isExpanded ? null : batch.id)}
                      className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg transition"
                      title={isExpanded ? 'Свернуть' : 'Просмотреть варианты'}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {isAdmin && (
                      <button
                        onClick={() => {
                          if (confirm(`Удалить партию билетов "${batch.title}"?`)) {
                            deleteBatchMutation.mutate(batch.id);
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Удалить партию"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Развернутый список билетов в партии */}
                {isExpanded && (
                  <div className="border-t border-slate-100 p-5 bg-slate-50/60 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {tickets.map((t: any) => (
                        <div key={t.id} className="p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                          <div className="flex items-center justify-between font-bold text-xs text-slate-800">
                            <span>Вариант {t.ticket_number}</span>
                            <div className="flex items-center space-x-1.5">
                              <span className="text-slate-400 font-normal mr-1">Вопросов: {t.questions?.length}</span>
                              <button
                                onClick={() => exportSingleTicketDocx(batch.title, t, batch.subject?.name || 'Экзамен', 'ru')}
                                className="px-2 py-0.5 text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded border border-blue-200 transition"
                                title="Скачать этот вариант на русском"
                              >
                                RU (.docx)
                              </button>
                              <button
                                onClick={() => exportSingleTicketDocx(batch.title, t, batch.subject?.name || 'Экзамен', 'tg')}
                                className="px-2 py-0.5 text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded border border-emerald-200 transition"
                                title="Скачать этот вариант на таджикском"
                              >
                                TG (.docx)
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1 text-xs text-slate-600 max-h-40 overflow-y-auto pr-1">
                            {t.questions?.map((tq: any, i: number) => (
                              <div key={i} className="truncate p-1 bg-slate-50 rounded">
                                <span className="font-bold text-slate-400 mr-1">{i + 1}.</span>
                                {tq.question_snapshot?.content?.replace(/<.*?>/g, '')}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
