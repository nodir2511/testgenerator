import { describe, expect, it } from 'vitest';
import {
  answerText, checkSlot, hasAnswer, orderByType, parseMatchKey, parseNumber, snapshotFromPaired, withAnswer,
} from '../src/lib/clusterTickets';
import type { PairedQuestion } from '../src/lib/docxPair';

const pq = (over: Partial<PairedQuestion>): PairedQuestion => ({
  num: '1', type: 'test', content: 'Вопрос', contentTg: 'Савол', errors: [], warnings: [], ...over,
});

const test = (answer?: string) => snapshotFromPaired(pq({
  options: ['a', 'b', 'c', 'd'].map((t) => ({ text: t, textTg: t + 'т' })), correctAnswer: answer,
}), 'q1');

const matching = (answer?: string) => snapshotFromPaired(pq({
  type: 'matching',
  correctAnswer: answer,
  matchingItems: [
    ...[1, 2, 3, 4].map((i) => ({ side: 'left' as const, text: `L${i}`, textTg: `ЛT${i}`, orderIndex: i })),
    ...[1, 2, 3, 4, 5].map((i) => ({ side: 'right' as const, text: `R${i}`, textTg: `РT${i}`, orderIndex: i })),
  ],
}), 'q2');

describe('книжка кластера из готовых билетов', () => {
  it('ответ теста из Word: латинская и кириллическая буква', () => {
    expect(answerText(test('C'))).toBe('C');
    expect(answerText(test('В'))).toBe('B'); // кириллическая «В» в сборниках — это латинская B
    expect(hasAnswer(test())).toBe(false);
  });

  it('тексты на двух языках попадают в снимок', () => {
    const s = test('A');
    expect(s.content_ru).toBe('Вопрос');
    expect(s.content_tg).toBe('Савол');
    expect(s.options[1].text_tg).toBe('bт');
  });

  it('ключ соответствия: цифрами, через дефис и с буквами строк', () => {
    expect(parseMatchKey('1352')).toEqual([1, 3, 5, 2]);
    expect(parseMatchKey('1-3-5-2')).toEqual([1, 3, 5, 2]);
    expect(parseMatchKey('А-1, Б-3, В-5, Г-2')).toEqual([1, 3, 5, 2]); // «В» здесь третья строка
    expect(parseMatchKey('A1 B3 C5 D2')).toEqual([1, 3, 5, 2]);
    expect(parseMatchKey('')).toEqual([null, null, null, null]);
  });

  it('соответствие без ключа в файле: ответ вводится вручную', () => {
    const s = matching();
    expect(hasAnswer(s)).toBe(false);
    const fixed = withAnswer(s, '2451');
    expect(answerText(fixed)).toBe('2451');
    expect(hasAnswer(fixed)).toBe(true);
    expect(answerText(matching('1352'))).toBe('1352');
  });

  it('неполный ключ соответствия не считается ответом', () => {
    const s = withAnswer(matching(), '13');
    expect(answerText(s)).toBe('13··');
    expect(hasAnswer(s)).toBe(false);
  });

  it('открытый вопрос: число с запятой, дробь, не число', () => {
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('1/4')).toBe(0.25);
    expect(parseNumber('−3')).toBe(-3);
    expect(parseNumber('abc')).toBeNull();
    const open = snapshotFromPaired(pq({ type: 'open', correctAnswer: '24' }), 'q3');
    expect(answerText(open)).toBe('24');
    expect(answerText(withAnswer(open, '7,5'))).toBe('7,5');
  });

  it('правка ответа теста меняет только верный вариант', () => {
    const s = withAnswer(test('A'), 'd');
    expect(answerText(s)).toBe('D');
    expect(s.options.filter((o: any) => o.is_correct)).toHaveLength(1);
  });

  it('порядок в книжке: тесты, соответствия, открытые', () => {
    const open = snapshotFromPaired(pq({ type: 'open', correctAnswer: '1' }), 'o');
    expect(orderByType([open, matching('1111'), test('A')]).map((s) => s.type)).toEqual(['test', 'matching', 'open']);
  });

  it('проверка билета: состав и задания без ответа', () => {
    const snaps = [test('A'), test(), matching('1352')];
    const c = checkSlot(snaps, { test: 2, matching: 1, open: 1 });
    expect(c.counts).toEqual({ test: 2, matching: 1, open: 0 });
    expect(c.missing).toEqual([2]);
    expect(c.notes).toEqual(['открытых 0 вместо 1']);
  });
});
