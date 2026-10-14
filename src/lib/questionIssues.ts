// Проверка качества вопросов: чего не хватает или что выбивается из стандарта.
// Стандарт: тест — 4 варианта (A–D), один верный; соответствие — слева A–D (4), справа 1–5 (5),
// у каждого левого пункта задан правильный ответ; открытый — задан числовой ответ.

export const STD = { testOptions: 4, matchLeft: 4, matchRight: 5 };

export type IssueCode =
  | 'no_answer'      // нет правильного ответа
  | 'multi_correct'  // у теста больше одного верного варианта
  | 'options_count'  // число вариантов A–D не 4
  | 'left_count'     // слева не 4 (A–D)
  | 'right_count';   // справа не 5 (1–5)

export const ISSUE_LABELS: Record<IssueCode, string> = {
  no_answer: 'нет правильного ответа',
  multi_correct: 'несколько верных вариантов',
  options_count: 'вариантов не 4',
  left_count: 'слева (A–D) не 4',
  right_count: 'справа (1–5) не 5',
};

type Q = {
  type: string;
  correct_numeric_answer?: number | null;
  options?: Array<{ is_correct?: boolean | null }> | null;
  matching_items?: Array<{ id: string; side: string; correct_match_id?: string | null }> | null;
};

export function questionIssues(q: Q): IssueCode[] {
  const out: IssueCode[] = [];
  if (q.type === 'test') {
    const opts = q.options || [];
    const correct = opts.filter((o) => o.is_correct).length;
    if (correct === 0) out.push('no_answer');
    if (correct > 1) out.push('multi_correct');
    if (opts.length !== STD.testOptions) out.push('options_count');
  } else if (q.type === 'matching') {
    const items = q.matching_items || [];
    const left = items.filter((m) => m.side === 'left');
    const right = items.filter((m) => m.side === 'right');
    const rightIds = new Set(right.map((r) => r.id));
    if (left.length === 0 || left.some((m) => !m.correct_match_id || !rightIds.has(m.correct_match_id))) out.push('no_answer');
    if (left.length !== STD.matchLeft) out.push('left_count');
    if (right.length !== STD.matchRight) out.push('right_count');
  } else if (q.type === 'open') {
    if (q.correct_numeric_answer === null || q.correct_numeric_answer === undefined) out.push('no_answer');
  }
  return out;
}

export type IssueFilter = 'all' | 'any' | 'no_answer' | 'count';

export const ISSUE_FILTER_LABELS: Record<IssueFilter, string> = {
  all: 'Все вопросы',
  any: 'Любые проблемы',
  no_answer: 'Без правильного ответа',
  count: 'Не по стандарту (A–D ≠ 4, 1–5 ≠ 5)',
};

export function matchesIssueFilter(issues: IssueCode[], f: IssueFilter): boolean {
  if (f === 'all') return true;
  if (f === 'any') return issues.length > 0;
  if (f === 'no_answer') return issues.includes('no_answer');
  return issues.some((i) => i === 'options_count' || i === 'left_count' || i === 'right_count');
}
