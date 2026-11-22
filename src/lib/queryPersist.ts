import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';

// Кэш справочников между визитами. Каждый запрос к базе — около полусекунды только на дорогу, поэтому
// предметы, главы, темы и счётчики вопросов сохраняются в браузере: при следующем открытии сайта они
// показываются сразу, а свежие данные подгружаются в фоне (восстановленные запросы помнят своё время и
// считаются устаревшими как обычно). Сохраняются только справочники — ни вопросов, ни билетов здесь нет.
// Кэш привязан к пользователю и версии сайта, стирается при выходе.

export const PERSIST_KEY = 'examiner_query_cache';

/** Первые элементы ключей react-query, которые сохраняются (docs/ARCHITECTURE.md, раздел 11) */
const REFERENCE_KEYS = new Set([
  'subjects', 'topics_for_generation', 'chapters', 'topics', 'question_counts', 'passage_counts', 'generation_settings',
]);
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 80;
const SAVE_DELAY_MS = 1500;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SavedQuery = DehydratedState['queries'][number];
interface Saved { userId: string; version: string; queries: SavedQuery[] }

const appVersion = () => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev');
const isReference = (key: readonly unknown[]) => REFERENCE_KEYS.has(String(key[0]));
const browserStore = (): Store | null => {
  try { return window.localStorage; } catch { return null; }
};
const drop = (store: Store) => {
  try { store.removeItem(PERSIST_KEY); } catch { /* память недоступна */ }
};

function read(store: Store): Saved | null {
  try {
    const raw = store.getItem(PERSIST_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved.userId !== 'string' || !Array.isArray(saved.queries)) return null;
    return saved as Saved;
  } catch {
    return null;
  }
}

const usable = (q: SavedQuery, minTime: number) =>
  Boolean(q && Array.isArray(q.queryKey) && isReference(q.queryKey) && q.state?.status === 'success' && q.state.dataUpdatedAt >= minTime);

/** Сохраняет справочники из памяти; уже сохранённые, которых сейчас в памяти нет, остаются (пока не устареют) */
export function saveQueryCache(client: QueryClient, userId: string, store: Store | null = browserStore(), version = appVersion()): void {
  if (!store) return;
  try {
    const current = dehydrate(client, {
      shouldDehydrateQuery: (q) => q.state.status === 'success' && isReference(q.queryKey),
    }).queries;
    const byHash = new Map<string, SavedQuery>();
    const old = read(store);
    if (old && old.userId === userId && old.version === version) for (const q of old.queries) byHash.set(q.queryHash, q);
    for (const q of current) byHash.set(q.queryHash, q);
    const minTime = Date.now() - MAX_AGE_MS;
    const queries = [...byHash.values()]
      .filter((q) => usable(q, minTime))
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
      .slice(0, MAX_ENTRIES);
    store.setItem(PERSIST_KEY, JSON.stringify({ userId, version, queries } satisfies Saved));
  } catch {
    drop(store); // место кончилось или память недоступна — сайт работает без сохранённого кэша
  }
}

/** Возвращает справочники в память, если их сохранил этот же пользователь на этой же версии сайта */
export function restoreQueryCache(client: QueryClient, userId: string, store: Store | null = browserStore(), version = appVersion()): boolean {
  if (!store) return false;
  const saved = read(store);
  if (!saved || saved.userId !== userId || saved.version !== version) {
    drop(store);
    return false;
  }
  const minTime = Date.now() - MAX_AGE_MS;
  const queries = saved.queries.filter((q) => usable(q, minTime));
  if (queries.length === 0) return false;
  try {
    hydrate(client, { mutations: [], queries });
    return true;
  } catch {
    drop(store);
    return false;
  }
}

export function clearSavedQueryCache(store: Store | null = browserStore()): void {
  if (store) drop(store);
}

/** Следит за кэшем и сохраняет справочники вскоре после их обновления. Возвращает функцию отписки. */
export function persistQueryCache(client: QueryClient, getUserId: () => string | null, store: Store | null = browserStore()): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || !isReference(event.query.queryKey)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const userId = getUserId();
      if (userId) saveQueryCache(client, userId, store);
    }, SAVE_DELAY_MS);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
