// Supabase отдаёт не больше 1000 строк за запрос — читаем постранично.
// Первая страница одна; если она полная, следующие запрашиваются пачками по PARALLEL штук одновременно
// (порядок строк тот же, что при последовательном чтении).
const PAGE = 1000;
const PARALLEL = 4;

export async function fetchAllPages<T>(build: () => any): Promise<{ data: T[] | null; error: any }> {
  const page = (from: number) => build().order('id').range(from, from + PAGE - 1);
  const first = await page(0);
  if (first.error) return { data: null, error: first.error };
  const all: T[] = [...(first.data || [])];
  if (all.length < PAGE) return { data: all, error: null };
  for (let from = PAGE; ; from += PAGE * PARALLEL) {
    const results = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => page(from + i * PAGE)));
    for (const r of results) {
      if (r.error) return { data: null, error: r.error };
      all.push(...(r.data || []));
    }
    if (results.some((r) => (r.data?.length ?? 0) < PAGE)) break;
  }
  return { data: all, error: null };
}
