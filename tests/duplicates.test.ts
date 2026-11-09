import { describe, expect, it } from 'vitest';
import { buildIndex, findPairs, findSimilar, normalizeText, type DupDoc } from '../src/lib/duplicates';

const doc = (id: string, content: string, options?: string[], answer?: string): DupDoc => ({ id, variants: [{ content, options }], answer });

describe('normalizeText', () => {
  it('убирает теги, регистр, знаки и ё', () => {
    expect(normalizeText('Формула <b>H<sub>2</sub>O</b>, Ёлка?')).toBe('формула h2o елка');
  });
});

describe('findSimilar', () => {
  const bank = [
    doc('a', 'Какой элемент имеет атомный номер 6?', ['Углерод', 'Азот', 'Кислород', 'Бор']),
    doc('b', 'Сколько электронов у атома натрия?', ['9', '10', '11', '12']),
    doc('c', 'Найдите скорость тела, если путь 10 м, время 2 с', undefined, '5'),
  ];
  const index = buildIndex(bank);

  it('находит точный дубль даже с другим порядком вариантов и регистром', () => {
    const m = findSimilar(index, doc('new', 'КАКОЙ ЭЛЕМЕНТ ИМЕЕТ АТОМНЫЙ НОМЕР 6', ['Бор', 'Кислород', 'Азот', 'Углерод']));
    expect(m[0]?.id).toBe('a');
    expect(m[0].exact).toBe(true);
  });

  it('находит почти одинаковую формулировку', () => {
    const m = findSimilar(index, doc('new', 'Какой химический элемент имеет атомный номер 6?', ['Углерод', 'Азот', 'Кислород', 'Бор']));
    expect(m[0]?.id).toBe('a');
    expect(m[0].exact).toBe(false);
  });

  it('одинаковая формулировка с другими вариантами — не дубль', () => {
    const m = findSimilar(index, doc('new', 'Какой элемент имеет атомный номер 6?', ['Гелий', 'Неон', 'Аргон', 'Криптон']));
    expect(m.find((x) => x.id === 'a')).toBeUndefined();
  });

  it('открытый вопрос с другим ответом — не дубль', () => {
    expect(findSimilar(index, doc('new', 'Найдите скорость тела, если путь 10 м, время 2 с', undefined, '7'))).toHaveLength(0);
    expect(findSimilar(index, doc('new', 'Найдите скорость тела, если путь 10 м, время 2 с', undefined, '5'))[0]?.id).toBe('c');
  });

  it('разные вопросы не находятся', () => {
    expect(findSimilar(index, doc('new', 'Столица Таджикистана', ['Душанбе', 'Худжанд']))).toHaveLength(0);
  });

  it('сравнивает по языкам: таджикский текст находит двуязычный вопрос', () => {
    const bi: DupDoc = { id: 'bi', variants: [{ content: 'Какой элемент имеет номер 6?' }, { content: 'Кадом унсур рақами 6 дорад?' }] };
    const m = findSimilar(buildIndex([bi]), doc('new', 'Кадом унсур рақами 6 дорад?'));
    expect(m[0]?.id).toBe('bi');
  });
});

describe('findPairs', () => {
  it('каждая пара находится один раз', () => {
    const pairs = findPairs([
      doc('1', 'Вопрос про воду и её свойства', ['а', 'б']),
      doc('2', 'Вопрос про воду и её свойства', ['а', 'б']),
      doc('3', 'Совсем другое: вычислите массу'),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: '1', b: '2', exact: true });
  });
});
