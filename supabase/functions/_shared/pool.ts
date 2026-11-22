// Загрузка вопросов для подбора билетов (сайт, telegram-bot, tg-app). Без импортов: работает и в браузере, и в Deno.
//
// Раньше для подбора скачивался весь пул предмета целиком, с вариантами ответов и парами соответствия
// (у «Химии» ~8,7 тыс. вопросов, около 14 МБ). Теперь:
//   1. loadLightPool — только поля, нужные для подбора (≈6 раз меньше);
//   2. подбор (pickTickets из ticketing.ts) работает по лёгкому пулу;
//   3. hydrateTickets — полные вопросы догружаются только для выбранных.

export interface PoolSelection {
  subjectId: string;
  chapterIds: string[];
  /** [] = все вопросы выбранных глав */
  topicIds: string[];
}

/** Поля, которые читают pickParallel и separateLinked */
export const POOL_SELECT = 'id, type, topic_id, chapter_id, num, seq, created_at, linked_ids, source_id, nct_type, nct_difficulty, passage_id, passage_order, chapter:chapters(order_index), topic:topics(order_index), passage:passages(kind), usage:question_usage(times_used)';

const PASSAGE_POOL_FIELDS = /, passage_id, passage_order|, passage:passages\(kind\)/g;
const PASSAGE_FULL_FIELD = /, passage:passages\([^)]*\)/;
const mentions = (e: any, re: RegExp) => re.test(`${e?.message ?? ''} ${e?.details ?? ''} ${e?.hint ?? ''}`);

/** Полный вопрос для снимка билета (с текстом, если вопрос к тексту) */
export const QUESTION_FULL_SELECT = '*, chapter:chapters(name, order_index), topic:topics(name, order_index), options:question_options(*), matching_items:matching_items(*), passage:passages(id, kind, title, content)';

const PAGE = 1000; // Supabase отдаёт не больше 1000 строк за запрос
const PARALLEL = 6; // сколько окон читается одновременно
const WINDOW_ROWS = 850; // сколько строк ждём в одном окне: с запасом до PAGE, чтобы окно читалось одним запросом
const MAX_WINDOWS = 24;
const IDS_PER_REQUEST = 100; // идентификаторы идут в адрес запроса: 100 × 37 символов — безопасно

// ── Чтение больших выборок «окнами по id» ───────────────────────────────────────────────────
// Раньше страницы читались по смещению (range): чтобы отдать строки 3001–4000, база собирала и первые 3000
// вместе с вложенными вариантами ответов — чем дальше страница, тем дороже. Теперь каждая страница — условие
// по id (id > …, id < …): база сразу встаёт на нужное место по индексу и лишнего не читает.

/** Окно по id: строки после after (или начиная с from) и до before, не включая его */
export interface IdWindow { after?: any; from?: any; before?: any }

