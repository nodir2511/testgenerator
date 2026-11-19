import { describe, expect, it } from 'vitest';
import {
  blankFor, keyToText, maxPoints, parseKey, parseMatchingKey, parseOpenKey, parseTestsKey, scoreAnswers,
  type Answers, type TicketKey,
} from '../supabase/functions/_shared/omrScore';

const comp = { test: 3, matching: 2, open: 2 };
const key: TicketKey = { tests: ['A', 'B', 'C'], matching: [['1', '2', '3', '4'], ['5', '4', '3', '2']], open: ['12', '700'] };

describe('баллы за бланк', () => {
  it('максимум: тест 1, пункт соответствия 1, открытый 2', () => {
    expect(maxPoints(comp)).toBe(3 + 2 * 4 + 2 * 2);
    expect(maxPoints({ test: 18, matching: 2, open: 7 })).toBe(40);
    expect(maxPoints({ test: 20, matching: 4, open: 2 })).toBe(40);
    expect(maxPoints({ test: 8, matching: 2, open: 2 })).toBe(20);
  });

  it('все ответы верны — полный балл', () => {
    const ans: Answers = { tests: ['A', 'B', 'C'], matching: [['1', '2', '3', '4'], ['5', '4', '3', '2']], open: ['12', '700'] };
    const s = scoreAnswers(key, ans);
    expect(s.score).toBe(s.max);
    expect(s.max).toBe(15);
  });

  it('считает по пунктам соответствия и не засчитывает пустое и «несколько отметок»', () => {
    const ans: Answers = { tests: ['A', null, 'D'], matching: [['1', '2', '4', '4'], [null, '4', '3', '2']], open: ['12', '70'] };
    const s = scoreAnswers(key, ans);
    expect(s.tests).toEqual([true, false, false]);
    expect(s.matching).toEqual([[true, true, false, true], [false, true, true, true]]);
    expect(s.open).toEqual([true, false]);
    expect(s.score).toBe(1 + 6 + 2);
  });

  it('открытый ответ сравнивается как целое: ведущие нули не мешают, пустое не засчитывается', () => {
    const k: TicketKey = { tests: [], matching: [], open: ['7', '0', null] };
    expect(scoreAnswers(k, { tests: [], matching: [], open: ['007', '0', '5'] }).open).toEqual([true, true, false]);
    expect(scoreAnswers(k, { tests: [], matching: [], open: ['', '', ''] }).score).toBe(0);
  });

  it('без ключа к заданию (null) балл не даётся', () => {
    const k: TicketKey = { tests: [null, 'A'], matching: [], open: [] };
    expect(scoreAnswers(k, { tests: ['A', 'A'], matching: [], open: [] }).score).toBe(1);
  });
});

describe('вид бланка по составу билета', () => {
  it('находит бланк по составу', () => {
    expect(blankFor({ test: 18, matching: 2, open: 7 })?.layouts).toEqual(['chem', 'phys']);
    expect(blankFor({ test: 20, matching: 4, open: 2 })?.layouts).toEqual(['bio', 'taj']);
    expect(blankFor({ test: 8, matching: 2, open: 2 })?.layouts).toEqual(['chemphys']);
    expect(blankFor({ test: 10, matching: 2, open: 3 })).toBeNull();
  });
});

describe('ключ, введённый вручную', () => {
  it('тесты: буквы, пробелы и кириллические А, В, С допускаются', () => {
    expect(parseTestsKey('a b С', 3)).toEqual({ value: ['A', 'B', 'C'] });
    expect('error' in parseTestsKey('ABE', 3)).toBe(true);
    expect('error' in parseTestsKey('AB', 3)).toBe(true);
  });
  it('соответствия: группы по четыре цифры 1–5', () => {
    expect(parseMatchingKey('1234 5432', 2)).toEqual({ value: [['1', '2', '3', '4'], ['5', '4', '3', '2']] });
    expect('error' in parseMatchingKey('1234 5462', 2)).toBe(true);
    expect('error' in parseMatchingKey('1234', 2)).toBe(true);
  });
  it('открытые: целые до пяти цифр', () => {
    expect(parseOpenKey('12 0700', 2)).toEqual({ value: ['12', '700'] });
    expect('error' in parseOpenKey('12 2,5', 2)).toBe(true);
    expect(parseOpenKey('12345 1', 2)).toEqual({ value: ['12345', '1'] });
    expect('error' in parseOpenKey('123456 1', 2)).toBe(true);
  });
  it('полный ключ собирается и возвращается в текст', () => {
    const r = parseKey({ tests: 'ABC', matching: '1234 5432', open: '12 700' }, comp);
    expect(r).toEqual({ value: key });
    expect(keyToText(key)).toEqual({ tests: 'ABC', matching: '1234 5432', open: '12 700' });
  });
});
