import React from 'react';
import { Field } from '../ui';

interface OpenAnswerEditorProps {
  correctNumeric: string;
  setCorrectNumeric: React.Dispatch<React.SetStateAction<string>>;
}

// Числовой ответ открытого вопроса
export const OpenAnswerEditor: React.FC<OpenAnswerEditorProps> = ({
  correctNumeric,
  setCorrectNumeric,
}) => {
  return (
          <Field label="Правильный числовой ответ (необязательно)" className="pt-3 border-t border-slate-200 space-y-2">
<input
              type="number"
              step="any"
              value={correctNumeric}
              onChange={(e) => setCorrectNumeric(e.target.value)}
              placeholder="Например: 42 или -5"
              className="w-full sm:w-64 text-sm p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            />
</Field>
  );
};
