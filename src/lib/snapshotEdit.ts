// Правка вопроса внутри набора билетов: меняется только снимок вопроса в билете (уходит в Word), банк вопросов не трогается.
// Чистая логика без интерфейса и без обращений к базе.
import type { RowChange } from './questionSwap';

/** Текст на двух языках; tg = null — у вопроса один язык, поле одно */
export interface TextPair { ru: string; tg: string | null }

export interface SnapshotDraft {
  /** Русский и таджикский тексты в снимке различаются — правятся отдельно */
  bilingual: boolean;
  content: TextPair;
  /** Варианты ответа теста, в порядке билета */
  options: Array<{ id: string; text: TextPair; hasImage: boolean }>;
  /** Пункты соответствия, в порядке снимка */
  items: Array<{ id: string; side: 'left' | 'right'; text: TextPair; hasImage: boolean }>;
}

type Prefix = 'content' | 'text';
const ruOf = (node: any, p: Prefix): string => node?.[`${p}_ru`] || node?.[p] || '';
const tgOf = (node: any, p: Prefix): string => node?.[`${p}_tg`] || node?.[p] || '';
const byOrder = (a: any, b: any) => (a.order_index || 0) - (b.order_index || 0);

const isEmpty = (snap: any) => !snap || snap.empty === true;

/** Черновик правки по снимку; null — править нечего (пустое место) */
export function draftOf(snap: any): SnapshotDraft | null {
  if (isEmpty(snap)) return null;
  const options: any[] = snap.type === 'test' ? [...(snap.options || [])].sort(byOrder) : [];
  const items: any[] = snap.type === 'matching' ? [...(snap.matching_items || [])] : [];
  const bilingual = ruOf(snap, 'content') !== tgOf(snap, 'content') || [...options, ...items].some((n) => ruOf(n, 'text') !== tgOf(n, 'text'));
  const pair = (node: any, p: Prefix): TextPair => ({ ru: ruOf(node, p), tg: bilingual ? tgOf(node, p) : null });
  return {
    bilingual,
    content: pair(snap, 'content'),
    options: options.map((o) => ({ id: String(o.id), text: pair(o, 'text'), hasImage: !!o.image_url })),
    items: items.map((m) => ({ id: String(m.id), side: m.side, text: pair(m, 'text'), hasImage: !!m.image_url })),
  };
}

/** Узел снимка с новым текстом: один язык — текст во все языковые поля, два — по своим */
function withText(node: any, p: Prefix, text: TextPair): any {
  const ru = text.ru;
  const tg = text.tg === null ? text.ru : text.tg;
  if (ruOf(node, p) === ru && tgOf(node, p) === tg) return node;
  return { ...node, [p]: ru, [`${p}_ru`]: ru, [`${p}_tg`]: tg };
}

/** Снимок с правками черновика. Ничего не изменилось — возвращается тот же объект. */
export function applyDraft(snap: any, draft: SnapshotDraft): any {
  if (isEmpty(snap)) return snap;
  let changed = false;
  const patch = (list: any[] | undefined, edits: Array<{ id: string; text: TextPair }>) => {
    if (!Array.isArray(list)) return list;
    const byId = new Map(edits.map((e) => [e.id, e.text]));
    return list.map((node) => {
      const text = byId.get(String(node.id));
      if (!text) return node;
      const next = withText(node, 'text', text);
      if (next !== node) changed = true;
      return next;
    });
  };
  const base = withText(snap, 'content', draft.content);
  if (base !== snap) changed = true;
  const options = patch(snap.options, draft.options);
  const matching = patch(snap.matching_items, draft.items);
  if (!changed) return snap;
  const out = { ...base, edited: true };
  if (options !== undefined) out.options = options;
  if (matching !== undefined) out.matching_items = matching;
  return out;
}

/** Почему черновик нельзя сохранить; null — можно */
export function draftProblem(snap: any, draft: SnapshotDraft): string | null {
  const blank = (t: TextPair) => !t.ru.trim() || (t.tg !== null && !t.tg.trim());
  const hadContent = !!(ruOf(snap, 'content').trim() || tgOf(snap, 'content').trim());
  if (hadContent && blank(draft.content)) return 'Заполните условие вопроса' + (draft.bilingual ? ' на обоих языках' : '');
  if (draft.options.some((o) => !o.hasImage && blank(o.text))) return 'Заполните текст каждого варианта ответа' + (draft.bilingual ? ' на обоих языках' : '');
  if (draft.items.some((m) => !m.hasImage && blank(m.text))) return 'Заполните текст каждого пункта соответствия' + (draft.bilingual ? ' на обоих языках' : '');
  return null;
}

interface TicketLike { questions: Array<{ id: string; question_id: string | null; question_snapshot: any }> }

/**
 * Строки для update_batch_questions: правка места tqId и всех мест набора с тем же вопросом
 * («переставленные варианты» НЦТ ставят один вопрос в парные варианты). Без изменений — пусто.
 */
export function rowsForEdit(tickets: TicketLike[], tqId: string, draft: SnapshotDraft): RowChange[] {
  const all = tickets.flatMap((t) => t.questions);
  const target = all.find((q) => q.id === tqId);
  if (!target) return [];
  const same = target.question_id ? all.filter((q) => q.question_id === target.question_id) : [target];
  return same.flatMap((q) => {
    const next = applyDraft(q.question_snapshot, draft);
    return next === q.question_snapshot ? [] : [{ ticket_question_id: q.id, question_id: q.question_id, question_snapshot: next }];
  });
}
