// Чистая логика страницы /tg/exam (без React и браузера): таймер, формы ответов, разбор.

export type Lang = 'ru' | 'tg';
export type Answer = string | Record<string, string> | null;
export type Answers = Record<string, Answer>;
export interface ExamQ { tqId: string; snapshot: any }
export interface ReviewItem { tqId: string; snapshot: any; answer: Answer; points: number; max: number }

/** Осталось до срока по часам сервера: offset = серверное «сейчас» − клиентское «сейчас» */
export const remainingMs = (deadlineIso: string, offsetMs: number, clientNow: number = Date.now()): number =>
  Date.parse(deadlineIso) - (clientNow + offsetMs);

export function formatRemaining(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const isEmptyQ = (snap: any): boolean => !snap || snap.empty === true;

export function isAnswered(type: string, a: Answer | undefined): boolean {
  if (a == null) return false;
  if (type === 'matching') return typeof a === 'object' && Object.values(a).some((v) => !!v);
  if (type === 'open') return typeof a === 'string' && a.trim() !== '';
  return typeof a === 'string' && a !== '';
}

export function countAnswered(questions: ExamQ[], answers: Answers): { answered: number; total: number } {
  let answered = 0, total = 0;
  for (const q of questions) {
    if (isEmptyQ(q.snapshot)) continue;
    total++;
    if (isAnswered(q.snapshot.type, answers[q.tqId])) answered++;
  }
  return { answered, total };
}

/** Оставляет знак в начале, цифры и один разделитель (запятая или точка) */
export function normalizeOpen(raw: string): string {
  let out = '';
  let sep = false;
  for (const ch of raw.trim()) {
    if (/\d/.test(ch)) out += ch;
    else if ((ch === ',' || ch === '.') && !sep) { out += ch; sep = true; }
    else if ((ch === '-' || ch === '+') && out === '') out += ch;
  }
  return out;
}

/** Новый ответ на соответствие: пара leftId → rightId, null — снять пару */
export function matchingAnswer(prev: Answer | undefined, leftId: string, rightId: string | null): Record<string, string> {
  const base: Record<string, string> = prev && typeof prev === 'object' ? { ...prev } : {};
  if (rightId) base[leftId] = rightId; else delete base[leftId];
  return base;
}

export const nameOk = (v: string): boolean => {
  const n = [...v.replace(/\s+/g, ' ').trim()].length;
  return n >= 2 && n <= 80;
};

export const sortByOrder = (a: any, b: any): number => (a.order_index || 0) - (b.order_index || 0);

/** Текст поля на языке билета; пустой перевод заменяется базовым полем */
export function pickText(o: any, lang: Lang, prefix: 'text' | 'content' = 'text'): string {
  if (!o) return '';
  const localized = lang === 'tg' ? o[`${prefix}_tg`] : o[`${prefix}_ru`];
  return String(localized || o[prefix] || '');
}

/** Только вопросы, где потеряны баллы; n — номер в билете */
export function reviewMistakes(items: ReviewItem[]): Array<{ n: number; item: ReviewItem }> {
  const out: Array<{ n: number; item: ReviewItem }> = [];
  items.forEach((item, i) => { if (item.points < item.max) out.push({ n: i + 1, item }); });
  return out;
}

/** Смещение часов: серверное время минус середина интервала «отправили — получили» (задержка сети делится пополам) */
export const serverOffset = (serverNow: number, sentAt: number, receivedAt: number): number =>
  serverNow - (sentAt + receivedAt) / 2;
