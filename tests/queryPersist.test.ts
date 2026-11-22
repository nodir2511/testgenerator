import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { PERSIST_KEY, clearSavedQueryCache, restoreQueryCache, saveQueryCache } from '../src/lib/queryPersist';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

const DAY = 24 * 60 * 60 * 1000;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } } });
/** Кладёт в кэш успешный ответ запроса, полученный updatedAt миллисекунд назад */
const put = (c: QueryClient, key: unknown[], data: unknown, ageMs = 0) => c.setQueryData(key, data, { updatedAt: Date.now() - ageMs });

describe('кэш справочников между визитами', () => {
  it('сохранённые справочники появляются у того же пользователя сразу после открытия сайта', () => {
    const storage = memoryStorage();
    const before = client();
    put(before, ['subjects'], [{ id: 's1', name: 'Химия' }]);
    put(before, ['topics_for_generation', 's1'], [{ id: 'c1', topics: [] }]);
    put(before, ['question_counts', 's1'], [{ topic_id: 't1', type: 'test', cnt: 5 }]);
    saveQueryCache(before, 'user-1', storage);

    const after = client();
    expect(restoreQueryCache(after, 'user-1', storage)).toBe(true);
    expect(after.getQueryData(['subjects'])).toEqual([{ id: 's1', name: 'Химия' }]);
    expect(after.getQueryData(['topics_for_generation', 's1'])).toEqual([{ id: 'c1', topics: [] }]);
    expect(after.getQueryData(['question_counts', 's1'])).toEqual([{ topic_id: 't1', type: 'test', cnt: 5 }]);
  });

  it('восстановленные данные помнят своё время: устаревшие сайт перечитает в фоне', () => {
    const storage = memoryStorage();
    const before = client();
    put(before, ['subjects'], [{ id: 's1' }], 2 * 60 * 60 * 1000);
    saveQueryCache(before, 'user-1', storage);

    const after = client();
    restoreQueryCache(after, 'user-1', storage);
    const state = after.getQueryState(['subjects'])!;
    expect(Date.now() - state.dataUpdatedAt).toBeGreaterThan(60 * 60 * 1000);
    expect(after.getQueryCache().find({ queryKey: ['subjects'] })!.isStaleByTime(5 * 60_000)).toBe(true);
  });

  it('другому пользователю чужой кэш не достаётся и стирается', () => {
    const storage = memoryStorage();
    const before = client();
    put(before, ['subjects'], [{ id: 's1' }]);
    saveQueryCache(before, 'user-1', storage);

    const after = client();
    expect(restoreQueryCache(after, 'user-2', storage)).toBe(false);
    expect(after.getQueryData(['subjects'])).toBeUndefined();
    expect(storage.getItem(PERSIST_KEY)).toBeNull();
  });

  it('сохраняются только справочники: вопросы, наборы билетов и версии — нет', () => {
    const storage = memoryStorage();
    const before = client();
    put(before, ['subjects'], [{ id: 's1' }]);
    put(before, ['questions', 's1', 0], { questions: [{ id: 'q1', content: 'текст' }] });
    put(before, ['saved_ticket_batches', '', ''], { pages: [] });
    put(before, ['site-releases-unread', 'user-1'], []);
    saveQueryCache(before, 'user-1', storage);

    expect(storage.getItem(PERSIST_KEY)).not.toMatch(/текст|saved_ticket_batches|site-releases/);
    const after = client();
    restoreQueryCache(after, 'user-1', storage);
    expect(after.getQueryData(['questions', 's1', 0])).toBeUndefined();
  });

  it('запрос с ошибкой не сохраняется', async () => {
    const storage = memoryStorage();
    const before = client();
    await before.fetchQuery({ queryKey: ['subjects'], queryFn: async () => { throw new Error('сеть'); } }).catch(() => {});
    saveQueryCache(before, 'user-1', storage);
    const after = client();
    restoreQueryCache(after, 'user-1', storage);
    expect(after.getQueryState(['subjects'])).toBeUndefined();
  });

  it('справочник, которого сейчас нет в памяти, остаётся в сохранённом кэше', () => {
    const storage = memoryStorage();
    const first = client();
    put(first, ['question_counts', 's1'], [{ cnt: 1 }]);
    saveQueryCache(first, 'user-1', storage);
    const second = client(); // открыта другая вкладка сайта: счётчиков в памяти нет
    put(second, ['subjects'], [{ id: 's1' }]);
    saveQueryCache(second, 'user-1', storage);

    const after = client();
    restoreQueryCache(after, 'user-1', storage);
    expect(after.getQueryData(['question_counts', 's1'])).toEqual([{ cnt: 1 }]);
    expect(after.getQueryData(['subjects'])).toEqual([{ id: 's1' }]);
  });

  it('данные старше недели не восстанавливаются', () => {
    const storage = memoryStorage();
    const before = client();
    put(before, ['subjects'], [{ id: 's1' }], 8 * DAY);
    put(before, ['generation_settings'], { per_day: 5 }, DAY);
    saveQueryCache(before, 'user-1', storage);
    const after = client();
    restoreQueryCache(after, 'user-1', storage);
    expect(after.getQueryData(['subjects'])).toBeUndefined();
    expect(after.getQueryData(['generation_settings'])).toEqual({ per_day: 5 });
  });

  it('кэш от другой версии сайта не восстанавливается', () => {
    const storage = memoryStorage();
    const before = client();
    put(before, ['subjects'], [{ id: 's1' }]);
    saveQueryCache(before, 'user-1', storage, '1.0.0');
    const after = client();
    expect(restoreQueryCache(after, 'user-1', storage, '1.1.0')).toBe(false);
    expect(after.getQueryData(['subjects'])).toBeUndefined();
  });

  it('испорченная запись и недоступное хранилище не роняют сайт', () => {
    const broken = memoryStorage({ [PERSIST_KEY]: '{не json' });
    expect(restoreQueryCache(client(), 'user-1', broken)).toBe(false);
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    const c = client();
    put(c, ['subjects'], [{ id: 's1' }]);
    expect(() => saveQueryCache(c, 'user-1', full)).not.toThrow();
  });

  it('после выхода сохранённый кэш стирается', () => {
    const storage = memoryStorage();
    const c = client();
    put(c, ['subjects'], [{ id: 's1' }]);
    saveQueryCache(c, 'user-1', storage);
    clearSavedQueryCache(storage);
    expect(storage.getItem(PERSIST_KEY)).toBeNull();
  });
});
