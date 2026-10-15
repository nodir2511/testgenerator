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

// Ограничения для обычных пользователей (сайт, бот и Mini App): билетов за раз, вопросов в одном билете, наборов в сутки.
// Администраторы не ограничены. На стороне базы то же проверяет триггер enforce_generation_limits.
export const TG_LIMITS = { perType: 50, tickets: 4, total: 50, perDay: 5 };

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

export function checkSettings(s: Settings, limits: { perType: number; tickets: number; total?: number } = LIMITS): string | null {
  if (s.testCount + s.matchingCount + s.openCount === 0) return 'Задайте хотя бы один вопрос в билете';
  if (s.ticketCount < 1) return 'Количество билетов должно быть не менее 1';
  if (s.testCount > limits.perType || s.matchingCount > limits.perType || s.openCount > limits.perType) {
    return `Не больше ${limits.perType} вопросов каждого типа в билете`;
  }
  if (limits.total && s.testCount + s.matchingCount + s.openCount > limits.total) return `Не больше ${limits.total} вопросов в одном билете`;
  if (s.ticketCount > limits.tickets) return `Не больше ${limits.tickets} билетов за один раз`;
  return null;
}

export type PoolStats = ReturnType<typeof poolStats>;

// Подгоняет состав билета под то, что есть в выбранных темах: если вопросов какого-то
// вида меньше, чем запрошено, берём сколько есть (в билет попадёт меньше вопросов этого вида).
// error — только если подходящих вопросов нет вообще.
export function fitSettings(stats: PoolStats, s: Settings): { settings: Settings; notes: string[]; error: string | null } {
  const notes: string[] = [];
  const fit = (want: number, have: number, label: string) => {
    if (want <= have) return want;
    notes.push(`${label}: в билете ${have} из ${want} (в выбранных темах их только ${have})`);
    return have;
  };
  const testCount = fit(s.testCount, stats.test, 'Тестовые вопросы');
  const matchingCount = fit(s.matchingCount, stats.matching, 'Задания на соответствие');
  const openCount = fit(s.openCount, stats.open, 'Открытые вопросы');
  const error = testCount + matchingCount + openCount === 0 ? 'В выбранных темах нет вопросов нужных видов' : null;
  return { settings: { ...s, testCount, matchingCount, openCount }, notes, error };
}

