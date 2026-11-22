import React from 'react';
import { X } from 'lucide-react';

// Первый вход: как получить билеты за 3 шага
export const IntroCard: React.FC<{ dismissIntro: () => void }> = ({ dismissIntro }) => (
  <div className="bento-card rounded-2xl p-4 sm:p-5 border-indigo-200 bg-indigo-50/50">
    <div className="flex items-start justify-between gap-3">
      <h3 className="font-bold text-slate-900 text-base">Как получить билеты за 3 шага</h3>
      <button
        onClick={dismissIntro}
        className="w-10 h-10 -mr-2 -mt-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-white flex items-center justify-center shrink-0"
        aria-label="Скрыть подсказку"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
    <ol className="mt-2 space-y-2 text-sm text-slate-700">
      {[
        ['Выберите предмет', 'состав билета подставится сам'],
        ['Оставьте «Весь предмет»', 'или отметьте нужные главы'],
        ['Нажмите «Генерировать» внизу', 'и скачайте Word с билетами и ключами'],
      ].map(([a, b], i) => (
        <li key={a} className="flex items-start gap-3">
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
          <span><b className="text-slate-900">{a}</b> — {b}</span>
        </li>
      ))}
    </ol>
  </div>
);
