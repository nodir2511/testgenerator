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
export const POOL_SELECT = 'id, type, topic_id, chapter_id, num, seq, created_at, linked_ids, chapter:chapters(order_index), topic:topics(order_index), usage:question_usage(times_used)';

/** Полный вопрос для снимка билета */
export const QUESTION_FULL_SELECT = '*, chapter:chapters(name, order_index), topic:topics(name, order_index), options:question_options(*), matching_items:matching_items(*)';

const PAGE = 1000; // Supabase отдаёт не больше 1000 строк за запрос
const PARALLEL = 4;
const IDS_PER_REQUEST = 100; // идентификаторы идут в адрес запроса: 100 × 37 символов — безопасно

/**
 * Лёгкий пул предмета. Фильтр: темы, иначе главы, иначе весь предмет.
 * Первая страница одна; если она полная, следующие читаются пачками по PARALLEL (порядок строк сохраняется).
 */
export async function loadLightPool(sb: any, sel: PoolSelection): Promise<any[]> {
  // Статистика использования (question_usage) — необязательная: если таблицы ещё нет в базе,
  // подбор работает как раньше, без учёта частоты.
  let select = POOL_SELECT;
  const page = async (from: number): Promise<any[]> => {
    const run = async () => {
      let q = sb.from('questions').select(select).eq('subject_id', sel.subjectId).eq('is_deleted', false);
      if (sel.topicIds.length) q = q.in('topic_id', sel.topicIds);
      else if (sel.chapterIds.length) q = q.in('chapter_id', sel.chapterIds);
      return q.order('id').range(from, from + PAGE - 1);
    };
    let { data, error } = await run();
    if (error && select === POOL_SELECT && /question_usage/.test(`${error.message ?? ''} ${error.details ?? ''}`)) {
      select = POOL_SELECT.replace(/, usage:question_usage\(times_used\)/, '');
      ({ data, error } = await run());
    }
    if (error) throw error;
    return data ?? [];
  };
  const all: any[] = await page(0);
  if (all.length < PAGE) return all;
  for (let from = PAGE; ; from += PAGE * PARALLEL) {
    const parts = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => page(from + i * PAGE)));
    for (const p of parts) all.push(...p);
    if (parts.some((p) => p.length < PAGE)) break;
  }
  return all;
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
  for (let i = 0; i < list.length; i += IDS_PER_REQUEST) {
    const slice = list.slice(i, i + IDS_PER_REQUEST);
    jobs.push((async () => {
      const { data, error } = await sb.from('questions').select(QUESTION_FULL_SELECT).in('id', slice);
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