// Ошибка только если составить билет вообще не из чего
export function checkPool(stats: PoolStats, s: Settings): string | null {
  return fitSettings(stats, s).error;
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
      is_correct: !!o.is_correct,
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
      correct_match_id: m.correct_match_id ?? null,
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

// Порядок вопросов внутри темы — как в исходном сборнике: num (номер в теме),
// затем seq (порядок вставки), дата создания и id (если этих колонок ещё нет).
function compareInTopic(a: any, b: any): number {
  const na = a.num ?? null, nb = b.num ?? null;
  if (na !== null && nb !== null && na !== nb) return Number(na) - Number(nb);
  const sa = a.seq ?? null, sb = b.seq ?? null;
  if (sa !== null && sb !== null && sa !== sb) return Number(sa) - Number(sb);
  const ca = a.created_at || '', cb = b.created_at || '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

const randInt = (n: number, rnd: Rnd) => Math.floor(rnd() * n);

// Случайно делит total на parts неотрицательных частей
function randomComposition(total: number, parts: number, rnd: Rnd): number[] {
  const out = new Array(parts).fill(0);
  for (let i = 0; i < total; i++) out[randInt(parts, rnd)]++;
  return out;
}

// Делит quota целых позиций между элементами пропорционально весу w, не превышая cap.
// Дробные остатки разыгрываются случайно с вероятностью, пропорциональной остатку.
function allocateProportional(quota: number, items: Array<{ w: number; cap: number }>, rnd: Rnd): number[] {
  const alloc = items.map(() => 0);
  let remaining = quota;
  while (remaining > 0) {
    const active = items.map((_, i) => i).filter((i) => alloc[i] < items[i].cap);
    if (active.length === 0) break;
    const totalW = active.reduce((s, i) => s + items[i].w, 0);
    const frac: Array<{ i: number; f: number }> = [];
    let given = 0;
    for (const i of active) {
      const ideal = (remaining * items[i].w) / totalW;
      const add = Math.min(Math.floor(ideal), items[i].cap - alloc[i]);
      alloc[i] += add;
      given += add;
      if (alloc[i] < items[i].cap) frac.push({ i, f: ideal - Math.floor(ideal) });
    }
    remaining -= given;
    // Остаток: выбор без возвращения, шанс пропорционален дробной части (Efraimidis–Spirakis)
    const keyed = frac.map(({ i, f }) => ({ i, k: Math.pow(rnd() || 1e-12, 1 / (f + 1e-6)) })).sort((a, b) => b.k - a.k);
    for (const { i } of keyed) {
      if (remaining === 0) break;
      if (alloc[i] < items[i].cap) {
        alloc[i]++;
        remaining--;
      }
    }
  }
  return alloc;
}

// Глава с таким числом выбранных вопросов (одного вида) и больше выбирается случайно по всему пулу
export const LARGE_CHAPTER = 100;

// Позиции главы по темам. Сначала каждой теме по одной (если квоты хватает на все; иначе — случайным
// темам, шанс пропорционален размеру), остальное: в большой главе — случайно по вопросам пула
// (тема выпадает с шансом, пропорциональным числу её вопросов), в малой — пропорционально размеру.
function allocateInChapter(quota: number, items: Array<{ w: number; cap: number }>, large: boolean, rnd: Rnd): number[] {
  const alloc = items.map(() => 0);
  const eligible = items.map((_, i) => i).filter((i) => items[i].cap > 0);
  if (quota >= eligible.length) {
    eligible.forEach((i) => { alloc[i] = 1; });
  } else {
    const keyed = eligible.map((i) => ({ i, k: Math.pow(rnd() || 1e-12, 1 / items[i].w) })).sort((a, b) => b.k - a.k);
    keyed.slice(0, quota).forEach(({ i }) => { alloc[i] = 1; });
  }
  let remaining = quota - alloc.reduce((a, b) => a + b, 0);
  if (remaining <= 0) return alloc;
  if (large) {
    while (remaining > 0) {
      const open = items.map((_, i) => i).filter((i) => alloc[i] < items[i].cap);
      if (open.length === 0) break;
      let r = rnd() * open.reduce((s, i) => s + items[i].w, 0);
      let pick = open[open.length - 1];
      for (const i of open) {
        r -= items[i].w;
        if (r < 0) { pick = i; break; }
      }
      alloc[pick]++;
      remaining--;
    }
    return alloc;
  }
  const rest = allocateProportional(remaining, items.map((it, i) => ({ w: it.w, cap: it.cap - alloc[i] })), rnd);
  return alloc.map((a, i) => a + rest[i]);
}

/**
 * Параллельный подбор вопросов одного вида для ticketCount билетов.
 * Возвращает матрицу [билет][позиция] -> вопрос.
 *
 * Основной режим (в темах хватает вопросов, чтобы раздать всем билетам разные):
 * - позиции делятся между главами пропорционально охвату (выбранные / все вопросы главы; при
 *   полном выборе — поровну); внутри большой главы (от LARGE_CHAPTER вопросов) вопросы берутся
 *   случайно из всего пула главы, в малой — темы делят позиции пропорционально размеру; каждой
 *   выбранной теме достаётся хотя бы одна позиция, если квоты главы хватает;
 * - позиция j во всех билетах берётся из одной темы соседними вопросами:
 *   билет 1 — вопрос №35, билет 2 — №36, билет 3 — №37 и т.д.;
 * - ни один вопрос не повторяется ни внутри билета, ни между билетами.
 *
 * Запасной режим (тем слишком мало вопросов для основного):
 * весь пул по порядку сборника, позиции — равномерно разнесённые «полосы» соседних вопросов,
 * билет k берёт k-й вопрос полосы. Внутри билета повторов нет никогда; между билетами вопросы
 * повторяются только когда пул исчерпан (и тогда используются все вопросы пула).
 */
export function pickParallel(
  pool: any[], count: number, ticketCount: number, rnd: Rnd = Math.random,
  /** Все вопросы этого вида в каждой главе (chapter_id → число); без него охват глав считается равным */
  totals?: Record<string, number>,
): any[][] {
  const T = ticketCount;
  const tickets: any[][] = Array.from({ length: T }, () => []);
  const P = Math.min(count, pool.length);
  if (P <= 0 || T <= 0) return tickets;

  // Группировка по темам, темы — по порядку глав и параграфов, вопросы — по порядку сборника
  const byTopic = new Map<string, any[]>();
  for (const q of pool) {
    const key = q.topic_id || '—';
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key)!.push(q);
  }
  const topics = [...byTopic.entries()].map(([id, list]) => {
    const sorted = [...list].sort(compareInTopic);
    const f = sorted[0];
    return { id, list: sorted, chapterOrder: f?.chapter?.order_index ?? 0, topicOrder: f?.topic?.order_index ?? 0, slots: 0 };
  }).sort((a, b) => a.chapterOrder - b.chapterOrder || a.topicOrder - b.topicOrder || (a.id < b.id ? -1 : 1));

  const capacity = topics.reduce((sum, t) => sum + Math.floor(t.list.length / T), 0);

  if (capacity < P) {
    // Запасной режим
    const W = topics.flatMap((t) => t.list);
    const n = W.length;
    const r = randInt(n, rnd);
    for (let j = 0; j < P; j++) {
      const off = r + Math.floor((j * n) / P); // равномерно по кругу; соседние полосы не короче n/P
      for (let k = 0; k < T; k++) tickets[k].push(W[(off + k) % n]);
    }
    return tickets;
  }

  // Основной режим.
  // 1) Позиции делятся между главами пропорционально охвату главы (выбранные вопросы / все вопросы
  //    главы этого вида); при полном выборе охват 100% у всех и деление поровну. Если в главе
  //    вопросов не хватает, её доля уходит остальным.
  // 2) Внутри главы: в большой главе (от LARGE_CHAPTER вопросов) вопросы берутся случайно из всего
  //    пула главы, в малой — темы делят позиции пропорционально размеру. В обоих случаях каждой теме
  //    даётся хотя бы одна позиция, если квота главы позволяет. Потолок темы — floor(вопросов / T).
  const chapters = new Map<string, typeof topics>();
  for (const t of topics) {
    const f = t.list[0];
    const key = f?.chapter_id ?? `ch${f?.chapter?.order_index ?? 0}:${f?.chapter?.name ?? ''}`;
    if (!chapters.has(key)) chapters.set(key, []);
    chapters.get(key)!.push(t);
  }
  const chList = [...chapters.entries()].map(([key, ts]) => {
    const size = ts.reduce((sum, t) => sum + t.list.length, 0);
    const total = totals?.[key];
    return {
      topics: ts,
      size,
      w: total && total > 0 ? Math.min(1, size / total) : 1,
      cap: ts.reduce((sum, t) => sum + Math.floor(t.list.length / T), 0),
    };
  }).filter((c) => c.cap > 0);
  const quotas = allocateProportional(P, chList.map((c) => ({ w: c.w, cap: c.cap })), rnd);
  chList.forEach((c, ci) => {
    const alloc = allocateInChapter(
      quotas[ci],
      c.topics.map((t) => ({ w: t.list.length, cap: Math.floor(t.list.length / T) })),
      c.size >= LARGE_CHAPTER,
      rnd,
    );
    c.topics.forEach((t, i) => { t.slots = alloc[i]; });
  });

  for (const t of topics) {
    if (t.slots === 0) continue;
    // Полосы длиной T со случайными промежутками между ними
    const gaps = randomComposition(t.list.length - t.slots * T, t.slots + 1, rnd);
    let pos = gaps[0];
    for (let j = 0; j < t.slots; j++) {
      for (let k = 0; k < T; k++) tickets[k].push(t.list[pos + k]);
      pos += T + gaps[j + 1];
    }
  }
  return tickets;
}

export type ChapterTotals = Record<string, { test: number; matching: number; open: number }>;

/** Считает все вопросы по главам и видам из строк { chapter_id, type } */
export function chapterTotals(rows: Array<{ chapter_id: string; type: string }>): ChapterTotals {
  const out: ChapterTotals = {};
  for (const r of rows) {
    const c = (out[r.chapter_id] ??= { test: 0, matching: 0, open: 0 });
    if (r.type === 'test' || r.type === 'matching' || r.type === 'open') c[r.type]++;
  }
  return out;
}

export const totalsOf = (t: ChapterTotals | undefined, type: 'test' | 'matching' | 'open') =>
  t ? Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v[type]])) : undefined;

