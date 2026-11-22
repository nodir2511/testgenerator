import React from 'react';
import { Button } from '../ui';

// Галочка с промежуточным состоянием (выбрана часть тем главы)
export const TriCheckbox: React.FC<{ checked: boolean; indeterminate: boolean; onChange: (v: boolean) => void; className?: string }> = ({ checked, indeterminate, onChange, className }) => {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={className} />;
};

// Счётчик «− число +» с крупными кнопками под палец
export const Stepper: React.FC<{ label: string; hint?: string; value: number; min: number; max: number; onChange: (v: number) => void }> = ({ label, hint, value, min, max, onChange }) => (
  <div className="flex items-center justify-between gap-3 py-2">
    <div className="min-w-0">
      <div className="text-sm font-semibold text-slate-800">{label}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
    <div className="flex items-center gap-1.5 shrink-0">
      <Button variant="secondary" className="w-10 h-10 bg-white text-lg" type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label={`${label}: меньше`}>
        −
      </Button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.min(max, Math.max(min, parseInt(e.target.value) || min)))}
        className="w-14 h-10 text-center text-base font-bold bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
        aria-label={label}
      />
      <Button variant="secondary" className="w-10 h-10 bg-white text-lg" type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label={`${label}: больше`}>
        +
      </Button>
    </div>
  </div>
);
