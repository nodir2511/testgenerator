import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Button, Field, Input, Textarea, inputClass } from './ui';
import { useAuth } from '../hooks/useAuth';
import { PASSAGE_KIND_LABELS, PASSAGE_QUESTIONS, savePassage } from '../lib/passages';
import { describeError } from '../lib/errors';
import type { Passage, PassageKind } from '../types/database';

interface Props {
  /** Правка существующего текста; без него создаётся новый в теме `topic` */
  passage?: Passage | null;
  topic?: { subject_id: string; chapter_id: string; topic_id: string; source_id?: string | null };
  onClose: () => void;
  onSaved?: (p: Passage) => void;
}

/** Окно создания и правки текста (чтение или текст с пропусками). В тексте с пропусками пропуски — метки {{1}}…{{8}}. */
export const PassageEditor: React.FC<Props> = ({ passage, topic, onClose, onSaved }) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [kind, setKind] = useState<PassageKind>(passage?.kind ?? 'reading');
  const [title, setTitle] = useState(passage?.title ?? '');
  const [content, setContent] = useState(passage?.content ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (!content.trim()) throw new Error('Введите текст');
      if (!passage && !topic) throw new Error('Не выбрана тема');
      return savePassage({
        id: passage?.id,
        kind,
        title,
        content,
        ...(passage ? {} : { ...topic, created_by: user?.id ?? null }),
      });
    },
    meta: { success: passage ? 'Текст сохранён' : 'Текст добавлен' },
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['passages'] });
      queryClient.invalidateQueries({ queryKey: ['passages-by-ids'] });
      queryClient.invalidateQueries({ queryKey: ['passage_counts'] });
      onSaved?.(p);
      onClose();
    },
    onError: (e: any) => setError(describeError(e, 'Не удалось сохранить текст')),
  });

  // Метки пропусков, которых не хватает или которые стоят не по порядку: подсказка, ошибкой не считается
  const labels = [...content.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const labelHint = kind === 'cloze'
    ? labels.length === PASSAGE_QUESTIONS && labels.every((n, i) => n === i + 1)
      ? `Пропусков: ${PASSAGE_QUESTIONS}, всё в порядке`
      : `Пропусков в тексте: ${labels.length}. Нужны метки {{1}} … {{${PASSAGE_QUESTIONS}}} по порядку, по одной на вопрос`
    : undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/50 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={passage ? 'Правка текста' : 'Новый текст'}
        className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">{passage ? 'Правка текста' : 'Новый текст'}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="min-h-[44px] min-w-[44px] -mt-2 -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-3 space-y-4">
          <Field label="Вид текста">
            <select value={kind} onChange={(e) => setKind(e.target.value as PassageKind)} className={inputClass}>
              {(Object.keys(PASSAGE_KIND_LABELS) as PassageKind[]).map((k) => (
                <option key={k} value={k}>{PASSAGE_KIND_LABELS[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Заголовок">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Space Tourism" />
          </Field>
          <Field label="Текст" required hint={labelHint ?? 'Абзацы разделяйте пустой строкой. К тексту привязываются 8 вопросов.'}>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12} className="font-serif" />
          </Field>
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>}
        </div>

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>Сохранить</Button>
        </div>
      </div>
    </div>
  );
};
