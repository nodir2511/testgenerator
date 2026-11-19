import { describe, expect, it } from 'vitest';
import { checkInputFromBank, contentChecks } from '../src/lib/questionChecks';
import { questionIssues } from '../src/lib/questionIssues';
import { isMissingPassages, passageLabel } from '../src/lib/passages';

const opts = (n = 4) => Array.from({ length: n }, (_, i) => ({ text: `opt${i}`, is_correct: i === 0 }));

describe('проверки вопросов к тексту', () => {
  it('пропуск с passage_id и пустым условием — не «пустой текст»', () => {
    expect(contentChecks({ type: 'test', content: '', passage_id: 'P1', options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }] })).not.toContain('empty_text');
  });
  it('без passage_id пустое условие по-прежнему ошибка', () => {
    expect(contentChecks({ type: 'test', content: '  ', options: [{ text: 'a' }, { text: 'b' }] })).toContain('empty_text');
  });
  it('passage_id у вопроса банка доходит до проверки', () => {
    const q = { type: 'test', content: '', passage_id: 'P1', options: opts() };
    expect(checkInputFromBank(q).passage_id).toBe('P1');
    expect(contentChecks(checkInputFromBank(q))).not.toContain('empty_text');
  });
  it('пустой вариант и одинаковые варианты у вопроса к тексту всё равно ловятся', () => {
    const codes = contentChecks({ type: 'test', content: '', passage_id: 'P1', options: [{ text: 'a' }, { text: 'a' }, { text: '' }] });
    expect(codes).toContain('dup_options');
    expect(codes).toContain('empty_option');
  });
});

describe('questionIssues для вопроса к тексту', () => {
  it('пустое условие не считается проблемой', () => {
    const issues = questionIssues({ type: 'test', content: '', passage_id: 'P1', options: opts() } as any);
    expect(issues).toEqual([]);
  });
});

describe('lib/passages', () => {
  it('подпись текста', () => {
    expect(passageLabel({ kind: 'reading', title: 'Space Tourism' }, 3)).toBe('Чтение: Space Tourism · № 3');
    expect(passageLabel({ kind: 'cloze', title: '  ' })).toBe('Пропуски: без названия');
    expect(passageLabel(null)).toBe('');
  });
  it('отсутствие таблицы распознаётся', () => {
    expect(isMissingPassages({ code: '42P01' })).toBe(true);
    expect(isMissingPassages({ code: 'PGRST205' })).toBe(true);
    expect(isMissingPassages({ message: 'relation "public.passages" does not exist' })).toBe(true);
    expect(isMissingPassages({ message: 'permission denied for table passages' })).toBe(false);
    expect(isMissingPassages(null)).toBe(false);
  });
});
