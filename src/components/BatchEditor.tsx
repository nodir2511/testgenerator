import React, { useCallback, useMemo, useState } from 'react';
import { TicketPreviewPanel } from './TicketPreview';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react';
import { notifyError, notifyInfo } from '../lib/errors';
import { useAuth } from '../hooks/useAuth';
import { fetchBatchSlots, fetchFullQuestions, fetchNctSourceIds, fetchSubjectPool, fetchTopicInfos, fetchTopicPool, saveBatchChanges, type BatchSlots, type TopicInfo } from '../lib/batchEdit';
import {
  applyToSlots, blockCandidates, blocksWithoutLinkClash, blockSlots, blockSwapChanges, buildLinks, buildRowChanges, candidatesFor, isEmptySnapshot, isPermutedBatch, mirrorChanges, mirrorPlan,
  nctCandidatesFor, nctTieredCandidates, otherTypeCandidates, otherTypeOptions, paramsAfterEdit, sameTypeElsewhere, planNctTopicRemoval, planTopicRemoval, scopeTopicIds, sectionOfPoolQ, topicCounts, twinSlots, TYPE_LABEL, usedPassageIds, withoutTwins,
  type NctTier, type PassageBlockQ, type PoolQ, type RowChange, type Slot,
} from '../lib/questionSwap';
import { FormattedText } from './FormulaEditor';
import { Badge, Button } from './ui';
import { CustomSelect } from './CustomSelect';
import { nctConfigByKey } from '../../supabase/functions/_shared/nctConfigs';
import { nctTypeName } from '../lib/nctTypes';

// Замена вопросов в готовом наборе билетов — и сразу после генерации, и в архиве.
// Все изменения идут одной транзакцией (update_batch_questions); после них набор перечитывается из базы.

export interface EditBatch { id: string; title?: string; subject_id: string; generation_params: any; created_by?: string | null; subjectName?: string }
type Changed = (params: any, tickets: BatchSlots['tickets']) => void;

/** Сколько вопросов-кандидатов на странице окна замены */
const SWAP_PAGE = 25;

const plain = (s: string) => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const ruPart = (s: string) => (s.split(' / ')[0] || s).trim();
const shuffleOf = (p: any) => ({ shuffleOptions: p?.shuffle_options !== false, shuffleMatching: p?.shuffle_matching !== false });
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

// Менять набор может его автор или главный админ (так же проверяет база). Свежесозданный набор без created_by — свой.
function useCanEdit(batch: EditBatch): boolean {
  const { isOwner, user } = useAuth();
  return isOwner || !batch.created_by || batch.created_by === user?.id;
}

// ---------- Данные набора ----------