export function buildTickets(pool: any[], s: Settings, rnd: Rnd = Math.random, totals?: ChapterTotals) {
  const T = s.ticketCount;
  const tests = pickParallel(pool.filter((q) => q.type === 'test'), s.testCount, T, rnd, totalsOf(totals, 'test'));
  const matching = pickParallel(pool.filter((q) => q.type === 'matching'), s.matchingCount, T, rnd, totalsOf(totals, 'matching'));
  const open = pickParallel(pool.filter((q) => q.type === 'open'), s.openCount, T, rnd, totalsOf(totals, 'open'));
  const out: Array<{ ticketNumber: number; questions: any[] }> = [];
  for (let k = 0; k < T; k++) {
    const qs = [...tests[k], ...matching[k], ...open[k]];
    out.push({ ticketNumber: k + 1, questions: qs.map((q, i) => ({ order_index: i + 1, question_id: q.id, question_snapshot: toSnapshot(q, s, rnd) })) });
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

// Короткое имя: берём русскую часть «Рус / Тоҷикӣ»
export const shortName = (s: string, n = 60) => clip((s.split(' / ')[0] || s).trim(), n);

// Разбор «1-3, 5 8» или «все» -> номера (1-based), без дублей. null — не разобрать
export function parseNumbers(text: string, max: number): number[] | 'all' | null {
  const t = text.trim().toLowerCase();
  if (/^(все|всё|all|ҳама)$/.test(t)) return 'all';
  if (!/^[\d\s,;.\-–—]+$/.test(t)) return null;
  const out = new Set<number>();
  for (const part of t.split(/[\s,;.]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:[-–—](\d+))?$/);
    if (!m) return null;
    const a = +m[1], z = m[2] ? +m[2] : a;
    if (a < 1 || z > max || a > z) return null;
    for (let i = a; i <= z; i++) out.add(i);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

// Сетка кнопок-номеров (6 в ряд): нажатие переключает пункт
function numGrid(count: number, isOn: (i: number) => boolean, prefix: string): Kb {
  const btns: Btn[] = [];
  for (let i = 0; i < count; i++) btns.push({ text: `${isOn(i) ? '✅' : ''}${i + 1}`, callback_data: `${prefix}:${i}` });
  return chunk(btns, 6);
}

function numberedList(items: Array<{ id: string; name: string }>, selected: string[]): string {
  return items.map((c, i) => `${selected.includes(c.id) ? '✅' : '▫️'} ${i + 1}. ${shortName(c.name)}`).join('\n');
}

export function chaptersText(chapters: Array<{ id: string; name: string }>, selected: string[]): string {
  return `Выберите главы: нажимайте номера или отправьте текстом, например 1-3, 5 (или «все»).\n\n${numberedList(chapters, selected)}`;
}

export function kbChapters(chapters: Array<{ id: string; name: string }>, selected: string[]): Kb {
  const rows = numGrid(chapters.length, (i) => selected.includes(chapters[i].id), 'C');
  rows.push([{ text: 'Все главы', callback_data: 'CA' }, { text: 'Сбросить', callback_data: 'CR' }]);
  rows.push([{ text: 'Далее ▶', callback_data: 'CN' }]);
  return rows;
}

export function topicsText(chapterName: string, pos: number, total: number, topics: Array<{ id: string; name: string }>, selected: string[]): string {
  const head = `${shortName(chapterName, 40)} — темы (глава ${pos + 1} из ${total})`;
  if (!topics.length) return `${head}\n\nВ этой главе нет тем — будут взяты все вопросы главы.`;
  const n = topics.filter((t) => selected.includes(t.id)).length;
  const note = n ? `Выбрано: ${n} из ${topics.length}.` : 'Ничего не выбрано — возьмутся все темы главы.';
  return `${head}\n${note}\nНажимайте номера или отправьте текстом, например 1-4, 7 (или «все»).\n\n${numberedList(topics, selected)}`;
}

export function kbTopics(topics: Array<{ id: string; name: string }>, selected: string[], isLast: boolean): Kb {
  const rows = numGrid(topics.length, (i) => selected.includes(topics[i].id), 'T');
  rows.push([{ text: 'Все темы главы', callback_data: 'TX' }]);
  rows.push([{ text: '◀ Назад', callback_data: 'TB' }, { text: isLast ? 'Далее ▶' : 'След. глава ▶', callback_data: 'TN' }]);
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
