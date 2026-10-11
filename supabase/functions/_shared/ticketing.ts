// Чистая логика подбора билетов и меню Telegram-бота (без внешних зависимостей —
// можно тестировать в Node и запускать в Deno).

export interface Settings {
  testCount: number;
  matchingCount: number;
  openCount: number;
  ticketCount: number;
  shuffleOptions: boolean;
  shuffleMatching: boolean;
  title: string;
}

export const DEFAULT_SETTINGS: Settings = {
  testCount: 10,
  matchingCount: 2,
  openCount: 3,
  ticketCount: 2,
  shuffleOptions: true,
  shuffleMatching: true,
  title: 'Экзаменационные билеты',
};

export const LIMITS = { perType: 100, tickets: 20 };

export type Rnd = () => number;

export function shuffle<T>(arr: T[], rnd: Rnd = Math.random): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function poolStats(all: Array<{ type: string }>) {
  return {
    total: all.length,
    test: all.filter((x) => x.type === 'test').length,
    matching: all.filter((x) => x.type === 'matching').length,
    open: all.filter((x) => x.type === 'open').length,
  };
}

export function checkSettings(s: Settings): string | null {
  if (s.testCount + s.matchingCount + s.openCount === 0) return 'Задайте хотя бы один вопрос в билете';
  if (s.ticketCount < 1) return 'Количество билетов должно быть не менее 1';
  if (s.testCount > LIMITS.perType || s.matchingCount > LIMITS.perType || s.openCount > LIMITS.perType) {
    return `Не больше ${LIMITS.perType} вопросов каждого типа в билете`;
  }
  if (s.ticketCount > LIMITS.tickets) return `Не больше ${LIMITS.tickets} билетов за один раз`;
  return null;
}

export function checkPool(stats: ReturnType<typeof poolStats>, s: Settings): string | null {
  if (stats.test < s.testCount) {
    return `Недостаточно тестовых вопросов! Требуется в билете: ${s.testCount}, а в выбранных темах доступно: ${stats.test}`;
  }
  if (stats.matching < s.matchingCount) {
    return `Недостаточно заданий на соответствие! Требуется: ${s.matchingCount}, а доступно: ${stats.matching}`;
  }
  if (stats.open < s.openCount) {
    return `Недостаточно открытых вопросов! Требуется: ${s.openCount}, а доступно: ${stats.open}`;
  }
  return null;
}

// Снимок вопроса для билета (тот же формат, что у сайта)
export function toSnapshot(q: any, s: Pick<Settings, 'shuffleOptions' | 'shuffleMatching'>, rnd: Rnd = Math.random) {
  let options = q.options;
  if (q.type === 'test' && q.options && q.options.length > 0) {
    const sorted = [...q.options].sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));
    const used = s.shuffleOptions ? shuffle(sorted, rnd) : sorted;
    options = used.map((o: any, i: number) => ({
      id: o.id,
      text: o.text,
      text_ru: o.text_ru || o.text,
      text_tg: o.text_tg || o.text_ru || o.text,
      image_url: o.image_url,
      order_index: i + 1,
    }));
  }
  let matching = q.matching_items;
  if (q.type === 'matching' && q.matching_items && q.matching_items.length > 0) {
    const left = q.matching_items.filter((m: any) => m.side === 'left').sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));
    const right = q.matching_items.filter((m: any) => m.side === 'right');
    const rightUsed = s.shuffleMatching ? shuffle(right, rnd) : [...right].sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));
    const mapItem = (m: any, i: number) => ({
      id: m.id,
      side: m.side,
      text: m.text,
      text_ru: m.text_ru || m.text,
      text_tg: m.text_tg || m.text_ru || m.text,
      image_url: m.image_url,
      order_index: i + 1,
    });
    matching = [...left.map(mapItem), ...rightUsed.map(mapItem)];
  }
  return {
    id: q.id,
    type: q.type,
    content: q.content,
    content_ru: q.content_ru || q.content,
    content_tg: q.content_tg || q.content_ru || q.content,
    image_url: q.image_url,
    correct_numeric_answer: q.correct_numeric_answer,
    chapter_name: q.chapter?.name,
    topic_name: q.topic?.name,
    options,
    matching_items: matching,
  };
}

export function buildTickets(pool: any[], s: Settings, rnd: Rnd = Math.random) {
  const tests = pool.filter((q) => q.type === 'test');
  const matching = pool.filter((q) => q.type === 'matching');
  const open = pool.filter((q) => q.type === 'open');
  const out: Array<{ ticketNumber: number; questions: any[] }> = [];
  for (let n = 1; n <= s.ticketCount; n++) {
    const qs = [
      ...shuffle(tests, rnd).slice(0, s.testCount),
      ...shuffle(matching, rnd).slice(0, s.matchingCount),
      ...shuffle(open, rnd).slice(0, s.openCount),
    ];
    out.push({ ticketNumber: n, questions: qs.map((q, i) => ({ order_index: i + 1, question_id: q.id, question_snapshot: toSnapshot(q, s, rnd) })) });
  }
  return out;
}

