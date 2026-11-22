// Прохождение билета в Telegram: чистая логика (снимок без ответов, подсчёт баллов, сроки, разбор ошибок).
// Модуль без импортов: его подключает Edge Function tg-app, тесты — напрямую.
// Баллы те же, что в omrScore.ts: тест — 1; соответствие — по 1 за каждый верный пункт; открытый вопрос — 2.

export const EXAM_MINUTES = 30;
export const EXAM_LINK_HOURS = 24;

/** тест: id варианта; соответствие: { idЛевого: idПравого }; открытый: строка с числом */
export type ExamAnswer = string | Record<string, string> | null;
/** ключ — id строки ticket_questions */
export type ExamAnswers = Record<string, ExamAnswer>;
export interface ExamQuestion { tqId: string; snapshot: any }

const POINTS = { test: 1, matchingRow: 1, open: 2 } as const;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const isEmpty = (snap: any) => !snap || snap.empty === true;

/** Снимок для ученика: без is_correct, correct_match_id и correct_numeric_answer. Исходный не меняется. */
export function publicSnapshot(snap: any): any {
  if (isEmpty(snap)) return snap;
  const out: any = { ...snap };
  delete out.correct_numeric_answer;
  if (Array.isArray(snap.options)) {
    out.options = snap.options.map((o: any) => { const { is_correct, ...rest } = o; return rest; });
  }
  if (Array.isArray(snap.matching_items)) {
    out.matching_items = snap.matching_items.map((m: any) => { const { correct_match_id, ...rest } = m; return rest; });
  }
  return out;
}

/** «12,5» → 12.5; не число → null */
export function parseOpen(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim().replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const sortByOrder = (a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0);
const lefts = (snap: any): any[] => (snap.matching_items ?? []).filter((m: any) => m.side === 'left').sort(sortByOrder);

function scoreOne(snap: any, ans: ExamAnswer | undefined): { points: number; max: number; answered: boolean } {
  if (isEmpty(snap)) return { points: 0, max: 0, answered: false };
  if (snap.type === 'matching') {
    const rows = lefts(snap);
    const a = ans && typeof ans === 'object' ? ans : {};
    const points = rows.filter((l) => l.correct_match_id != null && a[l.id] === l.correct_match_id).length * POINTS.matchingRow;
    return { points, max: rows.length * POINTS.matchingRow, answered: Object.values(a).some((v) => !!v) };
  }
  if (snap.type === 'open') {
    const given = typeof ans === 'string' ? parseOpen(ans) : null;
    const key = snap.correct_numeric_answer == null ? null : Number(snap.correct_numeric_answer);
    const ok = given !== null && key !== null && Number.isFinite(key) && Math.abs(given - key) < 1e-9;
    return { points: ok ? POINTS.open : 0, max: POINTS.open, answered: typeof ans === 'string' && ans.trim() !== '' };
  }
  const chosen = typeof ans === 'string' && ans !== '' ? ans : null;
  const ok = chosen !== null && (snap.options ?? []).some((o: any) => o.id === chosen && o.is_correct === true);
  return { points: ok ? POINTS.test : 0, max: POINTS.test, answered: chosen !== null };
}

export function scoreAttempt(questions: ExamQuestion[], answers: ExamAnswers) {
  const items = questions.map((q) => ({ tqId: q.tqId, ...scoreOne(q.snapshot, answers[q.tqId]) }));
  return { score: items.reduce((s, i) => s + i.points, 0), max: items.reduce((s, i) => s + i.max, 0), items };
}

export function pickVariant<T>(tickets: T[], rnd: () => number = Math.random): T {
  if (!tickets.length) throw new Error('В наборе нет билетов');
  return tickets[Math.min(tickets.length - 1, Math.floor(rnd() * tickets.length))];
}

export function examCode(rnd: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.floor(rnd() * CODE_ALPHABET.length))];
  return s;
}

