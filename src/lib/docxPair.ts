// Сопоставление русского и таджикского вариантов одного и того же документа Word.
// Чистая логика (без браузера): разбор документов делает docxParse, здесь — только пары.
import type { DocxParsedQuestion } from './docxParse';

export interface PairedOption { text: string; textTg: string; imageUrl?: string | null }
export interface PairedMatchingItem { side: 'left' | 'right'; text: string; textTg: string; imageUrl?: string | null; orderIndex: number }

export interface PairedQuestion {
  num: string;
  type: DocxParsedQuestion['type'];
  content: string;        // русский текст
  contentTg: string;      // таджикский текст
  imageUrl?: string | null;
  options?: PairedOption[];                // в порядке русского документа
  matchingItems?: PairedMatchingItem[];
  correctAnswer?: string;                  // буква варианта в порядке русского документа
  section?: string;
  sectionNum?: string;
  /** Ошибки не дают импортировать вопрос, предупреждения — только подсвечиваются */
  errors: string[];
  warnings: string[];
}

const SUPSUB: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '−': '-', '–': '-', '—': '-',
};
// Текст без тегов; индексы в виде <sup>23</sup> и в виде символов ²³ приводятся к одному виду
const plain = (s: string) =>
  (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉−–—]/g, (c) => SUPSUB[c] || c);

