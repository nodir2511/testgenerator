// Импорт: раздел (предмет, глава, тема), в который попадут вопросы по умолчанию
import React from 'react';
import { Layers } from 'lucide-react';
import type { Subject, Chapter, Topic } from '../../types/database';
import type { ParsedRow } from '../../lib/importParse';
import { CustomSelect } from '../CustomSelect';
import { Field } from '../ui';

interface Props {
  parsedRows: ParsedRow[];
  handleApplyTaxonomyToAll: () => void;
  subjects: Subject[];
  availableChapters: Chapter[];
  availableTopics: Topic[];
  defaultSubjectId: string;
  defaultChapterId: string;
  defaultTopicId: string;
  setDefaultSubjectId: (v: string) => void;
  setDefaultChapterId: (v: string) => void;
  setDefaultTopicId: (v: string) => void;
}

export const DefaultTaxonomyBar: React.FC<Props> = ({ parsedRows, handleApplyTaxonomyToAll, subjects, availableChapters, availableTopics, defaultSubjectId, defaultChapterId, defaultTopicId, setDefaultSubjectId, setDefaultChapterId, setDefaultTopicId }) => (
  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center">
        <Layers className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
        Раздел для вопросов (по умолчанию):
      </span>
      {parsedRows.length > 0 && (
        <button
          type="button"
          onClick={handleApplyTaxonomyToAll}
          className="text-sm text-indigo-600 hover:text-indigo-800 font-semibold underline min-h-[40px]"
        >
          Применить ко всем ({parsedRows.length})
        </button>
      )}
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field label="Предмет">
<CustomSelect
          value={defaultSubjectId}
          onChange={(val) => {
            setDefaultSubjectId(val);
            setDefaultChapterId('');
            setDefaultTopicId('');
          }}
          className="w-full text-sm px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </CustomSelect>
</Field>

      <Field label="Глава">
<CustomSelect
          value={defaultChapterId}
          onChange={(val) => {
            setDefaultChapterId(val);
            setDefaultTopicId('');
          }}
          className="w-full text-sm px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">-- Выберите главу --</option>
          {availableChapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </CustomSelect>
</Field>

      <Field label="Тема">
<CustomSelect
          value={defaultTopicId}
          onChange={(val) => setDefaultTopicId(val)}
          className="w-full text-sm px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">-- Выберите тему --</option>
          {availableTopics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </CustomSelect>
</Field>
    </div>
  </div>
);
