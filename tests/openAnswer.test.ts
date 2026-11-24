import { describe, expect, it } from 'vitest';
import { openAnswerProblem, openCellsFor, withOpenAnswerError } from '../src/lib/openAnswer';
import { openCellsFor as examCells } from '../src/exam/examLogic';
import type { ParsedRow } from '../src/lib/importParse';

describe('openAnswerProblem: ключ открытого вопроса должен вписываться в клетки бланка', () => {
  it('ответа нет — это не ошибка ключа', () => {
    expect(openAnswerProblem(null, 'Физика')).toBeNull();
    expect(openAnswerProblem(undefined, 'Физика')).toBeNull();
  });
  it('целое без минуса, не длиннее клеток — подходит (ноль тоже)', () => {
    for (const v of [0, 1, 42, 9999]) expect(openAnswerProblem(v, 'Физика')).toBeNull();
    expect(openAnswerProblem(13579, 'Таджикский язык')).toBeNull();
    expect(openAnswerProblem(99999, 'Английский язык')).toBeNull();
  });
  it('дробный ответ не подходит', () => {
    expect(openAnswerProblem(62.5, 'Математика')).toMatch(/целым/);
    expect(openAnswerProblem(0.6, 'Математика')).toMatch(/целым/);
  });
  it('отрицательный ответ не подходит', () => {
    expect(openAnswerProblem(-273, 'Физика')).toMatch(/отрицательным/);
  });
  it('ответ длиннее клеток предмета не подходит', () => {
    expect(openAnswerProblem(10000, 'Математика')).toBe('В ответе 5 цифр, а на бланке 4 клетки — такой ответ ученик не впишет');
    expect(openAnswerProblem(13579, 'Физика')).toMatch(/5 цифр.*4 клетки/);
    expect(openAnswerProblem(123456, 'Таджикский язык')).toBe('В ответе 6 цифр, а на бланке 5 клеток — такой ответ ученик не впишет');
  });
  it('не число — не подходит', () => {
    expect(openAnswerProblem(Number('abc'), 'Физика')).toMatch(/целым/);
    expect(openAnswerProblem(Infinity, 'Физика')).toMatch(/целым/);
  });
  it('предмет не указан — считаем 4 клетки', () => {
    expect(openAnswerProblem(9999, '')).toBeNull();
    expect(openAnswerProblem(10000, null)).toMatch(/4 клетки/);
  });
  it('страница ученика берёт то же число клеток', () => {
    for (const s of ['Таджикский язык', 'Английский язык', 'Физика', '']) expect(examCells(s)).toBe(openCellsFor(s));
  });
});

describe('поле ответа в форме вопроса', () => {
  const html = async (correctNumeric: string, subjectName: string) => {
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { OpenAnswerEditor } = await import('../src/components/question-form/OpenAnswerEditor');
    return renderToStaticMarkup(React.createElement(OpenAnswerEditor, { correctNumeric, setCorrectNumeric: () => {}, subjectName }));
  };
  it('пустое поле и подходящий ответ — подсказка с числом клеток предмета', async () => {
    expect(await html('', 'Физика')).toContain('не длиннее 4 цифр');
    expect(await html('13579', 'Таджикский язык')).toContain('не длиннее 5 цифр');
    expect(await html('42', 'Физика')).not.toContain('role="alert"');
  });
  it('неподходящий ответ — причина и предупреждение, что вопрос не сохранится', async () => {
    const bad = await html('62.5', 'Математика');
    expect(bad).toContain('role="alert"');
    expect(bad).toContain('должен быть целым числом');
    expect(bad).toContain('не сохранится');
    expect(await html('13579', 'Физика')).toContain('5 цифр, а на бланке 4 клетки');
    expect(await html('-5', 'Физика')).toContain('не может быть отрицательным');
  });
});

const row = (over: Partial<ParsedRow>): ParsedRow => ({
  rowNum: 1, type: 'open', content: 'Условие', subjectName: 'Математика', chapterName: 'Глава 1', topicName: 'Тема', errors: [], ...over,
});

describe('withOpenAnswerError: строка импорта с неподходящим ключом — ошибка', () => {
  it('дробь, минус и длинный ответ дают ошибку строки', () => {
    expect(withOpenAnswerError(row({ correctAnswer: '62,5' })).errors).toHaveLength(1);
    expect(withOpenAnswerError(row({ correctAnswer: '3/5' })).errors[0]).toMatch(/целым/);
    expect(withOpenAnswerError(row({ correctAnswer: '−10' })).errors[0]).toMatch(/отрицательным/);
    expect(withOpenAnswerError(row({ correctAnswer: '16800' })).errors[0]).toMatch(/5 цифр/);
  });
  it('подходящий ключ, пустой ответ и нераспознанный ответ строку не трогают', () => {
    for (const a of ['42', '0', '9999', undefined, '', 'много']) {
      const r = row({ correctAnswer: a });
      expect(withOpenAnswerError(r)).toBe(r);
    }
  });
  it('число клеток — по предмету строки', () => {
    expect(withOpenAnswerError(row({ correctAnswer: '13579', subjectName: 'Таджикский язык' })).errors).toEqual([]);
    expect(withOpenAnswerError(row({ correctAnswer: '13579', subjectName: 'Физика' })).errors).toHaveLength(1);
  });
  it('тест и соответствие не проверяются', () => {
    const t = row({ type: 'test', correctAnswer: '16800' });
    expect(withOpenAnswerError(t)).toBe(t);
  });
  it('повторное применение ошибку не удваивает, прежние ошибки сохраняются', () => {
    const once = withOpenAnswerError(row({ correctAnswer: '62,5', errors: ['Не указана тема'] }));
    expect(once.errors).toHaveLength(2);
    expect(withOpenAnswerError(once).errors).toHaveLength(2);
  });
  it('после смены предмета ошибка считается заново', () => {
    const phys = withOpenAnswerError(row({ correctAnswer: '13579', subjectName: 'Физика' }));
    expect(withOpenAnswerError({ ...phys, subjectName: 'Таджикский язык' }).errors).toEqual([]);
  });
});
