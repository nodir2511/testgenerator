import React, { useRef } from 'react';
import { Bold, Italic, Underline, Subscript, Superscript } from 'lucide-react';
import { splitFractions, hasFraction, newFmtState, tokenizeFormatted, type MathNode, type FmtState, type FmtToken } from '../lib/fractions';

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
          aria-label="Нижний индекс (H₂O)"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 flex items-center font-mono font-bold min-h-[40px]"
        >
          <Subscript className="w-3.5 h-3.5 mr-1" /> X₂
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('<sup>', '</sup>')}
          title="Верхний индекс (Ca²⁺)"
          aria-label="Верхний индекс (Ca²⁺)"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 flex items-center font-mono font-bold min-h-[40px]"
        >
          <Superscript className="w-3.5 h-3.5 mr-1" /> X²
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('(', ')/( )')}
          title="Дробь (числитель)/(знаменатель)"
          aria-label="Дробь (числитель)/(знаменатель)"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 flex items-center font-mono font-bold min-h-[40px]"
        >
          a/b
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('<b>', '</b>')}
          title="Полужирный"
          aria-label="Полужирный"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 flex items-center min-h-[40px]"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('<i>', '</i>')}
          title="Курсив"
          aria-label="Курсив"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 flex items-center min-h-[40px]"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => wrapSelection('<u>', '</u>')}
          title="Подчёркнутый"
          aria-label="Подчёркнутый"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 flex items-center min-h-[40px]"
        >
          <Underline className="w-3.5 h-3.5" />
        </button>

        <span className="h-4 w-px bg-slate-300 mx-1" />

        {/* Спецсимволы химии */}
        <button
          type="button"
          onClick={() => insertSymbol(' → ')}
          title="Стрелка реакции"
          aria-label="Стрелка реакции"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 font-mono min-h-[40px]"
        >
          →
        </button>
        <button
          type="button"
          onClick={() => insertSymbol(' ⇄ ')}
          title="Равновесие"
          aria-label="Равновесие"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 font-mono min-h-[40px]"
        >
          ⇄
        </button>
        <button
          type="button"
          onClick={() => insertSymbol('↑')}
          title="Выделение газа"
          aria-label="Выделение газа"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 font-mono min-h-[40px]"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => insertSymbol('↓')}
          title="Осадок"
          aria-label="Осадок"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 font-mono min-h-[40px]"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => insertSymbol('°C')}
          title="Градусы Цельсия"
          aria-label="Градусы Цельсия"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 font-mono min-h-[40px]"
        >
          °C
        </button>
        <button
          type="button"
          onClick={() => insertSymbol('Δ')}
          title="Дельта (нагревание)"
          aria-label="Дельта (нагревание)"
          className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-600 rounded border border-slate-200 font-mono min-h-[40px]"
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
        className="w-full p-3 text-sm font-sans border border-t-0 border-slate-300 rounded-b-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-medium text-slate-800"
      />
    </div>
  );
};

/**
 * Вспомогательный компонент для безопасного отображения текста с sub/sup тегами и вертикальными математическими дробями
 */
export const FormattedText: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  if (!text) return null;
  const nodes = splitFractions(text);
  if (hasFraction(nodes)) {
    const state = newFmtState();
    return <span className={className}>{nodes.map((n, idx) => <MathNodeView key={idx} node={n} state={state} />)}</span>;
  }
  return <InlineTags text={text} className={className} />;
};

const MathNodeView: React.FC<{ node: MathNode; state?: FmtState }> = ({ node, state }) => {
  if (typeof node === 'string') return <InlineTags text={node} state={state} />;
  return (
    <span className="inline-flex flex-col items-center align-middle mx-0.5 text-[0.85em] leading-tight">
      <span className="border-b border-current px-1 pb-0.5 text-center">{node.num.map((n, i) => <MathNodeView key={i} node={n} />)}</span>
      <span className="px-1 pt-0.5 text-center">{node.den.map((n, i) => <MathNodeView key={i} node={n} />)}</span>
    </span>
  );
};

const renderTokens = (tokens: FmtToken[]) =>
  tokens.map((t, idx) => {
    let el: React.ReactNode = t.text;
    if (t.sub) el = <sub className="font-semibold">{el}</sub>;
    if (t.sup) el = <sup className="font-semibold">{el}</sup>;
    if (t.b) el = <strong>{el}</strong>;
    if (t.i) el = <em>{el}</em>;
    if (t.u) el = <u className="underline underline-offset-2">{el}</u>;
    return <React.Fragment key={idx}>{el}</React.Fragment>;
  });

// Обычный текст с тегами b, i, u, sub, sup (вложенные теги поддерживаются)
const InlineTags: React.FC<{ text: string; className?: string; state?: FmtState }> = ({ text, className, state }) => (
  <span className={className}>{renderTokens(tokenizeFormatted(text, state || newFmtState()))}</span>
);
