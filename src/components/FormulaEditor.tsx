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
          onClick={() => wrapSelection('(', ')/( )')}
          title="Дробь (числитель)/(знаменатель)"
          className="px-2 py-1 bg-white hover:bg-blue-50 hover:text-blue-600 rounded border border-slate-200 flex items-center font-mono font-bold"
        >
          a/b
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

const UNIT_RE = /(?:^|\s|\d)(?:км\/ч|км\/соат|м\/с[2²]?|г\/моль|Н\/м|кг\/м[3³]?|Дж\/кг|В\/м|А\/м|Ом\/м|об\/с|рад\/с)(?:$|\s|[.,;:!?])/i;

function stripOuterParens(s: string): string {
  if (!s) return '';
  s = s.trim();
  if (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0 && i < s.length - 1) return s;
      }
    }
    return s.slice(1, -1).trim();
  }
  return s;
}

function findMainSlash(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === '/' && depth === 0) {
      return i;
    }
  }
  return s.indexOf('/');
}

interface FracInfo {
  prefix?: string;
  num?: string;
  den?: string;
  suffix?: string;
  isDouble?: boolean;
  num1?: string;
  den1?: string;
  num2?: string;
  den2?: string;
}

function extractFraction(expr: string): FracInfo | null {
  if (!expr || UNIT_RE.test(expr)) return null;

  // 1. Явная дробь \frac{num}{den} или <frac>num/den</frac>
  const latexMatch = expr.match(/^(.*?)\\frac\{([^{}]+)\}\{([^{}]+)\}(.*)$/);
  if (latexMatch) {
    return {
      prefix: latexMatch[1],
      num: latexMatch[2],
      den: latexMatch[3],
      suffix: latexMatch[4]
    };
  }

  const fracTag = expr.match(/^(.*?)<frac>([^\/]+)\/([^<]+)<\/frac>(.*)$/i);
  if (fracTag) {
    return {
      prefix: fracTag[1],
      num: fracTag[2],
      den: fracTag[3],
      suffix: fracTag[4]
    };
  }

  // 2. Двойная дробь: A/B = C/D
  const doubleMatch = expr.match(/^([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)$/);
  if (doubleMatch) {
    return {
      isDouble: true,
      num1: doubleMatch[1],
      den1: doubleMatch[2],
      num2: doubleMatch[3],
      den2: doubleMatch[4]
    };
  }

  // 3. Уравнение с дробью: I = cos(φ)/(P·V), A = (B·C)/D, x = (y-b)/k, a = F/m
  if (expr.includes('=')) {
    const sides = expr.split('=');
    if (sides.length === 2) {
      const left = sides[0].trim();
      const right = sides[1].trim();
      if (!left.includes('/') && right.includes('/')) {
        const slashIdx = findMainSlash(right);
        const num = stripOuterParens(right.slice(0, slashIdx));
        const den = stripOuterParens(right.slice(slashIdx + 1));
        if (num && den && !/[а-яА-ЯёЁғӣӯҳҷқ]{4,}/.test(num) && !/[а-яА-ЯёЁғӣӯҳҷқ]{4,}/.test(den)) {
          return { prefix: left + ' = ', num, den, suffix: '' };
        }
      }
    }
  }

  // 4. Одиночная дробь: (B·C)/D, P/(V·cos(φ)), (y-b)/k, F/m
  if (expr.includes('/')) {
    const slashIdx = findMainSlash(expr);
    const num = stripOuterParens(expr.slice(0, slashIdx));
    const den = stripOuterParens(expr.slice(slashIdx + 1));
    if (num && den && !/[а-яА-ЯёЁғӣӯҳҷқ]{4,}/.test(num) && !/[а-яА-ЯёЁғӣӯҳҷқ]{4,}/.test(den)) {
      return { num, den };
    }
  }

  return null;
}

/**
 * Вспомогательный компонент для безопасного отображения текста с sub/sup тегами и вертикальными математическими дробями
 */
export const FormattedText: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  if (!text) return null;

  // 1. Проверяем, является ли весь текст целиком формулой с дробью (варианты ответов, уравнения)
  const frac = extractFraction(text);
  if (frac) {
    if (frac.isDouble) {
      return (
        <span className={`inline-flex items-center align-middle font-serif ${className || ''}`}>
          <span className="inline-flex flex-col items-center mx-0.5 text-[0.8em] leading-tight">
            <span className="border-b border-current px-1 pb-0.5 text-center"><FormattedText text={frac.num1 || ''} /></span>
            <span className="px-1 pt-0.5 text-center"><FormattedText text={frac.den1 || ''} /></span>
          </span>
          <span className="mx-1">=</span>
          <span className="inline-flex flex-col items-center mx-0.5 text-[0.8em] leading-tight">
            <span className="border-b border-current px-1 pb-0.5 text-center"><FormattedText text={frac.num2 || ''} /></span>
            <span className="px-1 pt-0.5 text-center"><FormattedText text={frac.den2 || ''} /></span>
          </span>
        </span>
      );
    }
    return (
      <span className={`inline-flex items-center align-middle font-serif ${className || ''}`}>
        {frac.prefix && <span className="mr-0.5">{frac.prefix}</span>}
        <span className="inline-flex flex-col items-center mx-0.5 text-[0.8em] leading-tight">
          <span className="border-b border-current px-1 pb-0.5 text-center"><FormattedText text={frac.num || ''} /></span>
          <span className="px-1 pt-0.5 text-center"><FormattedText text={frac.den || ''} /></span>
        </span>
        {frac.suffix && <span className="ml-0.5">{frac.suffix}</span>}
      </span>
    );
  }

  // 2. Если внутри текста содержится встроенная формула, например "Преобразуйте формулу A/B = C/D и выразите A:"
  const formulaEmbed = text.match(/^(.*?\b(?:формулу|выражение)?\s*)([A-Za-z0-9_]+\/[A-Za-z0-9_]+\s*=\s*[A-Za-z0-9_]+\/[A-Za-z0-9_]+|[A-Za-zα-ωΑ-Ω0-9_\s]+\s*=\s*[^:;,]+?)(\s+(?:и выразите|найдите|какова|чему|согласно).*)$/i);
  if (formulaEmbed) {
    const [, before, formulaStr, after] = formulaEmbed;
    if (extractFraction(formulaStr.trim())) {
      return (
        <span className={className}>
          <FormattedText text={before} />
          <FormattedText text={formulaStr.trim()} />
          <FormattedText text={after} />
        </span>
      );
    }
  }

  // 3. Обычная очистка и рендеринг тегов b, i, sub, sup
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