/** Добавляет к запросу окно по id, порядок по id и размер страницы */
export function inIdWindow(q: any, w: IdWindow): any {
  if (w.after !== undefined) q = q.gt('id', w.after);
  if (w.from !== undefined) q = q.gte('id', w.from);
  if (w.before !== undefined) q = q.lt('id', w.before);
  return q.order('id').limit(PAGE);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const UUID_SPACE = 0x100000000; // первые 8 знаков uuid — число от 0 до 2^32
const uuidAt = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`;

/**
 * Делит остаток диапазона id (после последней строки первой страницы) на окна, которые можно читать одновременно.
 * id в базе — случайные uuid, поэтому строки лежат по диапазону равномерно: первая страница показывает,
 * какую долю диапазона занимают PAGE строк. Если id не uuid или лежат неравномерно, окна просто читаются
 * в несколько страниц — результат тот же.
 */
function idWindowsAfter(last: any): IdWindow[] {
  if (typeof last !== 'string' || !UUID.test(last)) return [{ after: last }];
  const start = parseInt(last.slice(0, 8), 16) + 1;
  if (start >= UUID_SPACE) return [{ after: last }];
  const restRows = (PAGE * (UUID_SPACE - start)) / start;
  const count = Math.min(MAX_WINDOWS, Math.max(1, Math.ceil(restRows / WINDOW_ROWS)));
  const bounds: number[] = [];
  for (let i = 1; i < count; i++) {
    const b = start + Math.floor(((UUID_SPACE - start) * i) / count);
    if (b < UUID_SPACE && b > (bounds.length ? bounds[bounds.length - 1] : start - 1)) bounds.push(b);
  }
  const windows: IdWindow[] = [{ after: last, before: bounds.length ? uuidAt(bounds[0]) : undefined }];
  bounds.forEach((b, i) => windows.push({ from: uuidAt(b), before: i + 1 < bounds.length ? uuidAt(bounds[i + 1]) : undefined }));
  return windows;
}

/**
 * Читает все строки запроса по порядку id. page(окно) должен вернуть строки окна (не больше PAGE) или бросить ошибку.
 * Первая страница одна; если она полная, остаток читается окнами, по PARALLEL одновременно.
 */
export async function readAllById<T extends { id: any }>(page: (w: IdWindow) => Promise<T[]>): Promise<T[]> {
  const first = await page({});
  if (first.length < PAGE) return first;
  const windows = idWindowsAfter(first[first.length - 1].id);
  const parts: T[][] = new Array(windows.length);
  let next = 0;
  const worker = async () => {
    while (next < windows.length) {
      const i = next++;
      let w = windows[i];
      const rows: T[] = [];
      for (;;) {
        const got = await page(w);
        rows.push(...got);
        if (got.length < PAGE) break;
        w = { after: got[got.length - 1].id, before: w.before };
      }
      parts[i] = rows;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, windows.length) }, worker));
  return first.concat(...parts);
}

/**
 * Лёгкий пул предмета. Фильтр: темы, иначе главы, иначе весь предмет.
 * Строки идут по порядку id; большие пулы читаются окнами по id (readAllById).
 */
const MAX_IN_IDS = 100;

export async function loadLightPool(sb: any, sel: PoolSelection): Promise<any[]> {
  // Статистика использования (question_usage) — необязательная: если таблицы ещё нет в базе,
  // подбор работает как раньше, без учёта частоты.
  let select = POOL_SELECT;
  // Список id уходит в адрес запроса: длинный список тем (больше ~100) в него не помещается.
  // Тогда читаем по главам или весь предмет, а темы отбираем уже здесь.
  const manyTopics = sel.topicIds.length > MAX_IN_IDS;
  const topicSet = manyTopics ? new Set(sel.topicIds) : null;
  const byChapters = sel.chapterIds.length > 0 && sel.chapterIds.length <= MAX_IN_IDS;
  const pick = (rows: any[]) => (topicSet ? rows.filter((r) => topicSet.has(r.topic_id)) : rows);
  const page = async (w: IdWindow): Promise<any[]> => {
    const run = async () => {
      let q = sb.from('questions').select(select).eq('subject_id', sel.subjectId).eq('is_deleted', false);
      if (sel.topicIds.length && !manyTopics) q = q.in('topic_id', sel.topicIds);
      else if (byChapters) q = q.in('chapter_id', sel.chapterIds);
      return inIdWindow(q, w);
    };
    let { data, error } = await run();
    // Таблиц question_usage и passages в базе может ещё не быть (миграция не применена): тогда читаем без них
    if (error && mentions(error, /question_usage/)) {
      select = select.replace(/, usage:question_usage\(times_used\)/, '');
      ({ data, error } = await run());
    }
    if (error && mentions(error, /passage/)) {
      select = select.replace(PASSAGE_POOL_FIELDS, '');
      ({ data, error } = await run());
    }
    if (error) throw error;
    return data ?? [];
  };
  return pick(await readAllById(page));
}

/**
 * Заменяет выбранные лёгкие вопросы полными (на месте). Читает только уникальные выбранные вопросы,
 * запросы идут одновременно. Если вопрос пропал или удалён за это время — понятная ошибка.
 */
export async function hydrateTickets(sb: any, kinds: any[][][]): Promise<void> {
  const ids = new Set<string>();
  for (const kind of kinds) for (const ticket of kind) for (const q of ticket) ids.add(q.id);
  const list = [...ids];
  const full = new Map<string, any>();
  const jobs: Promise<void>[] = [];
  let select = QUESTION_FULL_SELECT;
  for (let i = 0; i < list.length; i += IDS_PER_REQUEST) {
    const slice = list.slice(i, i + IDS_PER_REQUEST);
    jobs.push((async () => {
      let { data, error } = await sb.from('questions').select(select).in('id', slice);
      if (error && mentions(error, /passage/)) {
        // таблицы passages ещё нет в базе — снимок без текста
        select = select.replace(PASSAGE_FULL_FIELD, '');
        ({ data, error } = await sb.from('questions').select(select).in('id', slice));
      }
      if (error) throw error;
      for (const q of data ?? []) full.set(q.id, q);
    })());
  }
  await Promise.all(jobs);
  for (const kind of kinds) {
    for (const ticket of kind) {
      for (let i = 0; i < ticket.length; i++) {
        const f = full.get(ticket[i].id);
        if (!f) throw new Error('Часть вопросов изменилась, пока составлялись билеты. Повторите создание.');
        ticket[i] = f;
      }
    }
  }
}
