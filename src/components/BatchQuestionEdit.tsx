import React, { useId, useMemo, useState } from 'react';
import { notifyError, notifySuccess } from '../lib/errors';
import { applyDraft, draftOf, draftProblem, rowsForEdit, type SnapshotDraft, type TextPair } from '../lib/snapshotEdit';
import type { RowChange } from '../lib/questionSwap';
import type { EditTicket } from '../lib/batchEdit';
import { FormattedText, FormulaEditor } from './FormulaEditor';
import { Modal } from './BatchModal';
import { Button } from './ui';

// Правка вопроса внутри набора билетов (из предпросмотра): меняется только снимок вопроса в билете,
// поэтому правка попадает в Word этого набора, а банк вопросов остаётся прежним.

const LETTERS = 'ABCDEFGH';

/** Короткое поле без панели форматирования (варианты и пункты): разметка вида <sub>2</sub> пишется как есть, ниже — как это будет выглядеть */
const PlainField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => {
  const id = useId();
  return (
    <div className="space-y-1 min-w-0">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-600">{label}</label>
      <textarea
        id={id}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 [field-sizing:content]"
      />
      {/[<^_/]/.test(value) && <div className="text-sm text-slate-700 break-words"><FormattedText text={value} /></div>}
    </div>
  );
};

/** Поле текста: один язык — одно поле, два — русское и таджикское рядом. rich — с панелью форматирования (условие) */
const PairField: React.FC<{ label: string; value: TextPair; rich?: boolean; onChange: (v: TextPair) => void }> = ({ label, value, rich = false, onChange }) => {
  const field = (title: string, text: string, set: (v: string) => void) => (
    rich ? <FormulaEditor label={title} value={text} rows={3} placeholder="" onChange={set} /> : <PlainField label={title} value={text} onChange={set} />
  );
  if (value.tg === null) return field(label, value.ru, (ru) => onChange({ ru, tg: null }));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {field(`${label} (русский)`, value.ru, (ru) => onChange({ ...value, ru }))}
      {field(`${label} (тоҷикӣ)`, value.tg, (tg) => onChange({ ...value, tg }))}
    </div>
  );
};

export const EditQuestionModal: React.FC<{
  tickets: EditTicket[];
  /** Место в билете (ticket_questions.id) */
  tqId: string;
  onSave: (rows: RowChange[]) => Promise<void>;
  onClose: () => void;
}> = ({ tickets, tqId, onSave, onClose }) => {
  const place = useMemo(() => {
    for (const t of tickets) {
      const i = t.questions.findIndex((q) => q.id === tqId);
      if (i >= 0) return { ticket: t, n: i + 1, tq: t.questions[i] };
    }
    return null;
  }, [tickets, tqId]);
  const snap = place?.tq.question_snapshot;
  const [draft, setDraft] = useState<SnapshotDraft | null>(() => draftOf(snap));
  const [saving, setSaving] = useState(false);

  if (!place || !draft) {
    return <Modal title="Изменить вопрос в этом наборе" onClose={onClose}><p>Это место пустое — сначала подберите для него вопрос кнопкой замены.</p></Modal>;
  }

  const problem = draftProblem(snap, draft);
  const changed = applyDraft(snap, draft) !== snap;
  const places = place.tq.question_id
    ? tickets.filter((t) => t.questions.some((q) => q.question_id === place.tq.question_id)).map((t) => t.ticket_number)
    : [place.ticket.ticket_number];

  const save = async () => {
    if (problem || !changed || saving) return;
    setSaving(true);
    try {
      await onSave(rowsForEdit(tickets, tqId, draft));
      notifySuccess('Вопрос изменён в этом наборе');
      onClose();
    } catch (e) {
      notifyError(e, 'Не удалось сохранить правку вопроса');
      setSaving(false);
    }
  };

  const left = draft.items.filter((m) => m.side === 'left');
  const right = draft.items.filter((m) => m.side === 'right');
  const setOption = (id: string, text: TextPair) => setDraft({ ...draft, options: draft.options.map((o) => (o.id === id ? { ...o, text } : o)) });
  const setItem = (id: string, text: TextPair) => setDraft({ ...draft, items: draft.items.map((m) => (m.id === id ? { ...m, text } : m)) });

  return (
    <Modal
      title={`Изменить вопрос ${place.n} в этом наборе`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button variant="primary" loading={saving} disabled={!!problem || !changed} onClick={save}>Сохранить в наборе</Button>
        </>
      )}
    >
      <p className="text-slate-600">
        Правка меняет только этот набор билетов и попадёт в его Word. Вопрос в банке вопросов останется прежним.
        {places.length > 1 && <> Вопрос стоит в вариантах {places.join(', ')} — изменится во всех.</>}
      </p>
      <PairField label="Условие" rich value={draft.content} onChange={(content) => setDraft({ ...draft, content })} />
      {draft.options.map((o, i) => (
        <PairField key={o.id} label={`Вариант ${LETTERS[i] ?? i + 1}`} value={o.text} onChange={(t) => setOption(o.id, t)} />
      ))}
      {left.map((m, i) => (
        <PairField key={m.id} label={`Левый пункт ${LETTERS[i] ?? i + 1}`} value={m.text} onChange={(t) => setItem(m.id, t)} />
      ))}
      {right.map((m, i) => (
        <PairField key={m.id} label={`Правый пункт ${i + 1}`} value={m.text} onChange={(t) => setItem(m.id, t)} />
      ))}
      {problem && <p className="text-red-700 font-semibold">{problem}</p>}
    </Modal>
  );
};