/** '/start exam_K7M2QX' → 'K7M2QX' */
export function parseStartPayload(text: string): string | null {
  const m = /^\/start(?:@\w+)?\s+exam_([A-Za-z0-9]{6})\s*$/.exec((text ?? '').trim());
  if (!m) return null;
  const code = m[1].toUpperCase();
  return [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

/** min(старт + minutes, закрытие ссылки) */
export function deadlineOf(startedAt: Date, linkClosesAt: Date, minutes: number = EXAM_MINUTES): Date {
  return new Date(Math.min(startedAt.getTime() + minutes * 60_000, linkClosesAt.getTime()));
}

export function attemptState(a: { finished_at: string | null; deadline_at: string }, now: Date): 'running' | 'expired' | 'finished' {
  if (a.finished_at) return 'finished';
  return new Date(a.deadline_at).getTime() <= now.getTime() ? 'expired' : 'running';
}

// ---------- текст для чата ----------
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎' };
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾' };

function script(inner: string, map: Record<string, string>, fallback: string): string {
  const chars = [...inner];
  if (chars.length && chars.every((c) => map[c])) return chars.map((c) => map[c]).join('');
  return chars.length === 1 ? fallback + inner : `${fallback}(${inner})`;
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescHtml = (s: string) => s.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');

/** Разметка сайта → простой текст для Telegram (parse_mode HTML: «<», «>», «&» экранированы). Дробь — «числитель/знаменатель». */
export function tgPlain(text: string): string {
  let s = String(text ?? '');
  s = s.replace(/<frac>\s*([^/<]+)\/([^<]+)<\/frac>/gi, '$1/$2').replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2');
  s = s.replace(/<sub>([\s\S]*?)<\/sub>/gi, (_, t) => script(t, SUB, '_'));
  s = s.replace(/<sup>([\s\S]*?)<\/sup>/gi, (_, t) => script(t, SUP, '^'));
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-zA-Z][^>]*>/g, '');
  return escHtml(unescHtml(s));
}

// ---------- разбор ошибок ----------
type Lang = 'ru' | 'tg';
const pick = (o: any, lang: Lang, base = 'text') => String((lang === 'tg' ? o?.[`${base}_tg`] : o?.[`${base}_ru`]) ?? o?.[base] ?? '');
const NONE = '—';

function givenAndRight(snap: any, ans: ExamAnswer | undefined, lang: Lang): { given: string; right: string } {
  if (snap.type === 'matching') {
    const rightsById = new Map<string, any>((snap.matching_items ?? []).filter((m: any) => m.side === 'right').map((m: any) => [m.id, m]));
    const a = ans && typeof ans === 'object' ? ans : {};
    const pair = (l: any, rid: string | null | undefined) => `${tgPlain(pick(l, lang))} — ${rid && rightsById.has(rid) ? tgPlain(pick(rightsById.get(rid), lang)) : NONE}`;
    const rows = lefts(snap);
    return { given: rows.map((l) => pair(l, a[l.id])).join('; '), right: rows.map((l) => pair(l, l.correct_match_id)).join('; ') };
  }
  if (snap.type === 'open') {
    const k = snap.correct_numeric_answer;
    return { given: typeof ans === 'string' && ans.trim() ? escHtml(ans.trim()) : NONE, right: k == null ? NONE : String(k) };
  }
  const opts: any[] = snap.options ?? [];
  const mine = typeof ans === 'string' ? opts.find((o) => o.id === ans) : null;
  const right = opts.find((o) => o.is_correct);
  return { given: mine ? tgPlain(pick(mine, lang)) : NONE, right: right ? tgPlain(pick(right, lang)) : NONE };
}

/** Только вопросы с потерянными баллами: номер, текст, «Ваш ответ», «Верный ответ». Один элемент — один вопрос. */
export function reviewLines(questions: ExamQuestion[], answers: ExamAnswers, lang: Lang): string[] {
  const out: string[] = [];
  questions.forEach((q, i) => {
    const r = scoreOne(q.snapshot, answers[q.tqId]);
    if (r.points >= r.max) return;
    const snap = q.snapshot;
    const { given, right } = givenAndRight(snap, answers[q.tqId], lang);
    const pic = snap.image_url ? ' [рисунок]' : '';
    out.push(`${i + 1}.${pic} ${tgPlain(pick(snap, lang, 'content'))}\nВаш ответ: ${given}\nВерный ответ: ${right}`);
  });
  return out.length ? out : ['Ошибок нет'];
}

/** Сообщения не длиннее limit знаков; строка длиннее limit режется. */
export function chunkLines(lines: string[], limit = 3800): string[] {
  const parts: string[] = [];
  let cur = '';
  const flush = () => { if (cur) { parts.push(cur); cur = ''; } };
  for (const line of lines) {
    for (let from = 0; from === 0 || from < line.length; from += limit) {
      const piece = line.slice(from, from + limit);
      if (cur && cur.length + 1 + piece.length > limit) flush();
      cur = cur ? `${cur}\n${piece}` : piece;
    }
  }
  flush();
  return parts;
}
