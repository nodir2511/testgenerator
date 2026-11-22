import { describe, expect, it } from 'vitest';
import { fetchAllPages } from '../src/lib/fetchAllPages';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
/** Случайные uuid, как в базе */
const randomIds = (total: number, seed = 7) => {
  const r = rng(seed);
  return Array.from({ length: total }, () => `${hex(r, 8)}-${hex(r, 4)}-${hex(r, 4)}-${hex(r, 4)}-${hex(r, 12)}`);
};
/** uuid подряд: 00000000-0000-0000-0000-000000000001, …002 — почти все в одном месте диапазона */
const sequentialIds = (total: number) => Array.from({ length: total }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`);

// Имитация запроса Supabase: фильтры по id (gt, gte, lt), order('id'), limit; за запрос не больше 1000 строк.
// Метода range (чтение по смещению) нет намеренно: обращение к нему уронит тест.
function fakeBuilder(ids: Array<string | number>, failOnCall?: number) {
  const rows = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((id) => ({ id }));
  const sizes: number[] = [];
  let calls = 0;
  const build = () => {
    const f: { after?: any; from?: any; before?: any; limit?: number } = {};
    const q: any = {
      order: () => q,
      gt: (_c: string, v: any) => { f.after = v; return q; },
      gte: (_c: string, v: any) => { f.from = v; return q; },
      lt: (_c: string, v: any) => { f.before = v; return q; },
      limit: (n: number) => { f.limit = n; return q; },
      then: (resolve: (v: any) => void) => {
        const call = ++calls;
        setTimeout(() => { // страницы приходят в произвольном порядке
          if (failOnCall === call) return resolve({ data: null, error: new Error('boom') });
          const data = rows
            .filter((r) => (f.after === undefined || r.id > f.after) && (f.from === undefined || r.id >= f.from) && (f.before === undefined || r.id < f.before))
            .slice(0, Math.min(f.limit ?? 1000, 1000));
          sizes.push(data.length);
          resolve({ data, error: null });
        }, Math.random() * 3);
      },
    };
    return q;
  };
  return { build, rows, sizes, calls: () => calls };
}

describe('fetchAllPages', () => {
  for (const total of [0, 1, 999, 1000, 1001, 1999, 2000, 4999, 5000, 5001, 9000, 12345]) {
    it(`читает все строки по порядку id (${total})`, async () => {
      const { build, rows, sizes } = fakeBuilder(randomIds(total));
      const { data, error } = await fetchAllPages<{ id: string }>(build);
      expect(error).toBeNull();
      expect(data!.map((r) => r.id)).toEqual(rows.map((r) => r.id));
      // ни одна строка не читается дважды: база не делает лишней работы
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(total);
    });
  }

  it('большой предмет читается немногими запросами', async () => {
    const { build, calls } = fakeBuilder(randomIds(9600));
    await fetchAllPages(build);
    expect(calls()).toBeLessThanOrEqual(16);
  });

  it('идентификаторы подряд (не случайные) тоже читаются полностью', async () => {
    const { build, rows } = fakeBuilder(sequentialIds(3500));
    const { data, error } = await fetchAllPages<{ id: string }>(build);
    expect(error).toBeNull();
    expect(data!.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it('скопление идентификаторов в одном месте диапазона читается полностью', async () => {
    const ids = [...randomIds(2500), ...randomIds(3000, 11).map((id) => `7abc${id.slice(4)}`)];
    const { build, rows } = fakeBuilder(ids);
    const { data } = await fetchAllPages<{ id: string }>(build);
    expect(data!.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it('идентификаторы не в виде uuid читаются страницами подряд', async () => {
    const { build } = fakeBuilder(Array.from({ length: 2345 }, (_, i) => i));
    const { data } = await fetchAllPages<{ id: number }>(build);
    expect(data!.map((r) => r.id)).toEqual(Array.from({ length: 2345 }, (_, i) => i));
  });

  it('возвращает ошибку любой страницы', async () => {
    for (const failOnCall of [1, 2, 4, 7]) {
      const { build } = fakeBuilder(randomIds(9000), failOnCall);
      const { data, error } = await fetchAllPages(build);
      expect(data).toBeNull();
      expect(error).toBeInstanceOf(Error);
    }
  });
});
