import { describe, expect, it } from 'vitest';
import { fetchAllPages } from '../src/lib/fetchAllPages';

// Имитация запроса Supabase: .order('id').range(from, to) отдаёт не больше 1000 строк
function fakeBuilder(total: number, failAt?: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  let calls = 0;
  const build = () => ({
    order: () => ({
      range: async (from: number, to: number) => {
        calls++;
        if (failAt !== undefined && from === failAt) return { data: null, error: new Error('boom') };
        await new Promise((r) => setTimeout(r, Math.random() * 3)); // страницы приходят в произвольном порядке
        return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
      },
    }),
  });
  return { build, calls: () => calls };
}

describe('fetchAllPages', () => {
  for (const total of [0, 1, 999, 1000, 1001, 1999, 2000, 4999, 5000, 5001, 8999, 9000, 12345]) {
    it(`читает все строки по порядку (${total})`, async () => {
      const { build } = fakeBuilder(total);
      const { data, error } = await fetchAllPages<{ id: number }>(build);
      expect(error).toBeNull();
      expect(data!.length).toBe(total);
      expect(data!.every((r, i) => r.id === i)).toBe(true);
    });
  }

  it('возвращает ошибку любой страницы', async () => {
    for (const failAt of [0, 1000, 3000, 5000]) {
      const { build } = fakeBuilder(9000, failAt);
      const { data, error } = await fetchAllPages(build);
      expect(data).toBeNull();
      expect(error).toBeInstanceOf(Error);
    }
  });
});
