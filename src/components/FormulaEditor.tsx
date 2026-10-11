import React, { useRef } from 'react';
import { Bold, Italic, Subscript, Superscript } from 'lucide-react';

interface FormulaEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  rows?: number;
  label?: string;
}

export const FormulaEditor: React.FC<FormulaEditorProps> = ({
  value,
  onChange,
  placeholder = 'Введите текст вопроса или формулу...',
  rows = 3,
  label,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Обертывание выделенного фрагмента тегами форматирования
  const wrapSelection = (prefix: string, suffix: string) => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selectedText = value.substring(start, end);

    const replacement = `${prefix}${selectedText || ' '}${suffix}`;
    const nextValue = value.substring(0, start) + replacement + value.substring(end);
    onChange(nextValue);

    // Восстанавливаем курсор
    setTimeout(() => {
      el.focus();
      const newPos = start + prefix.length + (selectedText ? selectedText.length : 0);
      el.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const insertSymbol = (sym: string) => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const nextValue = value.substring(0, start) + sym + value.substring(end);
    onChange(nextValue);

    setTimeout(() => {
      el.focus();
      const newPos = start + sym.length;
      el.setSelectionRange(newPos, newPos);
    }, 0);
  };

  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
          {label}
        </label>
      )}

      {/* Панель быстрого форматирования */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-300 rounded-t-lg text-slate-700 text-xs">
        <button
          type="button"
          onClick={() => wrapSelection('<sub>', '</sub>')}
          title="Нижний индекс (H₂O)"
          className="px-2 py-1 bg-white hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200 flex items-center font-mono font-bold"
        >
          <Subscript className="w-3.5 h-3.5 mr-1" /> X₂
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('<sup>', '</sup>')}
          title="Верхний индекс (Ca²⁺)"
          className="px-2 py-1 bg-white hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200 flex items-center font-mono font-bold"
        >
          <Superscript className="w-3.5 h-3.5 mr-1" /> X²
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('<b>', '</b>')}
          title="Полужирный"
          className="px-2 py-1 bg-white hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200 flex items-center"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('<i>', '</i>')}
          title="Курсив"
          className="px-2 py-1 bg-white hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200 flex items-center"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>

        <span className="h-4 w-px bg-slate-300 mx-1" />

        {/* Спецсимволы химии */}
        <button
          type="button"
          onClick={() => insertSymbol(' → ')}
          title="Стрелка реакции"
          className="px-2 py-1 bg-white hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200 font-mono"
        >
          →
        </button>
        <button
          type="button"
          onClick={() => insertSymbol(' ⇄ ')}
          title="Равновесие"
          className="px-2 py-1 bg-white hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200 font-mono"
        >
          ⇄
        </button>
        <button
          type="button"
          onClick={() => insertSymbol('↑')}
          title="Выделение газа"
          className="px-2 py-1 bg-white hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200 font-mono"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => insertSymbol('↓')}
          title="Осадок"
          className="px-2 py-1 bg-white hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200 font-mono"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => insertSymbol('°C')}
          title="Градусы Цельсия"
          className="px-2 py-1 bg-white hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200 font-mono"
        >
          °C
        </button>
        <button
          type="button"
          onClick={() => insertSymbol('Δ')}
          title="Дельта (нагревание)"
          className="px-2 py-1 bg-white hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200 font-mono"
        >
          Δ
        </button>
      </div>

      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full p-3 text-sm font-sans border border-t-0 border-slate-300 rounded-b-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium text-slate-800"
      />
    </div>
  );
};

/**
 * Вспомогательный компонент для безопасного отображения текста с sub/sup тегами
 */
export const FormattedText: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  // Простая и безопасная регулярная очистка и рендеринг тегов b, i, sub, sup
  const parts = text.split(/(<sub>.*?<\/sub>|<sup>.*?<\/sup>|<b>.*?<\/b>|<i>.*?<\/i>)/g);

  return (
    <span className={className}>
      {parts.map((part, idx) => {
        if (part.startsWith('<sub>') && part.endsWith('</sub>')) {
          return <sub key={idx} className="font-semibold">{part.replace(/<\/?sub>/g, '')}</sub>;
        }
        if (part.startsWith('<sup>') && part.endsWith('</sup>')) {
          return <sup key={idx} className="font-semibold">{part.replace(/<\/?sup>/g, '')}</sup>;
        }
        if (part.startsWith('<b>') && part.endsWith('</b>')) {
          return <strong key={idx}>{part.replace(/<\/?b>/g, '')}</strong>;
        }
        if (part.startsWith('<i>') && part.endsWith('</i>')) {
          return <em key={idx}>{part.replace(/<\/?i>/g, '')}</em>;
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </span>
  );
};