export function parseCount(text: string, max: number, min = 0): number | null {
  const t = text.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = parseInt(t, 10);
  return n < min || n > max ? null : n;
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Билеты';
}

// ---------------- Клавиатуры ----------------
export type Btn = { text: string; callback_data: string };
export type Kb = Btn[][];

const chunk = <T,>(a: T[], n: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n));
  return r;
};
const clip = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function kbSubjects(subjects: Array<{ name: string }>): Kb {
  return subjects.map((s, i) => [{ text: clip(s.name), callback_data: `S:${i}` }]);
}

export function kbChapters(chapters: Array<{ id: string; name: string }>, selected: string[]): Kb {
  const rows: Kb = chapters.map((c, i) => [{ text: `${selected.includes(c.id) ? '✅' : '⬜'} ${clip(c.name)}`, callback_data: `C:${i}` }]);
  rows.push([{ text: 'Выбрать все', callback_data: 'CA' }, { text: 'Сбросить', callback_data: 'CR' }]);
  rows.push([{ text: 'Далее ▶', callback_data: 'CN' }]);
  return rows;
}

export const TOPIC_PAGE = 8;

export function kbTopics(topics: Array<{ id: string; name: string }>, selected: string[], page: number): Kb {
  const pages = Math.max(1, Math.ceil(topics.length / TOPIC_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = topics.slice(p * TOPIC_PAGE, (p + 1) * TOPIC_PAGE);
  const rows: Kb = slice.map((t, i) => [{ text: `${selected.includes(t.id) ? '✅' : '⬜'} ${clip(t.name)}`, callback_data: `T:${p * TOPIC_PAGE + i}` }]);
  if (pages > 1) {
    const nav: Btn[] = [];
    if (p > 0) nav.push({ text: '◀', callback_data: `TP:${p - 1}` });
    nav.push({ text: `${p + 1}/${pages}`, callback_data: 'NOOP' });
    if (p < pages - 1) nav.push({ text: '▶', callback_data: `TP:${p + 1}` });
    rows.push(nav);
  }
  rows.push([{ text: 'Все темы выбранных глав', callback_data: 'TX' }]);
  rows.push([{ text: '◀ Главы', callback_data: 'BC' }, { text: 'Далее ▶', callback_data: 'TN' }]);
  return rows;
}

export function kbSettings(s: Settings): Kb {
  return [
    [{ text: `Тесты: ${s.testCount}`, callback_data: 'V:test' }, { text: `Соответствия: ${s.matchingCount}`, callback_data: 'V:matching' }],
    [{ text: `Открытые: ${s.openCount}`, callback_data: 'V:open' }, { text: `Билетов: ${s.ticketCount}`, callback_data: 'V:tickets' }],
    [{ text: `${s.shuffleOptions ? '✅' : '⬜'} Перемешать варианты`, callback_data: 'O:opt' }],
    [{ text: `${s.shuffleMatching ? '✅' : '⬜'} Перемешать соответствия`, callback_data: 'O:mat' }],
    [{ text: `Название: ${clip(s.title, 30)}`, callback_data: 'V:title' }],
    [{ text: '◀ Темы', callback_data: 'BT' }, { text: 'Далее ▶', callback_data: 'SN' }],
  ];
}

export function kbLang(): Kb {
  return [
    [{ text: 'Русский', callback_data: 'L:ru' }, { text: 'Тоҷикӣ', callback_data: 'L:tg' }],
    [{ text: 'Оба языка', callback_data: 'L:both' }],
    [{ text: '◀ Настройки', callback_data: 'BS' }],
  ];
}

export function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function settingsText(subject: string, chapters: string[], topicCount: number, s: Settings, stats?: ReturnType<typeof poolStats>): string {
  const lines = [
    `Предмет: ${subject}`,
    `Главы: ${chapters.join(', ') || '—'}`,
    `Темы: ${topicCount > 0 ? topicCount + ' выбрано' : 'все темы выбранных глав'}`,
  ];
  if (stats) lines.push(`Доступно вопросов: тестов ${stats.test}, соответствий ${stats.matching}, открытых ${stats.open}`);
  lines.push('', 'Нажмите на параметр, чтобы изменить его. Затем «Далее».');
  return lines.join('\n');
}
