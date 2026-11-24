// Ключ открытого вопроса: ученик вписывает ответ в клетки бланка по одной цифре, поэтому ключ —
// целое число без минуса и дробей, не длиннее клеток предмета. Ноль допустим (он встречается в заданиях НЦТ).
import { parseNumericAnswer, type ParsedRow } from './importParse';

/** Клеток под открытый ответ, как на бланке: у таджикского и английского языков 5, у остальных предметов 4 (то же правило — openBoxesFor в lib/docxExport, совпадение проверяет тест) */
export const OPEN_CELLS = 4;
export const openCellsFor = (subject: string | null | undefined): number =>
  /англ|инглис|english|тоҷик|таджик|забони/.test((subject || '').toLowerCase()) ? 5 : OPEN_CELLS;

const cellsWord = (n: number) => (n === 1 ? 'клетка' : n < 5 ? 'клетки' : 'клеток');
const show = (v: number) => String(v).replace('-', '−').replace('.', ',');

/** Почему ключ не годится для бланка; null — годится (или ответа нет: это отдельная проверка) */
export function openAnswerProblem(value: number | null | undefined, subjectName?: string | null): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return Number.isFinite(value)
      ? `Ответ открытого вопроса должен быть целым числом: «${show(value)}» в клетки бланка не вписать`
      : 'Ответ открытого вопроса должен быть целым числом';
  }
  if (value < 0) return `Ответ открытого вопроса не может быть отрицательным (${show(value)}): в клетках бланка нет места для минуса`;
  const cells = openCellsFor(subjectName);
  const digits = String(value).length;
  if (digits > cells) return `В ответе ${digits} цифр, а на бланке ${cells} ${cellsWord(cells)} — такой ответ ученик не впишет`;
  return null;
}

const MARK = 'Ключ: ';

/** Строка импорта: открытый вопрос с неподходящим ключом получает ошибку и в банк не идёт. Считается заново при каждом вызове (предмет строки может смениться) */
export function withOpenAnswerError(row: ParsedRow): ParsedRow {
  const had = row.errors.some((e) => e.startsWith(MARK));
  const problem = row.type === 'open' ? openAnswerProblem(parseNumericAnswer(row.correctAnswer), row.subjectName) : null;
  if (!had && !problem) return row;
  const rest = had ? row.errors.filter((e) => !e.startsWith(MARK)) : row.errors;
  return { ...row, errors: problem ? [...rest, MARK + problem] : rest };
}
