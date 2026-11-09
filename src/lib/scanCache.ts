import { supabase } from './supabase';
import { answerView, type AnswerView, type AnyIssue, type BankQ } from './bankScan';

// Кэш результата проверки банка (раздел «Качество банка») в браузере главного админа: повторный вход не ждёт
// полной проверки предмета. Сверка с базой — одним лёгким запросом: сколько вопросов в предмете и когда
// последний раз что-то менялось (правка, удаление, импорт). Совпало — банк не менялся, результат актуален.

export type CompactQ = Pick<BankQ, 'id' | 'type' | 'num' | 'content' | 'chapter' | 'topic' | 'linked_ids'> & { view?: AnswerView };
export interface CachedScan {
  v: 2;
  at: number;
  fingerprint: string;
  total: number;
  questions: CompactQ[];
  issues: Array<{ id: string; codes: AnyIssue[] }>;
  pairs: Array<{ a: string; b: string; score: number; exact: boolean; answerDiffers: boolean }>;
}

const key = (subjectId: string) => `examiner_quality_scan_${subjectId}`;
const MAX_CHARS = 3_000_000;

export const compactQuestion = (q: BankQ): CompactQ => ({
  id: q.id, type: q.type, num: q.num, content: q.content.length > 240 ? q.content.slice(0, 240) : q.content,
  chapter: q.chapter ? { name: q.chapter.name } : null, topic: q.topic ? { name: q.topic.name } : null, linked_ids: q.linked_ids ?? [], view: answerView(q),
});

/** Отпечаток предмета: число неудалённых вопросов и время последнего изменения любого вопроса (в т. ч. удаления) */
export async function subjectFingerprint(subjectId: string): Promise<string> {
  const [count, last] = await Promise.all([
    supabase.from('questions').select('id', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('is_deleted', false),
    supabase.from('questions').select('updated_at').eq('subject_id', subjectId).order('updated_at', { ascending: false }).limit(1),
  ]);
  if (count.error) throw count.error;
  if (last.error) throw last.error;
  return `${count.count ?? 0}|${last.data?.[0]?.updated_at ?? ''}`;
}

export function readScanCache(subjectId: string): CachedScan | null {
  try {
    const raw = localStorage.getItem(key(subjectId));
    const c = raw ? (JSON.parse(raw) as CachedScan) : null;
    return c && c.v === 2 && Array.isArray(c.pairs) && Array.isArray(c.issues) && Array.isArray(c.questions) ? c : null;
  } catch { return null; }
}

export function writeScanCache(subjectId: string, c: CachedScan) {
  try {
    const raw = JSON.stringify(c);
    if (raw.length > MAX_CHARS) { localStorage.removeItem(key(subjectId)); return; }
    localStorage.setItem(key(subjectId), raw);
  } catch { /* память браузера недоступна или переполнена — работаем без кэша */ }
}
