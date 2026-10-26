// Название набора билетов, которое подставляется само: «Химия — гл. 1–3, 5 — 26.10».
// Нужно, чтобы наборы в архиве различались без ручного ввода названия.

export const DEFAULT_BATCH_TITLE = 'Экзаменационные билеты';

/** [1, 2, 3, 5, 7, 8] → «1–3, 5, 7–8» */
export function compressRanges(nums: number[]): string {
  const sorted = Array.from(new Set(nums)).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? String(start) : `${start}–${sorted[i]}`);
  }
  return parts.join(', ');
}

/**
 * @param chapterNums номера выбранных глав (с 1); null или пустой — весь предмет
 */
export function autoBatchTitle(subjectName: string, chapterNums: number[] | null, date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  let scope = 'весь предмет';
  if (chapterNums && chapterNums.length > 0) {
    const ranges = compressRanges(chapterNums);
    // Слишком пёстрый выбор глав не влезет в название — пишем, сколько их
    scope = ranges.split(', ').length > 4 ? `${new Set(chapterNums).size} гл.` : `гл. ${ranges}`;
  }
  return [subjectName.trim() || 'Билеты', scope, `${dd}.${mm}`].join(' — ');
}
