import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react';
import { notifyError, notifyInfo } from '../lib/errors';
import { useAuth } from '../hooks/useAuth';
import { fetchBatchSlots, fetchFullQuestions, fetchTopicInfos, fetchTopicPool, saveBatchChanges, type BatchSlots, type TopicInfo } from '../lib/batchEdit';
import {
  applyToSlots, buildLinks, buildRowChanges, candidatesFor, isEmptySnapshot, paramsAfterEdit, planTopicRemoval,
  topicCounts, TYPE_LABEL, type PoolQ, type RowChange, type Slot,
} from '../lib/questionSwap';
import { FormattedText } from './FormulaEditor';
import { Badge, Button } from './ui';
import { CustomSelect } from './CustomSelect';

// Замена вопросов в готовом наборе билетов — и сразу после генерации, и в архиве.
// Все изменения идут одной транзакцией (update_batch_questions); после них набор перечитывается из базы.

export interface EditBatch { id: string; title?: string; subject_id: string; generation_params: any }
type Changed = (params: any, tickets: BatchSlots['tickets']) => void;

const plain = (s: string) => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const ruPart = (s: string) => (s.split(' / ')[0] || s).trim();
const shuffleOf = (p: any) => ({ shuffleOptions: p?.shuffle_options !== false, shuffleMatching: p?.shuffle_matching !== false });
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

// ---------- Данные набора ----------

function useBatchEdit(batch: EditBatch, enabled: boolean, onChanged?: Changed) {
  const qc = useQueryClient();
  const slotsQ = useQuery({ queryKey: ['batch_slots', batch.id], queryFn: () => fetchBatchSlots(batch.id), enabled, staleTime: Infinity, meta: { action: 'Не удалось загрузить билеты набора' } });
  const topicsQ = useQuery({ queryKey: ['topic_infos', batch.subject_id], queryFn: () => fetchTopicInfos(batch.subject_id), enabled, staleTime: 5 * 60_000 });
  const topics = topicsQ.data ?? [];
  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
  const label = (t?: TopicInfo) => (t ? `${t.chapterName.replace(/^Глава\s*/i, 'Гл. ')} · т. ${t.order}` : 'тема');

  // Записывает изменения, перечитывает набор и сообщает родителю новые билеты и параметры
  const commit = async (rows: RowChange[], newSlots: Slot[]) => {
    const slots = slotsQ.data?.slots ?? [];
    const params = paramsAfterEdit(batch.generation_params, slots, newSlots);
    await saveBatchChanges(batch.id, rows, params);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['batch_tickets', batch.id] }),
      qc.invalidateQueries({ queryKey: ['saved_ticket_batches'] }),
      qc.invalidateQueries({ queryKey: ['recent_batches'] }),
    ]);
    const fresh = await qc.fetchQuery({ queryKey: ['batch_slots', batch.id], queryFn: () => fetchBatchSlots(batch.id), staleTime: 0 });
    onChanged?.(params, fresh.tickets);
  };

  return { data: slotsQ.data, loading: slotsQ.isLoading || topicsQ.isLoading, topics, topicById, label, commit };
}

