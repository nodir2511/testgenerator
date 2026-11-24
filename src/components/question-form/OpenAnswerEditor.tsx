import React from 'react';
import { Field } from '../ui';
import { openAnswerProblem, openCellsFor } from '../../lib/openAnswer';

interface OpenAnswerEditorProps {
  correctNumeric: string;
  setCorrectNumeric: React.Dispatch<React.SetStateAction<string>>;
  /** Название предмета: по нему считается число клеток на бланке */
  subjectName: string;
}

// Числовой ответ открытого вопроса: целое число без минуса и дробей, не длиннее клеток бланка
export const OpenAnswerEditor: React.FC<OpenAnswerEditorProps> = ({
  correctNumeric,
  setCorrectNumeric,
  subjectName,
}) => {
  const cells = openCellsFor(subjectName);
  const problem = correctNumeric.trim() === '' ? null : openAnswerProblem(Number(correctNumeric), subjectName);
  return (
          <Field label="Правильный числовой ответ (необязательно)" className="pt-3 border-t border-slate-200 space-y-2">
<input
              type="number"
              step="1"
              min="0"
              inputMode="numeric"
              value={correctNumeric}
              onChange={(e) => setCorrectNumeric(e.target.value)}
              placeholder="Например: 42"
              aria-invalid={problem ? true : undefined}
              className="w-full sm:w-64 text-sm p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            />
            {problem
              ? <p className="text-xs text-red-600" role="alert">{problem}. Вопрос с таким ответом не сохранится.</p>
              : <p className="text-xs text-slate-500">Целое число без минуса и дробей, не длиннее {cells} цифр — столько клеток под ответ на бланке.</p>}
</Field>
  );
};
