import React from 'react';
import type { Chapter, Passage, QuestionType, Source, Subject, Topic } from '../../types/database';
import { useNctTypes } from '../../hooks/useNctTypes';
import { NCT_DIFFICULTIES } from '../../lib/nctDifficulty';
import { passageLabel, PASSAGE_QUESTIONS } from '../../lib/passages';
import { CustomSelect } from '../CustomSelect';
import { Field } from '../ui';

interface TaxonomyFieldsProps {
  subjects: Subject[];
  chapters: Chapter[];
  topics: Topic[];
  sources: Source[];
  /** Тексты выбранной темы (английский) */
  topicPassages: Passage[];
  /** Метки НЦТ видит только главный админ */
  isOwner: boolean;
  type: QuestionType;
  subjectId: string;
  setSubjectId: React.Dispatch<React.SetStateAction<string>>;
  chapterId: string;
  setChapterId: React.Dispatch<React.SetStateAction<string>>;
  topicId: string;
  setTopicId: React.Dispatch<React.SetStateAction<string>>;
  sourceId: string;
  setSourceId: React.Dispatch<React.SetStateAction<string>>;
  nctType: string;
  setNctType: React.Dispatch<React.SetStateAction<string>>;
  nctDifficulty: string;
  setNctDifficulty: React.Dispatch<React.SetStateAction<string>>;
  passageId: string;
  setPassageId: React.Dispatch<React.SetStateAction<string>>;
  passageOrder: string;
  setPassageOrder: React.Dispatch<React.SetStateAction<string>>;
}

// Привязка вопроса: предмет, глава, тема, источник, метки НЦТ и текст темы
export const TaxonomyFields: React.FC<TaxonomyFieldsProps> = ({
  subjects,
  chapters,
  topics,
  sources,
  topicPassages,
  isOwner,
  type,
  subjectId,
  setSubjectId,
  chapterId,
  setChapterId,
  topicId,
  setTopicId,
  sourceId,
  setSourceId,
  nctType,
  setNctType,
  nctDifficulty,
  setNctDifficulty,
  passageId,
  setPassageId,
  passageOrder,
  setPassageOrder,
}) => {
  // Метки НЦТ ставит только главный админ; список — только выбранного предмета
  const nctTypes = useNctTypes((subjects as any[]).find((x: any) => x.id === subjectId)?.name, isOwner && !!subjectId && (subjects as any[]).length > 0);
  return (
        <div id="qf-taxonomy" className="scroll-mt-24 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-1 gap-4">
          <Field label="Предмет" required>
<CustomSelect
              value={subjectId}
              onChange={(val) => {
                setSubjectId(val);
                setChapterId('');
                setTopicId('');
                setPassageId(''); setPassageOrder('');
              }}
              className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            >
              <option value="">-- Выберите предмет --</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </CustomSelect>
</Field>

          <Field label="Глава" required>
<CustomSelect
              disabled={!subjectId}
              value={chapterId}
              onChange={(val) => {
                setChapterId(val);
                setTopicId('');
                setPassageId(''); setPassageOrder('');
              }}
              className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium disabled:bg-slate-100"
            >
              <option value="">-- Выберите главу --</option>
              {chapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </CustomSelect>
</Field>

          <Field label="Тема" required>
<CustomSelect
              disabled={!chapterId}
              value={topicId}
              onChange={(val) => { setTopicId(val); setPassageId(''); setPassageOrder(''); }}
              className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium disabled:bg-slate-100"
            >
              <option value="">-- Выберите тему --</option>
              {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </CustomSelect>
</Field>

          <Field label="Источник / Сборник">
<CustomSelect
              value={sourceId}
              onChange={(val) => setSourceId(val)}
              className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            >
              <option value="">-- Без источника --</option>
              {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </CustomSelect>
</Field>

          {isOwner && (
            <Field label="Тип задания НЦТ (метка)">
              <CustomSelect
                value={nctType}
                onChange={(val) => setNctType(val)}
                className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              >
                <option value="">-- Без метки --</option>
                {nctTypes.map(t => <option key={t.code} value={t.code}>{t.name} ({t.code})</option>)}
              </CustomSelect>
            </Field>
          )}

          {isOwner && (
            <Field label="Сложность для НЦТ">
              <CustomSelect
                value={nctDifficulty}
                onChange={(val) => setNctDifficulty(val)}
                className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              >
                <option value="">-- Не указана --</option>
                {NCT_DIFFICULTIES.map(d => <option key={d.value} value={String(d.value)}>{d.name}</option>)}
              </CustomSelect>
            </Field>
          )}

          {type === 'test' && topicPassages.length > 0 && (
            <>
              <Field label="Текст (необязательно)" hint="Вопрос к тексту для чтения или с пропусками; текст добавляется в списке вопросов темы">
                <CustomSelect
                  value={passageId}
                  onChange={(val) => { setPassageId(val); if (!val) setPassageOrder(''); }}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                >
                  <option value="">-- Без текста --</option>
                  {topicPassages.map(p => <option key={p.id} value={p.id}>{passageLabel(p)}</option>)}
                </CustomSelect>
              </Field>
              {passageId && (
                <Field label="Место в тексте" hint={`Номер вопроса к этому тексту, от 1 до ${PASSAGE_QUESTIONS}; у текста с пропусками совпадает с меткой {{номер}}`}>
                  <CustomSelect
                    value={passageOrder}
                    onChange={(val) => setPassageOrder(val)}
                    className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  >
                    <option value="">-- Не указано --</option>
                    {Array.from({ length: PASSAGE_QUESTIONS }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
                  </CustomSelect>
                </Field>
              )}
            </>
          )}
        </div>
  );
};