// ---------- Окно ----------

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }> = ({ title, onClose, children, footer }) => {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/50 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-xl max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-xl">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-900 text-base leading-snug">{title}</h3>
          <button onClick={onClose} className="w-10 h-10 -mr-2 -mt-2 rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center shrink-0" aria-label="Закрыть"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 overflow-y-auto space-y-3 text-sm text-slate-700">{children}</div>
        {footer && <div className="p-4 border-t border-slate-100 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};

// ---------- Темы набора и массовая замена ----------

export const BatchTopicsBar: React.FC<{ batch: EditBatch; enabled?: boolean; onChanged?: Changed }> = ({ batch, enabled = true, onChanged }) => {
  const { isOwner } = useAuth(); // пока замену пробует только главный админ
  const ed = useBatchEdit(batch, enabled && isOwner, onChanged);
  const [removing, setRemoving] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  if (!isOwner) return null;
  if (ed.loading || !ed.data) return enabled ? <div className="py-2"><Loader2 className="w-5 h-5 animate-spin text-indigo-600" /></div> : null;
  const counts = topicCounts(ed.data.slots).sort((a, b) => {
    const ta = ed.topicById.get(a.topicId), tb = ed.topicById.get(b.topicId);
    return (ta?.chapterOrder ?? 0) - (tb?.chapterOrder ?? 0) || (ta?.order ?? 0) - (tb?.order ?? 0);
  });
  const empty = ed.data.slots.filter((s) => !s.questionId).length;
  if (counts.length === 0 && empty === 0) return null;

  return (
    <div className="space-y-2" data-testid="batch-topics">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">Темы набора</span>
        {counts.length > 1 && (
          <Button variant="secondary" size="sm" className="bg-white" icon={RefreshCw} onClick={() => setPicking(true)}>Заменить тему во всех билетах</Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {counts.map((c) => {
          const t = ed.topicById.get(c.topicId);
          return (
            <Badge key={c.topicId} tone="neutral" className="text-sm font-normal gap-1 pr-1" title={t ? ruPart(t.name) : ''}>
              <span>{ed.label(t)} · <b>{c.count}</b></span>
              {counts.length > 1 && (
                <button onClick={() => setRemoving(c.topicId)} className="w-6 h-6 rounded-full hover:bg-slate-200 flex items-center justify-center" aria-label={`Убрать ${ed.label(t)} из набора`} title="Убрать тему из набора">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </Badge>
          );
        })}
        {empty > 0 && <Badge tone="danger" className="text-sm font-normal">Пустых мест: <b>{empty}</b></Badge>}
      </div>

      {picking && (
        <Modal title="Какую тему убрать из набора?" onClose={() => setPicking(false)}>
          <p>Вопросы этой темы во всех билетах заменятся вопросами других тем набора — поровну.</p>
          <div className="space-y-1.5">
            {counts.map((c) => {
              const t = ed.topicById.get(c.topicId);
              return (
                <button key={c.topicId} onClick={() => { setPicking(false); setRemoving(c.topicId); }} className="w-full text-left min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50">
                  <b>{ed.label(t)}</b> · {c.count} {plural(c.count, 'вопрос', 'вопроса', 'вопросов')}
                  <div className="text-slate-600 truncate">{t ? ruPart(t.name) : ''}</div>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
      {removing && <RemoveTopicModal batch={batch} ed={ed} topicId={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
};

type Ed = ReturnType<typeof useBatchEdit>;

const RemoveTopicModal: React.FC<{ batch: EditBatch; ed: Ed; topicId: string; onClose: () => void }> = ({ batch, ed, topicId, onClose }) => {
  const data = ed.data!;
  const otherTopics = useMemo(() => [...new Set(data.slots.map((s) => s.topicId).filter((t): t is string => !!t && t !== topicId))], [data, topicId]);
  const poolQ = useQuery({ queryKey: ['swap_pool', batch.subject_id, otherTopics.join(',')], queryFn: () => fetchTopicPool(batch.subject_id, otherTopics), staleTime: 60_000 });
  const [busy, setBusy] = useState(false);
  const order = useMemo(() => ed.topics.map((t) => t.id), [ed.topics]);
  const plan = useMemo(() => (poolQ.data ? planTopicRemoval(data.slots, topicId, poolQ.data, order) : null), [poolQ.data, data, topicId, order]);
  const name = ed.label(ed.topicById.get(topicId));
  const total = plan?.changes.length ?? 0;
  const missing = plan ? plan.missing.test + plan.missing.matching + plan.missing.open : 0;

  const apply = async () => {
    if (!plan || !poolQ.data) return;
    setBusy(true);
    try {
      const picked = plan.changes.map((c) => c.question?.id).filter((x): x is string => !!x);
      const full = await fetchFullQuestions(picked);
      const rows = buildRowChanges(plan.changes, full, shuffleOf(batch.generation_params), (id) => (id ? ed.topicById.get(id)?.name : undefined));
      const meta = new Map(poolQ.data.map((q) => [q.id, { topicId: q.topic_id, chapterId: q.chapter_id, linked: q.linked_ids ?? [] }]));
      await ed.commit(rows, applyToSlots(data.slots, rows, meta));
      const parts = Object.entries(plan.fromTopic).map(([t, n]) => `${ed.label(ed.topicById.get(t))}: ${n}`).join('; ');
      notifyInfo(`${name} убрана: заменено ${total - missing} из ${total}${parts ? ` (${parts})` : ''}.${missing ? ` Пустых мест: ${missing} — они выделены красным в билетах и ключах.` : ''}`);
      onClose();
    } catch (e) {
      notifyError(e, 'Не удалось заменить тему');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Убрать ${name} из набора`}
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Отмена</Button>
        <Button variant="primary" onClick={apply} loading={busy} disabled={!plan || total === 0}>Заменить</Button>
      </>}
    >
      {!plan ? <div className="py-4 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div> : (
        <>
          <p>В билетах будет заменено вопросов: <b>{total - missing}</b> из {total}. Вопросы подбираются из остальных тем набора — из тех, где в билетах их меньше.</p>
          {Object.keys(plan.fromTopic).length > 0 && (
            <ul className="space-y-1">
              {Object.entries(plan.fromTopic).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                <li key={t} className="flex justify-between gap-3 px-3 py-1.5 bg-slate-50 rounded-lg"><span>{ed.label(ed.topicById.get(t))}</span><b>+{n}</b></li>
              ))}
            </ul>
          )}
          {missing > 0 && (
            <div className="flex gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div>
                Свободных вопросов не хватает: {(['test', 'matching', 'open'] as const).filter((k) => plan.missing[k]).map((k) => `${TYPE_LABEL[k]} — ${plan.missing[k]}`).join(', ')}.
                Эти места останутся пустыми: в билетах и ключах они будут выделены красным, их можно заполнить кнопкой «Заменить» у вопроса.
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
};

// ---------- Варианты с кнопкой «Заменить» ----------

export const BatchVariants: React.FC<{
  batch: EditBatch;
  enabled?: boolean;
  onChanged?: Changed;
  /** Кнопки скачивания варианта; получает билет с вопросами и снимками */
  renderActions?: (t: BatchSlots['tickets'][number]) => React.ReactNode;
}> = ({ batch, enabled = true, onChanged, renderActions }) => {
  const { isOwner } = useAuth(); // пока замену пробует только главный админ
  const ed = useBatchEdit(batch, enabled, onChanged);
  const [swap, setSwap] = useState<Slot | null>(null);
  if (ed.loading || !ed.data) return <div className="py-6 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>;
  const slotOf = new Map(ed.data.slots.map((s) => [s.tqId, s]));

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
        {ed.data.tickets.map((t) => (
          <div key={t.id} className="p-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
              <span className="font-bold text-sm text-slate-900 min-w-0">Вариант {t.ticket_number} <span className="font-normal text-slate-600">· {t.questions.length} вопр.</span></span>
              {renderActions?.(t)}
            </div>
            <div className="space-y-1 text-sm text-slate-700 max-h-60 overflow-y-auto pr-1">
              {t.questions.map((tq, i) => {
                const snap = tq.question_snapshot;
                const empty = isEmptySnapshot(snap);
                return (
                  <div key={tq.id} className={`flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg border ${empty ? 'bg-red-50 border-red-300 text-red-800' : 'bg-white border-slate-100'}`}>
                    <div className="min-w-0 flex-1 truncate">
                      <span className="font-bold text-slate-500 mr-1.5">{i + 1}.</span>
                      {empty ? <b>Пустое место — нужен вопрос ({TYPE_LABEL[snap.type as keyof typeof TYPE_LABEL] ?? snap.type})</b> : plain(snap?.content ?? '')}
                    </div>
                    {isOwner && <button
                      onClick={() => setSwap(slotOf.get(tq.id) ?? null)}
                      className="w-9 h-9 shrink-0 rounded-lg text-indigo-700 hover:bg-indigo-50 flex items-center justify-center"
                      aria-label={`Заменить вопрос ${i + 1} варианта ${t.ticket_number}`}
                      title="Заменить вопрос"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {swap && <ReplaceModal batch={batch} ed={ed} slot={swap} onClose={() => setSwap(null)} />}
    </>
  );
};

// ---------- Замена одного вопроса ----------

const Brief: React.FC<{ q: any }> = ({ q }) => {
  const text = q.content_ru || q.content || '';
  let answer = '';
  if (q.type === 'test') {
    const opts = [...(q.options || [])].sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));
    answer = opts.filter((o: any) => o.is_correct).map((o: any) => plain(o.text_ru || o.text)).join('; ');
  } else if (q.type === 'open') {
    answer = q.correct_numeric_answer == null ? '' : String(q.correct_numeric_answer);
  } else if (q.type === 'matching') {
    const items = q.matching_items || [];
    const right = new Map(items.filter((m: any) => m.side === 'right').map((m: any) => [m.id, plain(m.text_ru || m.text)]));
    answer = items.filter((m: any) => m.side === 'left').map((l: any) => `${plain(l.text_ru || l.text)} → ${right.get(l.correct_match_id) ?? '?'}`).join('; ');
  }
  return (
    <div className="min-w-0 text-left">
      <div className="text-slate-900 break-words line-clamp-3"><FormattedText text={text} /></div>
      {answer && <div className="text-emerald-700 mt-0.5 break-words line-clamp-2">Ответ: {answer}</div>}
    </div>
  );
};

const ReplaceModal: React.FC<{ batch: EditBatch; ed: Ed; slot: Slot; onClose: () => void }> = ({ batch, ed, slot, onClose }) => {
  const data = ed.data!;
  const [tab, setTab] = useState<'same' | 'other'>(slot.topicId ? 'same' : 'other');
  const [otherTopic, setOtherTopic] = useState('');
  const topicId = tab === 'same' ? slot.topicId : otherTopic || null;
  const [busy, setBusy] = useState<string | null>(null);

  const poolQ = useQuery({ queryKey: ['swap_pool', batch.subject_id, topicId], queryFn: () => fetchTopicPool(batch.subject_id, [topicId!]), enabled: !!topicId, staleTime: 60_000 });
  const cands: PoolQ[] = useMemo(() => {
    if (!poolQ.data) return [];
    const used = new Set(data.slots.map((s) => s.questionId).filter((x): x is string => !!x));
    const others = data.slots.filter((s) => s.ticketId === slot.ticketId && s.tqId !== slot.tqId && s.questionId).map((s) => s.questionId!);
    const links = buildLinks([...poolQ.data, ...data.slots.filter((s) => s.questionId).map((s) => ({ id: s.questionId!, linked_ids: s.linked }))]);
    return candidatesFor(poolQ.data, slot.type, used, others, links).slice(0, tab === 'same' ? 3 : 10);
  }, [poolQ.data, data, slot, tab]);
  const fullQ = useQuery({ queryKey: ['swap_full', cands.map((c) => c.id).join(',')], queryFn: () => fetchFullQuestions(cands.map((c) => c.id)), enabled: cands.length > 0, staleTime: 60_000 });

  const choose = async (q: PoolQ) => {
    setBusy(q.id);
    try {
      const full = fullQ.data ?? (await fetchFullQuestions([q.id]));
      const rows = buildRowChanges([{ slot, question: q }], full, shuffleOf(batch.generation_params), (id) => (id ? ed.topicById.get(id)?.name : undefined));
      const meta = new Map([[q.id, { topicId: q.topic_id, chapterId: q.chapter_id, linked: q.linked_ids ?? [] }]]);
      await ed.commit(rows, applyToSlots(data.slots, rows, meta));
      onClose();
    } catch (e) {
      notifyError(e, 'Не удалось заменить вопрос');
    } finally {
      setBusy(null);
    }
  };

  const typeName = TYPE_LABEL[slot.type];
  const tabBtn = (id: 'same' | 'other', text: string, disabled = false) => (
    <button disabled={disabled} onClick={() => setTab(id)} className={`flex-1 min-h-[40px] rounded-lg text-sm font-semibold transition disabled:opacity-40 ${tab === id ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-600'}`}>{text}</button>
  );

  return (
    <Modal title={`Заменить вопрос ${slot.orderIndex} в варианте ${slot.ticketNumber}`} onClose={onClose}>
      <p>Подойдёт только вопрос того же вида ({typeName}), которого ещё нет в билетах набора.</p>
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
        {tabBtn('same', 'Из этой же темы', !slot.topicId)}
        {tabBtn('other', 'Выбрать другую тему')}
      </div>
      {tab === 'other' && (
        <CustomSelect
          value={otherTopic}
          onChange={setOtherTopic}
          placeholder="Выберите тему"
          searchable
          options={ed.topics.map((t) => ({ value: t.id, label: `${ed.label(t)} — ${ruPart(t.name)}` }))}
        />
      )}
      {!topicId ? (
        <p className="text-slate-600">Выберите тему, чтобы увидеть вопросы.</p>
      ) : poolQ.isLoading || (cands.length > 0 && fullQ.isLoading) ? (
        <div className="py-4 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>
      ) : cands.length === 0 ? (
        <p className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">В этой теме нет свободных вопросов вида «{typeName}». Выберите другую тему.</p>
      ) : (
        <ul className="space-y-2">
          {cands.map((c) => {
            const q = fullQ.data?.get(c.id);
            return (
              <li key={c.id} className="p-3 rounded-xl border border-slate-200 flex items-start gap-3">
                <div className="min-w-0 flex-1">{q ? <Brief q={q} /> : <span className="text-slate-500">Загрузка…</span>}</div>
                <Button variant="primary" size="sm" onClick={() => choose(c)} loading={busy === c.id} disabled={!!busy || !q}>Заменить</Button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};
