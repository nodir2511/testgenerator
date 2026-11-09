import { describe, expect, it } from 'vitest';
import { contentChecks, formatProblem } from '../src/lib/questionChecks';

const opts = (...t: string[]) => t.map((text) => ({ text }));

describe('formatProblem', () => {
  it('нормальное оформление проходит', () => {
    expect(formatProblem('H<sub>2</sub>SO<sub>4</sub> и <b>жирный <i>курсив</i></b>')).toBe(false);
    expect(formatProblem('x < 5 и y > 3')).toBe(false);
  });
  it('ловит незакрытые, лишние, пустые и неизвестные теги', () => {
    expect(formatProblem('H<sub>2')).toBe(true);
    expect(formatProblem('2</sup>')).toBe(true);
    expect(formatProblem('a<sub></sub>')).toBe(true);
    expect(formatProblem('строка<br>строка')).toBe(true);
  });
});

describe('contentChecks', () => {
  it('чистый тест без замечаний', () => {
    expect(contentChecks({ type: 'test', content: 'Вопрос?', options: opts('a', 'b', 'c', 'd') })).toEqual([]);
  });
  it('пустой текст вопроса, но с картинкой — допустимо', () => {
    expect(contentChecks({ type: 'test', content: ' ', options: opts('a', 'b') })).toContain('empty_text');
    expect(contentChecks({ type: 'test', content: '', image: 'https://x/y.png', options: opts('a', 'b') })).not.toContain('empty_text');
  });
  it('пустой вариант и одинаковые варианты', () => {
    const r = contentChecks({ type: 'test', content: 'Q', options: opts('Углерод', 'углерод.', '', 'Бор') });
    expect(r).toContain('empty_option');
    expect(r).toContain('dup_options');
  });
  it('вариант с картинкой без текста не считается пустым', () => {
    expect(contentChecks({ type: 'test', content: 'Q', options: [{ text: '', image: 'https://x/a.png' }, { text: 'b' }] })).not.toContain('empty_option');
  });
  it('одинаковые пункты справа в соответствии', () => {
    expect(contentChecks({ type: 'matching', content: 'Q', left: opts('1', '2'), right: opts('x', 'X', 'y') })).toContain('dup_right');
  });
  it('неверная ссылка на картинку', () => {
    expect(contentChecks({ type: 'test', content: 'Q', image: 'undefined', options: opts('a', 'b') })).toContain('image_bad');
  });
});
