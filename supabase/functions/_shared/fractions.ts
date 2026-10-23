// АВТОГЕНЕРАЦИЯ: scripts/sync-docx-shared.mjs. Не редактируйте вручную — правьте src/lib/fractions.ts.
// Разбор текста вопросов на обычный текст и вертикальные дроби.
// Используется и для показа на экране (FormattedText), и для экспорта в Word.
//
// Дробь — это «операнд/операнд», где операнды состоят из латиницы, греческих букв,
// цифр, индексов <sub>/<sup> и скобочных групп. Если рядом со слэшем кириллица
// (м/с, г/мол, кг·м/с, мол/(л∙с), и/или), это единица измерения или слово — не дробь.
// Числитель — произведение множителей (a·b/c = (a·b)/c), знаменатель — один множитель
// (a/b·c = (a/b)·c), как в обычной математической записи.

export type MathNode = string | { num: MathNode[]; den: MathNode[] };

const ATOM = /[A-Za-z0-9Α-Ωα-ωϑϕϵ∆√∞']/;
const MULT = /[·*•⋅∙×]/;
const CYR = /[А-Яа-яЁёҒғӢӣҚқӮӯҲҳҶҷ]/;
const MATHY = /[A-Za-z0-9Α-Ωα-ωϑϕϵ∆√∞]/;
const OPEN: Record<string, string> = { '(': ')', '[': ']' };
const CLOSE: Record<string, string> = { ')': '(', ']': '[' };

// Позиция открывающей скобки/тега для элемента, который заканчивается в позиции end (не включая end)
function factorStartBefore(s: string, end: number): number {
  let i = end;
  while (i > 0) {
    const c = s[i - 1];
    if (CLOSE[c]) {
      let depth = 0, j = i - 1;
      for (; j >= 0; j--) {
        if (s[j] === c) depth++;
        else if (s[j] === CLOSE[c]) { depth--; if (depth === 0) break; }
      }
      if (j < 0) return i;
      i = j;
    } else if (c === '>' && /<\/(sub|sup)>$/.test(s.slice(0, i))) {
      const tag = /<\/(sub|sup)>$/.exec(s.slice(0, i))![1];
      const open = s.lastIndexOf(`<${tag}>`, i - 1);
      if (open < 0) return i;
      i = open;
    } else if (ATOM.test(c) || (c === '.' && /\d/.test(s[i - 2] || '') && /\d/.test(s[i] || ''))) {
      i--;
    } else break;
  }
  return i;
}

// Конец множителя, начинающегося в позиции start
function factorEndAfter(s: string, start: number): number {
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (OPEN[c]) {
      let depth = 0, j = i;
      for (; j < s.length; j++) {
        if (s[j] === c) depth++;
        else if (s[j] === OPEN[c]) { depth--; if (depth === 0) break; }
      }
      if (j >= s.length) return i;
      i = j + 1;
    } else if (c === '<' && /^<(sub|sup)>/.test(s.slice(i))) {
      const tag = /^<(sub|sup)>/.exec(s.slice(i))![1];
      const close = s.indexOf(`</${tag}>`, i);
      if (close < 0) return i;
      i = close + tag.length + 3;
    } else if (ATOM.test(c) || (c === '.' && /\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || ''))) {
      i++;
    } else break;
  }
  return i;
}

function numeratorStart(s: string, slash: number): number {
  let start = factorStartBefore(s, slash);
  if (start === slash) return slash;
  while (start > 1 && MULT.test(s[start - 1])) {
    const prev = factorStartBefore(s, start - 1);
    if (prev === start - 1) break;
    start = prev;
  }
  return start;
}

function stripGroup(s: string): string {
  return s.length >= 2 && s[0] === '(' && closesAtEnd(s) ? s.slice(1, -1) : s;
}
function closesAtEnd(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return i === s.length - 1; }
  }
  return false;
}

const isOperand = (s: string) => MATHY.test(s.replace(/<\/?(sub|sup)>/g, '')) && !CYR.test(s);

