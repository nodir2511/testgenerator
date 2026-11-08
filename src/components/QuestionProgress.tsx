import React from 'react';
import { AlertTriangle, CheckCircle2, Circle, ListChecks } from 'lucide-react';
import { Card, CardTitle } from './ui';
import { cn } from '../lib/cn';

export type StepStatus = 'done' | 'todo' | 'warn' | 'optional';
export interface ProgressStep {
  id: string;
  label: string;
  status: StepStatus;
  /** id блока формы, к которому ведёт шаг */
  target: string;
  /** Шаг обязателен: без него вопрос не сохранится */
  required?: boolean;
}

const goTo = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  el.querySelector<HTMLElement>('input, textarea, button, [role="combobox"]')?.focus({ preventScroll: true });
};

const ICON: Record<StepStatus, React.ReactNode> = {
  done: <CheckCircle2 className="w-5 h-5 text-success-solid shrink-0" aria-hidden />,
  todo: <Circle className="w-5 h-5 text-slate-400 shrink-0" aria-hidden />,
  warn: <AlertTriangle className="w-5 h-5 text-warning-solid shrink-0" aria-hidden />,
  optional: <Circle className="w-5 h-5 text-slate-300 shrink-0 [stroke-dasharray:3_3]" aria-hidden />,
};
const STATUS_TEXT: Record<StepStatus, string> = { done: 'готово', todo: 'нужно заполнить', warn: 'рекомендуется', optional: 'по желанию' };

/** Сколько обязательных шагов выполнено */
export const progressOf = (steps: ProgressStep[]) => {
  const req = steps.filter((s) => s.required);
  const done = req.filter((s) => s.status === 'done').length;
  return { done, total: req.length, percent: req.length ? Math.round((done / req.length) * 100) : 100 };
};

/** Готовность вопроса: что уже заполнено и что осталось. Каждый шаг ведёт к своему блоку формы */
export const QuestionProgress: React.FC<{ steps: ProgressStep[]; variant?: 'full' | 'compact' }> = ({ steps, variant = 'full' }) => {
  const { done, total, percent } = progressOf(steps);
  const ready = done === total;
  const bar = (
    <div
      role="progressbar"
      aria-label="Заполнено обязательных шагов"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className="h-2 rounded-full bg-slate-100 overflow-hidden"
    >
      <div className={cn('h-full rounded-full transition-all motion-reduce:transition-none', ready ? 'bg-success-solid' : 'bg-primary')} style={{ width: `${percent}%` }} />
    </div>
  );
  const summary = ready ? 'Можно сохранять' : `Заполнено ${done} из ${total}`;

  if (variant === 'compact') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 space-y-2.5" role="group" aria-label="Готовность вопроса">
        <div className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
          <span className="flex items-center gap-1.5"><ListChecks className="w-4 h-4 text-primary" aria-hidden /> Готовность вопроса</span>
          <span className={ready ? 'text-success' : 'text-slate-600'}>{summary}</span>
        </div>
        {bar}
        <div className="flex flex-wrap gap-1.5">
          {steps.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => goTo(s.target)}
              title={`${s.label} — ${STATUS_TEXT[s.status]}`}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {ICON[s.status]}<span>{s.label}</span><span className="sr-only"> — {STATUS_TEXT[s.status]}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card className="space-y-3">
      <CardTitle icon={ListChecks} action={<span className={cn('text-sm font-semibold', ready ? 'text-success' : 'text-slate-600')}>{summary}</span>}>Готовность вопроса</CardTitle>
      {bar}
      <ul className="space-y-0.5">
        {steps.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => goTo(s.target)}
              className="w-full min-h-[40px] flex items-center gap-2.5 rounded-xl px-2 text-left text-sm text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {ICON[s.status]}
              <span className={cn('flex-1 min-w-0', s.status === 'done' && 'text-slate-600')}>{s.label}</span>
              <span className={cn('text-xs shrink-0', s.status === 'warn' ? 'text-warning font-semibold' : 'text-slate-500')}>{STATUS_TEXT[s.status]}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
};
