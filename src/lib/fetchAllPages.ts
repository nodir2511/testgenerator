import { inIdWindow, readAllById } from '../../supabase/functions/_shared/pool';

// Supabase отдаёт не больше 1000 строк за запрос — читаем постранично.
// Страницы — окна по id, а не смещение: база не собирает заново уже прочитанные строки (см. readAllById в pool.ts).
// build() возвращает запрос с фильтрами; в выборке обязано быть поле id. Строки приходят по порядку id.
export async function fetchAllPages<T>(build: () => any): Promise<{ data: T[] | null; error: any }> {
  try {
    const data = await readAllById<any>(async (w) => {
      const { data: rows, error } = await inIdWindow(build(), w);
      if (error) throw error;
      return rows || [];
    });
    return { data: data as T[], error: null };
  } catch (error) {
    return { data: null, error };
  }
}