// Часть текста, одинаковая в обоих языках: формулы, числа, знаки (кириллица отбрасывается)
function neutralTokens(s: string): string[] {
  return plain(s)
    .replace(/[Ѐ-ԯ]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

function similarity(a: string, b: string): number {
  const ta = neutralTokens(a);
  const tb = neutralTokens(b);
  if (!ta.length || !tb.length) return 0;
  const pool = [...tb];
  let shared = 0;
  for (const t of ta) {
    const k = pool.indexOf(t);
    if (k >= 0) { shared++; pool.splice(k, 1); }
  }
  return shared / Math.max(ta.length, tb.length);
}

const letterIndex = (a?: string) => {
  const i = 'ABCDEF'.indexOf((a || '').trim().toUpperCase().charAt(0));
  return i >= 0 ? i : null;
};

/**
 * Для каждого русского варианта находит таджикский. Порядок вариантов в документах разный
 * (перемешан), поэтому опорная пара — правильный ответ из ключей обоих документов, остальные
 * ищутся по общим для языков частям (формулы, числа). Что не удалось надёжно — предупреждение.
 */
export function pairOptions(
  ru: string[],
  tg: string[],
  ruCorrect: number | null,
  tgCorrect: number | null
): { tgFor: number[]; warnings: string[] } {
  const n = ru.length;
  const warnings: string[] = [];
  const tgFor: number[] = new Array(n).fill(-1);
  const usedT = new Set<number>();

  if (ruCorrect !== null && tgCorrect !== null && ruCorrect < n && tgCorrect < n) {
    tgFor[ruCorrect] = tgCorrect;
    usedT.add(tgCorrect);
    const s = similarity(ru[ruCorrect], tg[tgCorrect]);
    if (s === 0 && neutralTokens(ru[ruCorrect]).length && neutralTokens(tg[tgCorrect]).length) {
      warnings.push('Правильный ответ в русском и таджикском файлах выглядит по-разному — проверьте ключи');
    }
  } else {
    warnings.push('Нет ключа ответа в одном из файлов — варианты сопоставлены без опорной пары');
  }

  const cands: Array<{ i: number; j: number; s: number }> = [];
  for (let i = 0; i < n; i++) {
    if (tgFor[i] >= 0) continue;
    for (let j = 0; j < n; j++) {
      if (usedT.has(j)) continue;
      cands.push({ i, j, s: similarity(ru[i], tg[j]) });
    }
  }
  cands.sort((a, b) => b.s - a.s || Math.abs(a.i - a.j) - Math.abs(b.i - b.j) || a.i - b.i);
  let ambiguous = false;
  for (const c of cands) {
    if (c.s <= 0) break;
    if (tgFor[c.i] >= 0 || usedT.has(c.j)) continue;
    // неоднозначно, если для этого русского варианта есть другой таджикский с таким же счётом
    if (cands.some((o) => o !== c && o.i === c.i && o.s === c.s && !usedT.has(o.j))) ambiguous = true;
    tgFor[c.i] = c.j;
    usedT.add(c.j);
  }
  const left = [...Array(n).keys()].filter((j) => !usedT.has(j));
  let byOrder = false;
  for (let i = 0; i < n; i++) {
    if (tgFor[i] < 0) { tgFor[i] = left.shift()!; byOrder = true; }
  }
  if (byOrder) warnings.push('Неверные варианты в двух файлах отличаются (разные значения или только слова), они сопоставлены по порядку; правильный вариант сопоставлен по ключам');
  else if (ambiguous) warnings.push('Есть похожие варианты — проверьте, что таджикский текст вариантов стоит на своих местах');
  return { tgFor, warnings };
}

export function pairBilingual(ru: DocxParsedQuestion[], tg: DocxParsedQuestion[]): PairedQuestion[] {
  const bySection = (list: DocxParsedQuestion[]) => {
    const m = new Map<string, DocxParsedQuestion[]>();
    for (const q of list) {
      const k = q.sectionNum ?? '0';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(q);
    }
    return m;
  };
  const tgSections = bySection(tg);
  const out: PairedQuestion[] = [];

  bySection(ru).forEach((rList, sec) => {
    const tList = tgSections.get(sec);
    let j = 0;
    for (const r of rList) {
      const base: PairedQuestion = {
        num: r.num, type: r.type, content: r.content, contentTg: '', imageUrl: r.imageUrl,
        correctAnswer: r.correctAnswer, section: r.section, sectionNum: sec, errors: [], warnings: [],
      };
      if (!tList) {
        base.errors.push('Этого раздела нет в таджикском файле');
        out.push(base);
        continue;
      }
      // Ищем то же задание: тот же номер; допускаем пропуск до 3 лишних заданий в таджикском файле
      let k = j;
      while (k < tList.length && k < j + 4 && tList[k].num !== r.num) k++;
      const t = k < tList.length && tList[k].num === r.num ? tList[k] : null;
      if (!t) {
        base.errors.push(`В таджикском файле не найден вопрос №${r.num} этого раздела`);
        out.push(base);
        continue;
      }
      if (k !== j) base.warnings.push(`В таджикском файле перед этим вопросом пропущено заданий: ${k - j}`);
      j = k + 1;

      base.contentTg = t.content;
      base.imageUrl = r.imageUrl || t.imageUrl;
      if (t.type !== r.type) {
        base.errors.push(`Тип вопроса отличается: русский — ${r.type}, таджикский — ${t.type}`);
      } else if (r.type === 'test') {
        const ro = r.options || [];
        const to = t.options || [];
        if (ro.length !== to.length) {
          base.errors.push(`Число вариантов отличается: русский ${ro.length}, таджикский ${to.length}`);
        } else {
          const { tgFor, warnings } = pairOptions(
            ro.map((o) => o.text),
            to.map((o) => o.text),
            letterIndex(r.correctAnswer),
            letterIndex(t.correctAnswer)
          );
          base.warnings.push(...warnings);
          base.options = ro.map((o, i) => ({
            text: o.text,
            textTg: to[tgFor[i]].text,
            imageUrl: o.imageUrl || to[tgFor[i]].imageUrl || null,
          }));
        }
      } else if (r.type === 'matching') {
        const ri = r.matchingItems || [];
        const ti = t.matchingItems || [];
        if (ri.length !== ti.length) {
          base.errors.push(`Число элементов соответствия отличается: русский ${ri.length}, таджикский ${ti.length}`);
        } else {
          base.warnings.push('Элементы соответствия сопоставлены по порядку — проверьте таджикский текст');
          const bySide = (side: 'left' | 'right') => ti.filter((m) => m.side === side);
          const counters = { left: 0, right: 0 };
          base.matchingItems = ri.map((m) => {
            const mate = bySide(m.side)[counters[m.side]++];
            return { side: m.side, text: m.text, textTg: mate?.text || '', imageUrl: m.imageUrl || mate?.imageUrl || null, orderIndex: m.orderIndex };
          });
        }
      } else {
        const a = (r.correctAnswer || '').trim();
        const b = (t.correctAnswer || '').trim();
        if (a && b && a !== b) base.warnings.push(`Ответы отличаются: русский «${a}», таджикский «${b}»`);
        if (!a && b) base.correctAnswer = b;
      }
      out.push(base);
    }
  });
  return out;
}
