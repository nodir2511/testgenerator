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

const pickKeys = (o: any, keys: string[]) => {
  const r: any = {};
  for (const k of keys) if (o?.[k] !== undefined) r[k] = o[k];
  return r;
};
const TEXT_KEYS = ['id', 'text', 'text_ru', 'text_tg', 'image_url', 'order_index'];

/** Снимок для ученика: только перечисленные поля (список разрешённых), поэтому ключи ответов и любые будущие поля не попадут. Исходный не меняется. */
export function publicSnapshot(snap: any): any {
  if (isEmpty(snap)) return snap;
  const out = pickKeys(snap, ['id', 'type', 'content', 'content_ru', 'content_tg', 'image_url', 'order_index', 'passage_order']);
  if (Array.isArray(snap.options)) out.options = snap.options.map((o: any) => pickKeys(o, TEXT_KEYS));
  if (Array.isArray(snap.matching_items)) out.matching_items = snap.matching_items.map((m: any) => pickKeys(m, [...TEXT_KEYS, 'side']));
  if (snap.passage && typeof snap.passage === 'object') out.passage = pickKeys(snap.passage, ['id', 'kind', 'title', 'content']);
  return out;
}

/** Снимок для разбора (после сдачи и отправки разбора): publicSnapshot плюс только три поля ключа. Пустое место — признак и тип. */
export function reviewSnapshot(snap: any): any {
  if (isEmpty(snap)) return snap ? { empty: true, type: snap.type ?? null } : snap;
  const out = publicSnapshot(snap);
  if (snap.correct_numeric_answer !== undefined) out.correct_numeric_answer = snap.correct_numeric_answer;
  if (Array.isArray(snap.options)) {
    out.options = snap.options.map((o: any) => ({ ...pickKeys(o, TEXT_KEYS), is_correct: o?.is_correct === true }));
  }
  if (Array.isArray(snap.matching_items)) {
    out.matching_items = snap.matching_items.map((m: any) => ({ ...pickKeys(m, [...TEXT_KEYS, 'side']), ...pickKeys(m, ['correct_match_id']) }));
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

/** Язык вопросов запуска: только 'tg' даёт таджикский, остальное — русский */
export const examLang = (v: unknown): 'ru' | 'tg' => (v === 'tg' ? 'tg' : 'ru');

/** Разбор отправляли меньше 10 секунд назад — вторую рассылку (двойной щелчок) не начинаем */
export const REVIEW_RESEND_GUARD_MS = 10_000;
export function reviewJustSent(reviewSentAt: string | null | undefined, now: Date): boolean {
  if (!reviewSentAt) return false;
  const ago = now.getTime() - new Date(reviewSentAt).getTime();
  return ago >= 0 && ago < REVIEW_RESEND_GUARD_MS;
}

export function attemptState(a: { finished_at: string | null; deadline_at: string }, now: Date): 'running' | 'expired' | 'finished' {
  if (a.finished_at) return 'finished';
  return new Date(a.deadline_at).getTime() <= now.getTime() ? 'expired' : 'running';
}

// ---------- свой порядок вариантов у каждого ученика ----------
/** FNV-1a (32 бита): строка → число для генератора */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** mulberry32: детерминированный генератор 0..1 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Копии пунктов в исходном порядке (order_index), затем перестановка Фишера — Йетса и order_index 0..n-1 */
function shuffled(items: any[], key: string): any[] {
  const out = [...items].sort(sortByOrder).map((x) => ({ ...x }));
  const rnd = rng(hash32(key));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  out.forEach((x, i) => { x.order_index = i; });
  return out;
}
// Смысл таких вариантов зависит от места («оба», «все перечисленные») — вопрос не перемешиваем
const POSITIONAL = /(^|[^\p{L}])(вс[её]\s+(выше)?перечисл|вс[её]\s+вышеуказанн|ни\s+од(ин|на|но|ни)\s+из|(оба|обе|ҳамаи|ҳама)(?!\p{L})|ҳеҷ\s+як)/iu;
const positional = (items: any[]) => items.some((o) => ['text', 'text_ru', 'text_tg'].some((k) => typeof o?.[k] === 'string' && POSITIONAL.test(o[k])));

/**
 * Копия снимка с перемешанными вариантами (тест) или пунктами (соответствие: левые и правые — независимо).
 * Порядок зависит только от seed (id попытки) и id вопроса. id, ключи и прочие поля не меняются, order_index — 0..n-1.
 * open, пустое место, один вариант и вопросы с вариантами вроде «все перечисленные» — как есть. Исходный снимок не меняется.
 */
export function shuffleOptions(snap: any, seed: string): any {
  if (isEmpty(snap) || snap.type === 'open') return snap;
  const base = `${seed}:${snap.id ?? ''}`;
  if (Array.isArray(snap.options) && snap.options.length > 1 && !positional(snap.options)) {
    return { ...snap, options: shuffled(snap.options, base) };
  }
  if (Array.isArray(snap.matching_items) && !positional(snap.matching_items)) {
    const l = snap.matching_items.filter((m: any) => m?.side === 'left');
    const r = snap.matching_items.filter((m: any) => m?.side === 'right');
    if (l.length < 2 && r.length < 2) return snap;
    const other = snap.matching_items.filter((m: any) => m?.side !== 'left' && m?.side !== 'right');
    return {
      ...snap,
      matching_items: [...(l.length > 1 ? shuffled(l, `${base}:left`) : l), ...(r.length > 1 ? shuffled(r, `${base}:right`) : r), ...other],
    };
  }
  return snap;
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

// b, i, u, lab1–9 — разметка вопросов сайта (fractions.ts); sub, sup, frac, br разобраны выше; em, strong, span, p — из вставленного текста
const KNOWN_TAG = /<\/?(?:b|i|u|em|strong|sub|sup|frac|lab[1-9]|(?:span|p)(?:\s+[a-z-]+=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*\/?>/gi;

/** Разметка сайта → простой текст для Telegram (parse_mode HTML: «<», «>», «&» экранированы). Дробь — «числитель/знаменатель». */
export function tgPlain(text: string): string {
  let s = String(text ?? '');
  s = s.replace(/<frac>\s*([^/<]+)\/([^<]+)<\/frac>/gi, '$1/$2').replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2');
  s = s.replace(/<sub>([\s\S]*?)<\/sub>/gi, (_, t) => script(t, SUB, '_'));
  s = s.replace(/<sup>([\s\S]*?)<\/sup>/gi, (_, t) => script(t, SUP, '^'));
  // Убираем только известную разметку сайта; всё остальное («x<y и z>w») остаётся текстом и экранируется ниже
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(KNOWN_TAG, '');
  return escHtml(unescHtml(s));
}

// ---------- разбор ошибок ----------
type Lang = 'ru' | 'tg';
const pick = (o: any, lang: Lang, base = 'text') => String((lang === 'tg' ? o?.[`${base}_tg`] : o?.[`${base}_ru`]) || o?.[base] || '');
const NONE = '—';

// Буквы и цифры — как на странице ученика (ExamQuestion.tsx): по порядку order_index
const LETTERS = 'ABCDEFGH';
const letter = (i: number) => LETTERS[i] ?? String(i + 1);

function givenAndRight(snap: any, ans: ExamAnswer | undefined, lang: Lang): { given: string; right: string } {
  if (snap.type === 'matching') {
    const rights = (snap.matching_items ?? []).filter((m: any) => m.side === 'right').sort(sortByOrder);
    const a = ans && typeof ans === 'object' ? ans : {};
    const rightText = (rid: string | null | undefined) => {
      const k = rid ? rights.findIndex((m: any) => m.id === rid) : -1;
      return k >= 0 ? `${k + 1}) ${tgPlain(pick(rights[k], lang))}` : NONE;
    };
    const rows = lefts(snap);
    const pair = (l: any, i: number, rid: string | null | undefined) => `${letter(i)}) ${tgPlain(pick(l, lang))} — ${rightText(rid)}`;
    return { given: rows.map((l, i) => pair(l, i, a[l.id])).join('; '), right: rows.map((l, i) => pair(l, i, l.correct_match_id)).join('; ') };
  }
  if (snap.type === 'open') {
    const k = snap.correct_numeric_answer;
    return { given: typeof ans === 'string' && ans.trim() ? escHtml(ans.trim()) : NONE, right: k == null ? NONE : String(k) };
  }
  const opts: any[] = [...(snap.options ?? [])].sort(sortByOrder);
  const opt = (i: number) => (i >= 0 ? `${letter(i)}) ${tgPlain(pick(opts[i], lang))}` : NONE);
  return { given: opt(typeof ans === 'string' ? opts.findIndex((o) => o.id === ans) : -1), right: opt(opts.findIndex((o) => o.is_correct)) };
}

const REVIEW_TEXT: Record<Lang, { mine: string; right: string; none: string; head: string; score: (a: number, b: number) => string; button: string }> = {
  ru: { mine: 'Ваш ответ', right: 'Верный ответ', none: 'Ошибок нет', head: 'Разбор', score: (a, b) => `Вы набрали ${a} из ${b}.`, button: 'Открыть с формулами и рисунками' },
  tg: { mine: 'Ҷавоби шумо', right: 'Ҷавоби дуруст', none: 'Хатоҳо нест', head: 'Шарҳ', score: (a, b) => `Шумо ${a} аз ${b} гирифтед.`, button: 'Кушодан бо формулаҳо ва расмҳо' },
};

/** Первая строка сообщения с разбором: заголовок (уже очищенный tgPlain) и баллы */
export function reviewHead(title: string, score: number, max: number, lang: Lang): string {
  return `📝 <b>${REVIEW_TEXT[lang].head}: ${title}</b>\n${REVIEW_TEXT[lang].score(score, max)}`;
}
export const reviewButtonText = (lang: Lang): string => REVIEW_TEXT[lang].button;

/**
 * Только вопросы с потерянными баллами: номер, текст, «Ваш ответ», «Верный ответ». Один элемент — один вопрос.
 * seed (id попытки) — тот же порядок вариантов, что видел ученик (shuffleOptions), чтобы буквы совпадали с экраном.
 */
export function reviewLines(questions: ExamQuestion[], answers: ExamAnswers, lang: Lang, seed?: string): string[] {
  const out: string[] = [];
  questions.forEach((q, i) => {
    const r = scoreOne(q.snapshot, answers[q.tqId]);
    if (r.points >= r.max) return;
    const snap = seed ? shuffleOptions(q.snapshot, seed) : q.snapshot;
    const { given, right } = givenAndRight(snap, answers[q.tqId], lang);
    const pic = snap.image_url ? ' [рисунок]' : '';
    out.push(`${i + 1}.${pic} ${tgPlain(pick(snap, lang, 'content'))}\n${REVIEW_TEXT[lang].mine}: ${given}\n${REVIEW_TEXT[lang].right}: ${right}`);
  });
  return out.length ? out : [REVIEW_TEXT[lang].none];
}

/** Где резать слишком длинную строку: по пробелу, не внутри «&...;». */
function cutAt(line: string, limit: number): number {
  if (line.length <= limit) return line.length;
  let cut = limit;
  const sp = line.lastIndexOf(' ', limit);
  if (sp > limit / 2) cut = sp + 1;
  const amp = line.lastIndexOf('&', cut - 1);
  if (amp >= 0 && amp > cut - 12 && !line.slice(amp, cut).includes(';')) cut = amp;
  return cut > 0 ? cut : limit;
}

/** Сообщения не длиннее limit знаков; строка длиннее limit режется по пробелу, не внутри HTML-сущности. */
export function chunkLines(lines: string[], limit = 3800): string[] {
  const parts: string[] = [];
  let cur = '';
  const flush = () => { if (cur) { parts.push(cur); cur = ''; } };
  for (const line of lines) {
    let rest = line;
    do {
      const n = cutAt(rest, limit);
      const piece = rest.slice(0, n);
      rest = rest.slice(n);
      if (cur && cur.length + 1 + piece.length > limit) flush();
      cur = cur ? `${cur}
${piece}` : piece;
    } while (rest.length);
  }
  flush();
  return parts;
}

// ── Общий старт для класса: зал ожидания, отсчёт, единое время окончания ──
export const EXAM_MIN_MINUTES = 5;
export const EXAM_MAX_MINUTES = 45;
export const EXAM_COUNTDOWN_SEC = 3;
export const EXAM_POLL_MS = 3000;
export type SessionPhase = 'waiting' | 'countdown' | 'running' | 'ended';
export interface SessionLink { session_start_at: string | null; duration_min: number }

/** Конец сессии: старт + минуты; null, если сессия не начата. */
export function sessionEnd(link: SessionLink): Date | null {
  if (!link.session_start_at) return null;
  const start = Date.parse(link.session_start_at);
  if (Number.isNaN(start)) return null;
  return new Date(start + link.duration_min * 60_000);
}

export function sessionPhase(link: SessionLink, now: Date): SessionPhase {
  const end = sessionEnd(link);
  if (!end) return 'waiting';
  const t = now.getTime();
  if (t < Date.parse(link.session_start_at as string)) return 'countdown';
  return t < end.getTime() ? 'running' : 'ended';
}

/** Целое число минут в пределах 5..45 или null. */
export function clampMinutes(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  return n >= EXAM_MIN_MINUTES && n <= EXAM_MAX_MINUTES ? n : null;
}

/** Цифра отсчёта 3,2,1; 0 — отсчёт закончен. */
export function countdownDigit(startsAtMs: number, nowMs: number): number {
  return Math.min(EXAM_COUNTDOWN_SEC, Math.max(0, Math.ceil((startsAtMs - nowMs) / 1000)));
}
