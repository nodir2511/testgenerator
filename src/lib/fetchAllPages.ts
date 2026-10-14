// Supabase отдаёт не больше 1000 строк за запрос — читаем постранично
export async function fetchAllPages<T>(build: () => any): Promise<{ data: T[] | null; error: any }> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order('id').range(from, from + 999);
    if (error) return { data: null, error };
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: all, error: null };
}