function useBatchEdit(batch: EditBatch, enabled: boolean, onChanged?: Changed) {
  const qc = useQueryClient();
  const slotsQ = useQuery({ queryKey: ['batch_slots', batch.id], queryFn: () => fetchBatchSlots(batch.id), enabled, staleTime: Infinity, meta: { action: 'Не удалось загрузить билеты набора' } });
  const topicsQ = useQuery({ queryKey: ['topic_infos', batch.subject_id], queryFn: () => fetchTopicInfos(batch.subject_id), enabled, staleTime: 5 * 60_000 });
  const topics = topicsQ.data ?? [];
  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
  const label = (t?: TopicInfo) => (t ? `${t.chapterName.replace(/^Глава\s*/i, 'Гл. ')} · т. ${t.order}` : 'тема');
  // Темы, выбранные при создании набора: замена берёт вопросы только из них (весь предмет — все темы)
  const scopeTopics = useMemo(() => {
    const scope = scopeTopicIds(batch.generation_params, topics);
    return scope ? topics.filter((t) => scope.has(t.id)) : topics;
  }, [batch.generation_params, topics]);

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

  return { data: slotsQ.data, loading: slotsQ.isLoading || topicsQ.isLoading, topics, scopeTopics, topicById, label, commit };
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
  const canEdit = useCanEdit(batch);
  const ed = useBatchEdit(batch, enabled && canEdit, onChanged);
  const [removing, setRemoving] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  if (!canEdit) return null;
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
  // Билет по формату НЦТ: замены подбираются по месту (раздел, вид, тип задания, источник)
  const nctBatch = Boolean(batch.generation_params?.nct);
  const nctCfg = nctConfigByKey(batch.generation_params?.nct_subject);
  const sourcesQ = useQuery({ queryKey: ['nct_sources'], queryFn: fetchNctSourceIds, enabled: nctBatch, staleTime: 5 * 60_000 });
  // «Переставленные варианты»: планируются места без двойников в младших вариантах, затем изменения повторяются в двойниках
  const permuted = isPermutedBatch(batch.generation_params);
  const plan = useMemo(() => {
    if (!poolQ.data) return null;
    const slots = permuted ? withoutTwins(data.slots, topicId) : data.slots;
    const done = (p: ReturnType<typeof planTopicRemoval>) => (permuted ? mirrorPlan(data.slots, p) : p);
    if (!nctBatch) return done(planTopicRemoval(slots, topicId, poolQ.data, order));
    if (!sourcesQ.data) return null;
    const src = sourcesQ.data;
    const pool = poolQ.data.map((q) => ({ ...q, isNct: !!q.source_id && src.has(q.source_id) }));
    const sectionOf = (t: string) => {
      const info = ed.topicById.get(t);
      return info ? sectionOfPoolQ({ chapter: { order_index: info.chapterOrder }, topic: { order_index: info.order } }, nctCfg) : null;
    };
    return done(planNctTopicRemoval(slots, topicId, pool, sectionOf, (id) => !!id && src.has(id), order, nctCfg));
  }, [poolQ.data, data, topicId, order, nctBatch, permuted, sourcesQ.data, ed.topicById, nctCfg]);
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
      const meta = new Map(poolQ.data.map((q) => [q.id, { topicId: q.topic_id, chapterId: q.chapter_id, linked: q.linked_ids ?? [], nctType: q.nct_type ?? null, nctDifficulty: q.nct_difficulty ?? null, sourceId: q.source_id ?? null, passageId: q.passage_id ?? null, passageKind: (q.passage?.kind ?? null) as Slot['passageKind'] }]));
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
          <p>В билетах будет заменено вопросов: <b>{total - missing}</b> из {total}. {nctBatch
            ? 'Билет по формату НЦТ: каждый вопрос заменяется на подходящий для его места — того же раздела, вида и типа задания, из сборника НЦТ или из банка, как прежний. Вопросы берутся из остальных тем набора.'
            : 'Вопросы подбираются из остальных тем набора — из тех, где в билетах их меньше.'}</p>
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
  const canEdit = useCanEdit(batch);
  const ed = useBatchEdit(batch, enabled, onChanged);
  const [swap, setSwap] = useState<Slot | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const closePreview = useCallback(() => setPreviewId(null), []);
  // места, входящие в текст (английский): у них кнопка «Заменить текст» вместо «Заменить вопрос»
  const textSlotIds = useMemo(() => {
    const ids = new Set<string>();
    const slots = ed.data?.slots ?? [];
    slots.forEach((s, i) => { if (s.passageId || !s.questionId) { const b = blockSlots(slots, i); if (b.length > 1) ids.add(s.tqId); } });
    return ids;
  }, [ed.data]);
  if (ed.loading || !ed.data) return <div className="py-6 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>;
  const slotOf = new Map(ed.data.slots.map((s) => [s.tqId, s]));

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
        {ed.data.tickets.map((t) => (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            aria-label={`Открыть предпросмотр: вариант ${t.ticket_number}`}
            aria-pressed={previewId === t.id}
            onClick={() => setPreviewId(t.id)}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPreviewId(t.id); } }}
            className={`p-3 rounded-2xl border bg-slate-50/70 space-y-2 cursor-pointer transition hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${previewId === t.id ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200/80'}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
              <span className="font-bold text-sm text-slate-900 min-w-0">Вариант {t.ticket_number} <span className="font-normal text-slate-600">· {t.questions.length} вопр.</span></span>
              <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>{renderActions?.(t)}</div>
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
                    {canEdit && <button
                      onClick={(e) => { e.stopPropagation(); setSwap(slotOf.get(tq.id) ?? null); }}
                      className="w-9 h-9 shrink-0 rounded-lg text-indigo-700 hover:bg-indigo-50 flex items-center justify-center"
                      aria-label={textSlotIds.has(tq.id) ? `Заменить текст (вопрос ${i + 1} варианта ${t.ticket_number})` : `Заменить вопрос ${i + 1} варианта ${t.ticket_number}`}
                      title={textSlotIds.has(tq.id) ? 'Заменить текст' : 'Заменить вопрос'}
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
      {swap && (textSlotIds.has(swap.tqId)
        ? <ReplaceTextModal batch={batch} ed={ed} slot={swap} onClose={() => setSwap(null)} />
        : <ReplaceModal batch={batch} ed={ed} slot={swap} onClose={() => setSwap(null)} />)}
      {previewId && <TicketPreviewPanel tickets={ed.data.tickets} ticketId={previewId} title={batch.title} subjectName={batch.subjectName} onSelect={setPreviewId} onClose={closePreview} />}
    </>
  );
};

// ---------- Замена текста (английский): текст и все его вопросы меняются вместе ----------

const ReplaceTextModal: React.FC<{ batch: EditBatch; ed: Ed; slot: Slot; onClose: () => void }> = ({ batch, ed, slot, onClose }) => {
  const data = ed.data!;
  const members = useMemo(() => blockSlots(data.slots, data.slots.findIndex((s) => s.tqId === slot.tqId)).map((i) => data.slots[i]), [data, slot]);
  const kind = members.find((m) => m.passageKind)?.passageKind ?? 'reading';
  const [tab, setTab] = useState<'same' | 'other'>(slot.topicId ? 'same' : 'other');
  const [otherTopic, setOtherTopic] = useState('');
  const topicId = tab === 'same' ? slot.topicId : otherTopic || null;
  const [busy, setBusy] = useState<string | null>(null);
  const poolQ = useQuery({ queryKey: ['swap_pool', batch.subject_id, topicId], queryFn: () => fetchTopicPool(batch.subject_id, [topicId!]), enabled: !!topicId, staleTime: 60_000 });
  const cands: PassageBlockQ[] = useMemo(
    () => (poolQ.data ? blocksWithoutLinkClash(blockCandidates(poolQ.data, kind, usedPassageIds(data.slots)), data.slots, members).slice(0, 5) : []),
    [poolQ.data, data, kind, members],
  );
  // по первому вопросу каждого текста читаем сам текст для показа
  const firstIds = cands.map((c) => c.questions[0].id);
  const previewQ = useQuery({ queryKey: ['swap_full', firstIds.join(',')], queryFn: () => fetchFullQuestions(firstIds), enabled: firstIds.length > 0, staleTime: 60_000 });

  const choose = async (b: PassageBlockQ) => {
    setBusy(b.id);
    try {
      const full = await fetchFullQuestions(b.questions.map((q) => q.id));
      const changes = blockSwapChanges(members, b);
      const rows = buildRowChanges(changes, full, shuffleOf(batch.generation_params), (id) => (id ? ed.topicById.get(id)?.name : undefined));
      const meta = new Map(b.questions.map((q) => [q.id, { topicId: q.topic_id, chapterId: q.chapter_id, linked: q.linked_ids ?? [], nctType: q.nct_type ?? null, nctDifficulty: q.nct_difficulty ?? null, sourceId: q.source_id ?? null, passageId: b.id, passageKind: b.kind }]));
      await ed.commit(rows, applyToSlots(data.slots, rows, meta));
      onClose();
    } catch (e) {
      notifyError(e, 'Не удалось заменить текст');
    } finally {
      setBusy(null);
    }
  };

  const tabBtn = (id: 'same' | 'other', text: string, disabled = false) => (
    <button disabled={disabled} onClick={() => setTab(id)} className={`flex-1 min-h-[40px] rounded-lg text-sm font-semibold transition disabled:opacity-40 ${tab === id ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-600'}`}>{text}</button>
  );

  return (
    <Modal title={`Заменить текст в варианте ${slot.ticketNumber}`} onClose={onClose}>
      <p>Текст ({kind === 'cloze' ? 'с пропусками' : 'для чтения'}) заменится вместе со всеми {members.length} вопросами к нему. Подойдёт только текст того же вида, которого ещё нет в билетах набора.</p>
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
        {tabBtn('same', 'Из этой же темы', !slot.topicId)}
        {tabBtn('other', 'Выбрать другую тему')}
      </div>
      {tab === 'other' && (
        <CustomSelect value={otherTopic} onChange={setOtherTopic} placeholder="Выберите тему" searchable options={ed.scopeTopics.map((t) => ({ value: t.id, label: `${ed.label(t)} — ${ruPart(t.name)}` }))} />
      )}
      {!topicId ? (
        <p className="text-slate-600">Выберите тему, чтобы увидеть тексты.</p>
      ) : poolQ.isLoading || (cands.length > 0 && previewQ.isLoading) ? (
        <div className="py-4 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>
      ) : cands.length === 0 ? (
        <p className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">В этой теме нет свободных текстов такого вида. Выберите другую тему.</p>
      ) : (
        <ul className="space-y-2">
          {cands.map((c) => {
            const p = previewQ.data?.get(c.questions[0].id)?.passage;
            return (
              <li key={c.id} className="p-3 rounded-xl border border-slate-200 flex items-start gap-3">
                <div className="min-w-0 flex-1 text-left">
                  <div className="font-semibold text-slate-900 break-words">{p?.title || 'Текст'}</div>
                  {p?.content && <div className="text-slate-600 break-words line-clamp-3">{plain(p.content)}</div>}
                </div>
                <Button variant="primary" size="sm" onClick={() => choose(c)} loading={busy === c.id} disabled={!!busy || !previewQ.data}>Заменить</Button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
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
  // Билет по формату НЦТ: замена только из пула раздела, того же вида и типа задания
  const nctBatch = Boolean(batch.generation_params?.nct) && !!slot.questionId;
  const nctCfg = nctConfigByKey(batch.generation_params?.nct_subject);
  const sourcesQ = useQuery({ queryKey: ['nct_sources'], queryFn: fetchNctSourceIds, enabled: nctBatch, staleTime: 5 * 60_000 });
  const slotTopic = slot.topicId ? ed.topicById.get(slot.topicId) : undefined;
  const section = useMemo(
    () => (nctBatch && slotTopic ? sectionOfPoolQ({ chapter: { order_index: slotTopic.chapterOrder }, topic: { order_index: slotTopic.order }, nct_type: slot.nctType }, nctCfg) : null),
    [nctBatch, slotTopic, slot.nctType, nctCfg],
  );
  const nctMode = nctBatch && section !== null;
  const [anySource, setAnySource] = useState(false);
  // Галочка «Другой тип задания»: вопросы выбранного типа из всего предмета; на этом месте он встанет во всех вариантах
  const [otherType, setOtherType] = useState(false);
  const [pickType, setPickType] = useState('');
  // Темы раздела места среди выбранных при создании набора
  const sectionTopics = useMemo(
    () => (section ? ed.scopeTopics.filter((t) => sectionOfPoolQ({ chapter: { order_index: t.chapterOrder }, topic: { order_index: t.order } }, nctCfg) === section).map((t) => t.id) : []),
    [section, ed.scopeTopics, nctCfg],
  );
  // Место с меткой типа задания: замена — из всех вопросов предмета с этой меткой (по типу, а не по теме)
  const byType = !!slot.nctType;
  const wholeSubject = byType || otherType;
  const poolTopics = useMemo(() => (byType ? ed.topics.map((t) => t.id) : sectionTopics), [byType, ed.topics, sectionTopics]); // при byType — только для проверки «есть темы»

  const [tab, setTab] = useState<'same' | 'other'>(slot.topicId ? 'same' : 'other');
  const [otherTopic, setOtherTopic] = useState('');
  const topicId = tab === 'same' ? slot.topicId : otherTopic || null;
  const [busy, setBusy] = useState<string | null>(null);
  // «Переставленные варианты»: то же задание стоит в вариантах той же чётности — заменяется и там
  const twins = useMemo(() => (isPermutedBatch(batch.generation_params) ? twinSlots(data.slots, slot) : []), [batch.generation_params, data, slot]);

  const poolQ = useQuery({
    queryKey: nctMode ? ['swap_pool_nct', batch.subject_id, wholeSubject ? 'all' : poolTopics.join(',')] : ['swap_pool', batch.subject_id, topicId],
    queryFn: () => (nctMode && wholeSubject ? fetchSubjectPool(batch.subject_id) : fetchTopicPool(batch.subject_id, nctMode ? poolTopics : [topicId!])),
    enabled: nctMode ? poolTopics.length > 0 && !!sourcesQ.data : !!topicId,
    staleTime: 60_000,
  });
  // Билет НЦТ: если вопросов того же типа не осталось (тип редкий, а вариантов много), показываем другие вопросы того же раздела и вида
  const scopeSet = useMemo(() => (ed.scopeTopics.length < ed.topics.length ? new Set(ed.scopeTopics.map((t) => t.id)) : null), [ed.scopeTopics, ed.topics]);
  const { cands: allCands, relaxed, total, bothSources, tier, typeOptions } = useMemo((): { cands: PoolQ[]; relaxed: boolean; total: number; bothSources: boolean; tier: NctTier | null; typeOptions: Array<{ type: string; count: number }> } => {
    if (!poolQ.data) return { cands: [], relaxed: false, total: 0, bothSources: false, tier: null, typeOptions: [] };
    const used = new Set(data.slots.map((s) => s.questionId).filter((x): x is string => !!x));
    // остальные вопросы этого варианта и его двойников (замена встанет во все)
    const mine = new Set([slot.tqId, ...twins.map((t) => t.tqId)]);
    const tickets = new Set([slot.ticketId, ...twins.map((t) => t.ticketId)]);
    const ticketSlots = data.slots.filter((s) => tickets.has(s.ticketId) && !mine.has(s.tqId) && s.questionId);
    const others = ticketSlots.map((s) => s.questionId!);
    const links = buildLinks([...poolQ.data, ...data.slots.filter((s) => s.questionId).map((s) => ({ id: s.questionId!, linked_ids: s.linked }))]);
    if (nctMode) {
      const src = sourcesQ.data ?? new Set<string>();
      const pool = poolQ.data.map((q) => ({ ...q, isNct: !!q.source_id && src.has(q.source_id) }));
      const info = { section, nctType: slot.nctType ?? null, difficulty: slot.nctDifficulty ?? null, isNct: !!slot.sourceId && src.has(slot.sourceId) };
      const types = new Set(ticketSlots.map((s) => s.nctType).filter((x): x is string => !!x));
      if (otherType) {
        // только темы и главы, выбранные при создании набора (пройденные): других типов из непройденных тем в списке нет
        const inScope = scopeSet ? pool.filter((q) => scopeSet.has(q.topic_id)) : pool;
        const all = otherTypeOptions(inScope, slot.type, used, others, links, slot.nctType ?? null, nctCfg.banned, true, info.isNct);
        const own = otherTypeOptions(inScope, slot.type, used, others, links, slot.nctType ?? null, nctCfg.banned, false, info.isNct);
        const sum = (l: Array<{ count: number }>) => l.reduce((n, o) => n + o.count, 0);
        const bothSources = sum(own) > 0 && sum(own) < sum(all);
        const typeOptions = anySource ? all : own;
        const list = pickType ? otherTypeCandidates(inScope, slot.type, used, others, links, pickType, anySource, info.isNct, scopeSet) : [];
        return { cands: list, relaxed: false, total: list.length, bothSources, tier: null, typeOptions };
      }
      if (byType) {
        // по ступеням: метка в выбранных темах → близкие типы там же → метка во всём предмете → близкие во всём предмете
        // галочка «Любой источник» имеет смысл, только если на этой ступени есть и сборник НЦТ, и банк
        const all = nctTieredCandidates(pool, slot.type, used, others, links, info, types, true, nctCfg, scopeSet);
        const bothSources = all.cands.some((q) => q.isNct) && all.cands.some((q) => !q.isNct);
        const got = anySource ? all : nctTieredCandidates(pool, slot.type, used, others, links, info, types, false, nctCfg, scopeSet);
        if (got.cands.length) return { cands: got.cands, relaxed: false, total: got.cands.length, bothSources, tier: got.tier, typeOptions: [] };
        // запасной путь: другие вопросы того же раздела и вида — из тем, выбранных при создании набора
        const inScope = new Set(sectionTopics);
        const loose = nctCandidatesFor(pool.filter((q) => inScope.has(q.topic_id)), slot.type, used, others, links, { ...info, nctType: null }, types, true, nctCfg);
        return { cands: loose, relaxed: loose.length > 0, total: loose.length, bothSources, tier: null, typeOptions: [] };
      }
      const all = nctCandidatesFor(pool, slot.type, used, others, links, info, types, true, nctCfg);
      const bothSources = all.some((q) => q.isNct) && all.some((q) => !q.isNct);
      const strict = anySource ? all : nctCandidatesFor(pool, slot.type, used, others, links, info, types, false, nctCfg);
      return { cands: strict, relaxed: false, total: strict.length, bothSources, tier: null, typeOptions: [] };
    }
    const list = candidatesFor(poolQ.data, slot.type, used, others, links);
    return { cands: list, relaxed: false, total: list.length, bothSources: false, tier: null, typeOptions: [] };
  }, [poolQ.data, data, slot, twins, tab, nctMode, section, sectionTopics, byType, scopeSet, sourcesQ.data, anySource, nctCfg, otherType, pickType]);
  // Постранично по 25: «Назад» / «Дальше»; при смене условий подбора — снова первая страница
  const [page, setPage] = useState(0);
  React.useEffect(() => { setPage(0); }, [anySource, tab, otherTopic, otherType, pickType]);
  const pages = Math.max(1, Math.ceil(allCands.length / SWAP_PAGE));
  const pageNo = Math.min(page, pages - 1);
  const cands = useMemo(() => allCands.slice(pageNo * SWAP_PAGE, pageNo * SWAP_PAGE + SWAP_PAGE), [allCands, pageNo]);
  const fullQ = useQuery({ queryKey: ['swap_full', cands.map((c) => c.id).join(',')], queryFn: () => fetchFullQuestions(cands.map((c) => c.id)), enabled: cands.length > 0, staleTime: 60_000 });

  const choose = async (q: PoolQ) => {
    setBusy(q.id);
    try {
      // Тип задания на позиции — один во всех вариантах: выбран вопрос другого типа — в остальных вариантах на этом месте тоже он
      const permuted = isPermutedBatch(batch.generation_params);
      let base: Array<{ slot: Slot; question: PoolQ | null }> = [{ slot, question: q }];
      let missing: number[] = [];
      if (nctMode && q.nct_type && poolQ.data) {
        const links = buildLinks([...poolQ.data, ...data.slots.filter((s) => s.questionId).map((s) => ({ id: s.questionId!, linked_ids: s.linked }))]);
        // при «Другом типе задания» остальные варианты тоже берут вопросы только из тем набора
        const swapPool = otherType && scopeSet ? poolQ.data.filter((x) => scopeSet.has(x.topic_id)) : poolQ.data;
        const r = sameTypeElsewhere(data.slots, slot, q, swapPool, scopeSet, links, permuted);
        base = [...base, ...r.changes];
        missing = r.missing;
      }
      const changes = permuted ? mirrorChanges(data.slots, base) : base;
      const picked = [...new Set(changes.map((c) => c.question?.id).filter((x): x is string => !!x))];
      const full = picked.every((id) => fullQ.data?.has(id)) ? fullQ.data! : await fetchFullQuestions(picked);
      const rows = buildRowChanges(changes, full, shuffleOf(batch.generation_params), (id) => (id ? ed.topicById.get(id)?.name : undefined));
      const meta = new Map(changes.filter((c) => c.question).map((c) => { const x = c.question!; return [x.id, { topicId: x.topic_id, chapterId: x.chapter_id, linked: x.linked_ids ?? [], nctType: x.nct_type ?? null, nctDifficulty: x.nct_difficulty ?? null, sourceId: x.source_id ?? null }]; }));
      await ed.commit(rows, applyToSlots(data.slots, rows, meta));
      const also = [...new Set(changes.map((c) => c.slot.ticketNumber).filter((n) => n !== slot.ticketNumber))].sort((a, b) => a - b);
      if (base.length > 1 || missing.length) {
        notifyInfo(`Тип задания «${nctTypeName(q.nct_type)}» поставлен на место ${slot.orderIndex}${also.length ? ` и в вариантах ${also.join(', ')}` : ''}.${missing.length ? ` В вариантах ${missing.join(', ')} свободных вопросов этого типа не нашлось — там вопрос не менялся.` : ''}`);
      }
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
      {twins.length > 0 && (
        <p className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900">
          Переставленные варианты: этот вопрос заменится и в {twins.length > 1 ? 'вариантах' : 'варианте'} {twins.map((t) => t.ticketNumber).sort((a, b) => a - b).join(', ')}.
        </p>
      )}
      {nctMode ? (
        <>
          <label className="flex items-start gap-2 p-3 rounded-xl border border-slate-200 text-sm text-slate-800">
            <input type="checkbox" className="h-4 w-4 mt-0.5" checked={otherType} onChange={(e) => { setOtherType(e.target.checked); setPickType(''); }} />
            <span><b>Другой тип задания</b> — выбрать вопрос другого типа; на месте {slot.orderIndex} он встанет во всех вариантах набора. В списке — только типы из тем, выбранных при создании набора.</span>
          </label>
          {otherType && (
            <CustomSelect
              value={pickType}
              onChange={setPickType}
              placeholder="Выберите тип задания"
              searchable
              options={[...typeOptions].sort((a, b) => nctTypeName(a.type).localeCompare(nctTypeName(b.type), 'ru')).map((o) => ({ value: o.type, label: `${nctTypeName(o.type)} — ${o.count}` }))}
            />
          )}
          {!otherType && <p>
            {slot.nctType
              ? <>Билет по формату НЦТ: подойдёт вопрос вида «{typeName}» с типом задания «{nctTypeName(slot.nctType)}», которого нет в билетах набора. Сначала — из тем, выбранных при создании набора; нет таких — близкие типы заданий оттуда же; затем — из остальных тем предмета.</>
              : <>Билет по формату НЦТ: подойдёт только вопрос вида «{typeName}» из раздела «{nctCfg.sections.find((x) => x.key === section)?.name ?? section}» без метки или с типом, которого ещё нет в этом билете, и которого нет в билетах набора.</>}
          </p>}
          {(bothSources || anySource) && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4" checked={anySource} onChange={(e) => setAnySource(e.target.checked)} />
              Любой источник: вместе вопросы из сборника НЦТ и из остального банка (без галочки — только {slot.sourceId && sourcesQ.data?.has(slot.sourceId) ? 'из сборника НЦТ' : 'из банка'}, как у заменяемого)
            </label>
          )}
        </>
      ) : (
        <>
          <p>Подойдёт только вопрос того же вида ({typeName}), которого ещё нет в билетах набора.</p>
          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
            {tabBtn('same', 'Из этой же темы', !slot.topicId)}
            {tabBtn('other', 'Выбрать другую тему')}
          </div>
        </>
      )}
      {!nctMode && tab === 'other' && (
        <CustomSelect
          value={otherTopic}
          onChange={setOtherTopic}
          placeholder="Выберите тему"
          searchable
          options={ed.scopeTopics.map((t) => ({ value: t.id, label: `${ed.label(t)} — ${ruPart(t.name)}` }))}
        />
      )}
      {!nctMode && !topicId ? (
        <p className="text-slate-600">Выберите тему, чтобы увидеть вопросы.</p>
      ) : nctMode && otherType && !pickType && !poolQ.isLoading && !sourcesQ.isLoading ? (
        <p className="text-slate-600">{typeOptions.length ? 'Выберите тип задания, чтобы увидеть вопросы.' : `Нет свободных вопросов вида «${typeName}» другого типа.`}</p>
      ) : poolQ.isLoading || (nctMode && sourcesQ.isLoading) || (cands.length > 0 && fullQ.isLoading) ? (
        <div className="py-4 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>
      ) : cands.length === 0 ? (
        <p className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">{nctMode ? `Нет свободных вопросов вида «${typeName}» такого типа.${bothSources && !anySource ? ' Попробуйте «Любой источник».' : ''}` : `В этой теме нет свободных вопросов вида «${typeName}». Выберите другую тему.`}</p>
      ) : (
        <ul className="space-y-2">
          {relaxed && <li className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 list-none">Вопросов типа «{nctTypeName(slot.nctType)}» больше не осталось — показаны другие свободные вопросы того же раздела и вида.</li>}
          {tier && tier !== 'same' && (
            <li className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 list-none">
              {tier === 'related' && <>Вопросов типа «{nctTypeName(slot.nctType)}» в выбранных темах нет — показаны близкие типы заданий из выбранных тем.</>}
              {tier === 'same-wide' && <>В выбранных темах нет ни этого, ни близких типов — показаны вопросы типа «{nctTypeName(slot.nctType)}» из других тем предмета.</>}
              {tier === 'related-wide' && <>В выбранных темах подходящих вопросов нет — показаны близкие типы заданий из других тем предмета.</>}
            </li>
          )}
          <li className="list-none text-slate-600 px-1">
            Подходит вопросов: <b>{total}</b>{pages > 1 ? ` — показаны ${pageNo * SWAP_PAGE + 1}–${pageNo * SWAP_PAGE + cands.length}, сначала реже всего бравшиеся` : ''}.
          </li>
          {cands.map((c) => {
            const q = fullQ.data?.get(c.id);
            const where = ed.topicById.get(c.topic_id);
            return (
              <li key={c.id} className="p-3 rounded-xl border border-slate-200 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {nctMode && (
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      <Badge tone={c.isNct ? 'info' : 'neutral'} className="text-xs font-normal">{c.isNct ? 'сборник НЦТ' : 'банк'}</Badge>
                      {where && <Badge tone="neutral" className="text-xs font-normal">{ed.label(where)}</Badge>}
                      {c.nct_type && c.nct_type !== slot.nctType && <Badge tone="warning" className="text-xs font-normal" title="Другой тип: на этом месте он встанет и в остальных вариантах">{nctTypeName(c.nct_type)} · во всех вариантах</Badge>}
                    </div>
                  )}
                  {q ? <Brief q={q} /> : <span className="text-slate-500">Загрузка…</span>}
                </div>
                <Button variant="primary" size="sm" onClick={() => choose(c)} loading={busy === c.id} disabled={!!busy || !q}>Заменить</Button>
              </li>
            );
          })}
          {pages > 1 && (
            <li className="list-none flex items-center justify-between gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setPage(pageNo - 1)} disabled={pageNo === 0 || !!busy}>Назад</Button>
              <span className="text-slate-600">Страница {pageNo + 1} из {pages}</span>
              <Button variant="secondary" size="sm" onClick={() => setPage(pageNo + 1)} disabled={pageNo >= pages - 1 || !!busy}>Дальше</Button>
            </li>
          )}
        </ul>
      )}
    </Modal>
  );
};
