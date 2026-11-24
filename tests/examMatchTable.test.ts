import { describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MatchTable } from '../src/exam/ExamQuestion';
import type { Answer } from '../src/exam/examLogic';
import { scoreAttempt } from '../supabase/functions/_shared/exam';

const left = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const right = ['1', '2', '3', '4', '5'].map((id) => ({ id: `r${id}` }));

/** Все кнопки отрисованной таблицы вместе с их обработчиками */
function buttons(answer: Answer | undefined, onAnswer: (a: Answer) => void) {
  const out: Array<{ label: string; on: boolean; click: () => void }> = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    const e = n as ReactElement<Record<string, unknown>> | null;
    if (!e || typeof e !== 'object' || !('props' in e)) return;
    if (e.type === 'button') out.push({ label: String(e.props['aria-label']), on: e.props['aria-checked'] === true, click: e.props.onClick as () => void });
    walk(e.props.children);
  };
  walk(MatchTable({ left, right, answer, onAnswer }));
  return out;
}

describe('таблица ответа на соответствие (билет ученика в Telegram)', () => {
  it('4 строки A–D на 5 столбцов 1–5, отмечены только выбранные', () => {
    const b = buttons({ a: 'r3', d: 'r5' }, () => {});
    expect(b).toHaveLength(20);
    expect(b[0].label).toBe('A — 1');
    expect(b[19].label).toBe('D — 5');
    expect(b.filter((x) => x.on).map((x) => x.label)).toEqual(['A — 3', 'D — 5']);
    const html = renderToStaticMarkup(createElement(MatchTable, { left, right, answer: undefined, onAnswer: () => {} }));
    expect(html.replace(/<[^>]*>/g, '')).toBe('12345ABCD');
  });

  it('нажатие ставит ответ строки, другой столбец заменяет его, повторное нажатие снимает', () => {
    let a: Answer = null;
    const set = (v: Answer) => { a = v; };
    const press = (label: string) => buttons(a ?? undefined, set).find((x) => x.label === label)!.click();
    press('B — 4');
    expect(a).toEqual({ b: 'r4' });
    press('B — 2');
    expect(a).toEqual({ b: 'r2' });
    press('C — 2');
    expect(a).toEqual({ b: 'r2', c: 'r2' });
    press('B — 2');
    press('C — 2');
    expect(a).toBeNull();
  });

  it('незаполненная строка просто не даёт балла, остальные считаются', () => {
    const snapshot = { type: 'matching', matching_items: [
      ...left.map((l, i) => ({ ...l, side: 'left', order_index: i, correct_match_id: `r${i + 1}` })),
      ...right.map((r, i) => ({ ...r, side: 'right', order_index: i })),
    ] };
    const score = (a: Answer) => scoreAttempt([{ tqId: 'm', snapshot }], { m: a }).score;
    expect(score({ a: 'r1', b: 'r2', c: 'r3', d: 'r4' })).toBe(4);
    expect(score({ a: 'r1', c: 'r3' })).toBe(2);
    expect(score({ a: 'r1', c: 'r5' })).toBe(1);
    expect(score(null)).toBe(0);
  });
});
