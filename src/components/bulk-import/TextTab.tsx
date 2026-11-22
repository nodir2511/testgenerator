// Импорт: вкладка «Вставка текста»
import React from 'react';
import { Button } from '../ui';

interface Props {
  pastedText: string;
  setPastedText: (v: string) => void;
  handleParseText: () => void;
  isProcessing: boolean;
}

export const TextTab: React.FC<Props> = ({ pastedText, setPastedText, handleParseText, isProcessing }) => (
  <div className="space-y-3">
    <textarea
      rows={6}
      value={pastedText}
      onChange={(e) => setPastedText(e.target.value)}
      placeholder="Вставьте таблицу с заголовками (например, скопированную из Excel или CSV)..."
      className="w-full p-3 font-mono text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
    />
    <Button variant="primary" onClick={handleParseText} disabled={!pastedText.trim() || isProcessing}>
      Распознать и проверить текст
    </Button>
  </div>
);
