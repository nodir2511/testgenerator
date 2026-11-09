// Поиск дубликатов и похожих вопросов (без ИИ): сходство по триграммам символов.
// Текст приводится к единому виду (без тегов, регистра, знаков препинания, ё = е), поэтому находит
// одинаковые и «почти слово в слово» вопросы. Смысловые перефразировки не находит.
// Для быстроты есть индекс по триграммам: вопрос сравнивается не со всем банком, а с кандидатами.

export interface DupVariant {
  content: string;
  /** Варианты теста или пункты соответствия (порядок не важен) */
  options?: string[];
  /** Правильный ответ этой языковой версии (тексты верных вариантов, пары соответствия); не задан — неизвестен */
  answer?: string[] | null;
}
export interface DupDoc {
  id: string;
  /** По одному варианту на язык: русский, таджикский */
  variants: DupVariant[];
  /** Ответ открытого вопроса: с разными ответами вопросы не считаются одинаковыми */
  answer?: string | null;
}
/** answerDiffers: вопрос тот же, но правильные ответы разные — это не повтор, а противоречие, одна из записей ошибочна */
export interface DupMatch { id: string; score: number; exact: boolean; answerDiffers: boolean }

export const normalizeText = (s?: string | null) =>
  (s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;| /g, ' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,;:!?"'«»()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const grams = (s: string): Set<string> => {
  const out = new Set<string>();
  const t = ` ${s} `;
  if (t.length < 4) { if (s) out.add(t); return out; }
  for (let i = 0; i <= t.length - 3; i++) out.add(t.slice(i, i + 3));
  return out;
};

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const g of small) if (big.has(g)) inter++;
  return inter / (a.size + b.size - inter);
};

interface Prepared { content: string; contentGrams: Set<string>; options: string; optionGrams: Set<string>; hasOptions: boolean; answer: string | null }
interface PreparedDoc { id: string; variants: Prepared[]; answer: string | null }

function prepare(doc: DupDoc): PreparedDoc {
  const variants = doc.variants
    .map((v) => {
      const content = normalizeText(v.content);
      const opts = (v.options ?? []).map(normalizeText).filter(Boolean).sort();
      const options = opts.join(' | ');
      const ans = (v.answer ?? []).map(normalizeText).filter(Boolean).sort().join(' | ');
      return { content, contentGrams: grams(content), options, optionGrams: grams(options), hasOptions: opts.length > 0, answer: ans || null };
    })
    .filter((v) => v.content !== '');
  return { id: doc.id, variants, answer: doc.answer == null || doc.answer === '' ? null : String(doc.answer).trim() };
}

function pairScore(a: Prepared, b: Prepared): { score: number; exact: boolean } {
  const c = a.content === b.content ? 1 : jaccard(a.contentGrams, b.contentGrams);
  if (!a.hasOptions || !b.hasOptions) return { score: c, exact: a.content === b.content && a.hasOptions === b.hasOptions };
  const o = a.options === b.options ? 1 : jaccard(a.optionGrams, b.optionGrams);
  // Одинаковая формулировка с совсем другими вариантами — это разные вопросы
  return { score: 0.6 * c + 0.4 * o, exact: a.content === b.content && a.options === b.options };
}

function docScore(a: PreparedDoc, b: PreparedDoc): { score: number; exact: boolean; answerDiffers: boolean } {
  let best = { score: 0, exact: false, answerDiffers: false };
  for (const va of a.variants) for (const vb of b.variants) {
    const r = pairScore(va, vb);
    if (r.score > best.score || (r.score === best.score && r.exact)) {
      best = { ...r, answerDiffers: va.answer !== null && vb.answer !== null && va.answer !== vb.answer };
    }
  }
  // Открытый вопрос: числовой ответ хранится на уровне вопроса
  if (a.answer !== null && b.answer !== null && a.answer !== b.answer) best.answerDiffers = true;
  return best;
}

export interface DupIndex {
  docs: PreparedDoc[];
  postings: Map<string, number[]>;
  cap: number;
}

export function buildIndex(docs: DupDoc[]): DupIndex {
  const prepared = docs.map(prepare);
  const postings = new Map<string, number[]>();
  prepared.forEach((d, i) => {
    const seen = new Set<string>();
    for (const v of d.variants) for (const g of v.contentGrams) {
      if (seen.has(g)) continue;
      seen.add(g);
      const list = postings.get(g);
      if (list) list.push(i); else postings.set(g, [i]);
    }
  });
  // Слишком частые триграммы («ого », « по ») кандидатов не отбирают
  return { docs: prepared, postings, cap: Math.max(200, Math.floor(prepared.length * 0.05)) };
}

export interface FindOptions {
  /** С какого сходства считать вопрос похожим (0…1) */
  threshold?: number;
  max?: number;
  /** Не сравнивать с вопросами, чей номер в индексе не меньше этого (чтобы пара не находилась дважды) */
  onlyBefore?: number;
}

/** Похожие вопросы индекса на doc. doc.id в результат не попадает. */
export function findSimilar(index: DupIndex, doc: DupDoc, opts: FindOptions = {}): DupMatch[] {
  const { threshold = 0.85, max = 3, onlyBefore = Infinity } = opts;
  const me = prepare(doc);
  const counts = new Map<number, number>();
  const seen = new Set<string>();
  for (const v of me.variants) for (const g of v.contentGrams) {
    if (seen.has(g)) continue;
    seen.add(g);
    const list = index.postings.get(g);
    if (!list || list.length > index.cap) continue;
    for (const i of list) if (i < onlyBefore) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const candidates = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const out: DupMatch[] = [];
  for (const [i] of candidates) {
    const other = index.docs[i];
    if (other.id === me.id) continue;
    const r = docScore(me, other);
    if (r.score >= threshold) out.push({ id: other.id, score: r.score, exact: r.exact && !r.answerDiffers, answerDiffers: r.answerDiffers });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/** Пары похожих вопросов внутри одного набора (каждая пара один раз) */
export function findPairs(docs: DupDoc[], opts: Omit<FindOptions, 'onlyBefore' | 'max'> = {}): Array<{ a: string; b: string; score: number; exact: boolean; answerDiffers: boolean }> {
  const index = buildIndex(docs);
  const pairs: Array<{ a: string; b: string; score: number; exact: boolean; answerDiffers: boolean }> = [];
  docs.forEach((d, i) => {
    for (const m of findSimilar(index, d, { ...opts, max: 5, onlyBefore: i })) pairs.push({ a: m.id, b: d.id, score: m.score, exact: m.exact, answerDiffers: m.answerDiffers });
  });
  return pairs.sort((x, y) => y.score - x.score);
}
