import { describe, expect, it } from 'vitest';
import { answerWarning, isCorrectLetter, langFields, normText, parseNumericAnswer } from '../src/lib/importParse';

describe('импорт: разбор ответа открытого вопроса', () => {
  it('число с запятой и с точкой', () => {
    expect(parseNumericAnswer('12,5')).toBe(12.5);
    expect(parseNumericAnswer(' 16 ')).toBe(16);
    expect(parseNumericAnswer('−3.5')).toBe(-3.5);
  });
  it('дробь и число с разрядами', () => {
    expect(parseNumericAnswer('1/4')).toBe(0.25);
    expect(parseNumericAnswer('12 000')).toBe(12000);
  });
  it('не число, пусто, степень десяти — null', () => {
    expect(parseNumericAnswer('abc')).toBeNull();
    expect(parseNumericAnswer('')).toBeNull();
    expect(parseNumericAnswer(undefined)).toBeNull();
    expect(parseNumericAnswer('12,04·10²³')).toBeNull();
  });
  it('предупреждение только у открытого с нераспознанным ответом', () => {
    expect(answerWarning('open', 'много')).toHaveLength(1);
    expect(answerWarning('open', '16')).toEqual([]);
    expect(answerWarning('open', undefined)).toEqual([]);
    expect(answerWarning('test', 'много')).toEqual([]);
  });
});

describe('импорт: буква верного варианта', () => {
  it('латинские буквы по месту варианта', () => {
    expect(isCorrectLetter('B', 1)).toBe(true);
    expect(isCorrectLetter(' b ', 1)).toBe(true);
    expect(isCorrectLetter('A', 1)).toBe(false);
    expect(isCorrectLetter(undefined, 0)).toBe(false);
  });
  it('кириллические двойники А, В, С, Е считаются латинскими', () => {
    expect(isCorrectLetter('А', 0)).toBe(true);
    expect(isCorrectLetter('В', 1)).toBe(true);
    expect(isCorrectLetter('С', 2)).toBe(true);
    expect(isCorrectLetter('Е', 4)).toBe(true);
  });
});

describe('импорт: тексты', () => {
  it('normText убирает теги, лишние пробелы и регистр', () => {
    expect(normText('<b>Да</b>  Нет ')).toBe('да нет');
    expect(normText(null)).toBe('');
  });
  it('langFields: один язык и пара языков', () => {
    expect(langFields('ru', 'вода')).toEqual({ text: 'вода', text_ru: 'вода', text_tg: null });
    expect(langFields('tg', 'об')).toEqual({ text: 'об', text_ru: null, text_tg: 'об' });
    expect(langFields('ru', 'вода', 'об')).toEqual({ text: 'вода', text_ru: 'вода', text_tg: 'об' });
    expect(langFields('ru', 'вода', '')).toEqual({ text: 'вода', text_ru: 'вода', text_tg: null });
  });
});