// Ищет первую дробь на верхнем уровне скобок
function findFraction(s: string): { start: number; slash: number; end: number } | null {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (OPEN[c]) depth++;
    else if (CLOSE[c]) depth--;
    else if (c === '/' && depth === 0 && s[i - 1] !== '<') {
      const start = numeratorStart(s, i);
      const end = factorEndAfter(s, i + 1);
      if (start === i || end === i + 1) continue;
      const num = s.slice(start, i), den = s.slice(i + 1, end);
      if (!isOperand(num) || !isOperand(den)) continue;
      // кириллица вплотную к дроби: 2км/с, x/2км
      if (start > 0 && CYR.test(s[start - 1])) continue;
      if (end < s.length && CYR.test(s[end])) continue;
      return { start, slash: i, end };
    }
  }
  return null;
}

// Дроби внутри скобочных групп, когда на верхнем уровне дробей нет: r = [G·m/F]²
function splitGroups(s: string): MathNode[] {
  const out: MathNode[] = [];
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (!OPEN[s[i]]) continue;
    const end = factorEndAfter(s, i);
    let close = -1, depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === s[i]) depth++;
      else if (s[j] === OPEN[s[i]]) { depth--; if (depth === 0) { close = j; break; } }
    }
    if (close < 0 || end <= i) break;
    const inner = s.slice(i + 1, close);
    if (inner.includes('/')) {
      const parts = splitFractions(inner);
      if (parts.some((p) => typeof p !== 'string')) {
        out.push(s.slice(last, i + 1), ...parts, s[close]);
        last = close + 1;
      }
    }
    i = close;
  }
  out.push(s.slice(last));
  return merge(out);
}

function merge(nodes: MathNode[]): MathNode[] {
  const out: MathNode[] = [];
  for (const n of nodes) {
    if (typeof n === 'string') {
      if (!n) continue;
      if (typeof out[out.length - 1] === 'string') out[out.length - 1] += n;
      else out.push(n);
    } else out.push(n);
  }
  return out;
}

function normalizeExplicit(text: string): string {
  return text
    .replace(/<frac>([^/<]+)\/([^<]+)<\/frac>/gi, '($1)/($2)')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)');
}

export function splitFractions(text: string): MathNode[] {
  if (!text) return [];
  text = normalizeExplicit(text);
  if (!text.includes('/')) return [text];
  const f = findFraction(text);
  if (!f) return splitGroups(text);
  return merge([
    ...splitGroups(text.slice(0, f.start)),
    { num: splitFractions(stripGroup(text.slice(f.start, f.slash))), den: splitFractions(stripGroup(text.slice(f.slash + 1, f.end))) },
    ...splitFractions(text.slice(f.end)),
  ]);
}

export const hasFraction = (nodes: MathNode[]) => nodes.some((n) => typeof n !== 'string');

// ---- Вложенное форматирование (b, i, sub, sup) ----
export interface FmtState { b: number; i: number; u: number; sub: number; sup: number }
export interface FmtToken { text: string; b: boolean; i: boolean; u: boolean; sub: boolean; sup: boolean }
export const newFmtState = (): FmtState => ({ b: 0, i: 0, u: 0, sub: 0, sup: 0 });

// Режет текст по тегам <b> <i> <u> <sub> <sup> (в том числе вложенным) на куски с одинаковым оформлением.
// state переносится между вызовами: так тег, открытый до дроби, продолжает действовать после неё.
// Лишние закрывающие теги игнорируются, незакрытые действуют до конца.
export function tokenizeFormatted(text: string, state: FmtState): FmtToken[] {
  const out: FmtToken[] = [];
  const re = /<(\/?)(b|i|u|sub|sup)>/g;
  let last = 0;
  const push = (t: string) => {
    if (t) out.push({ text: t, b: state.b > 0, i: state.i > 0, u: state.u > 0, sub: state.sub > 0, sup: state.sup > 0 });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index));
    const k = m[2] as keyof FmtState;
    if (m[1]) state[k] = Math.max(0, state[k] - 1);
    else state[k]++;
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out;
}
