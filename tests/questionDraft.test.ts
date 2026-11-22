import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_KEY, emptyOptions, emptySide, readDraft, ruOf } from '../src/lib/questionDraft';

// Заглушка localStorage: тесты идут в среде node, без браузера
const stubStorage = (value: string | null) =>
  vi.stubGlobal('localStorage', { getItem: (key: string) => (key === DRAFT_KEY ? value : null) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('форма вопроса: пустые структуры', () => {
  it('ключ черновика не меняется', () => {
    expect(DRAFT_KEY).toBe('examiner_qf_draft');
  });
  it('четыре пустых варианта, верным отмечен первый', () => {
    const options = emptyOptions();
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.is_correct)).toEqual([true, false, false, false]);
    expect(options.every((o) => o.text === '' && o.text_ru === '' && o.text_tg === '')).toBe(true);
  });
  it('каждый вызов даёт новые объекты', () => {
    expect(emptyOptions()[0]).not.toBe(emptyOptions()[0]);
    const side = emptySide('left', 2);
    expect(side[0]).not.toBe(side[1]);
  });
  it('пустые колонки соответствия нужной длины и стороны', () => {
    const left = emptySide('left', 4);
    const right = emptySide('right', 5);
    expect(left).toHaveLength(4);
    expect(right).toHaveLength(5);
    expect(left.every((x) => x.side === 'left' && x.text === '' && x.match === undefined)).toBe(true);
    expect(right.every((x) => x.side === 'right')).toBe(true);
  });
});

describe('форма вопроса: русское поле', () => {
  it('берёт русский текст, если он есть', () => {
    expect(ruOf('Да', 'База', 'Ҳа')).toBe('Да');
  });
  it('без русского берёт основной текст, если он не таджикский', () => {
    expect(ruOf(null, 'База', 'Ҳа')).toBe('База');
    expect(ruOf(undefined, 'База', null)).toBe('База');
  });
  it('вопрос только на таджикском: основной текст в русское поле не копируется', () => {
    expect(ruOf(null, 'Ҳа', 'Ҳа')).toBe('');
  });
  it('ничего нет — пустая строка', () => {
    expect(ruOf()).toBe('');
    expect(ruOf(null, null, null)).toBe('');
  });
});

describe('форма вопроса: чтение черновика', () => {
  it('без localStorage возвращает null и не бросает', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readDraft()).toBeNull();
  });
  it('пустое хранилище — null', () => {
    stubStorage(null);
    expect(readDraft()).toBeNull();
  });
  it('битый JSON — null', () => {
    stubStorage('{не json');
    expect(readDraft()).toBeNull();
  });
  it('запись без времени сохранения — null', () => {
    stubStorage(JSON.stringify({ type: 'test', contentRu: 'x' }));
    expect(readDraft()).toBeNull();
  });
  it('старый черновик читается как есть', () => {
    const draft = {
      savedAt: 1700000000000,
      type: 'test',
      contentRu: 'Вопрос',
      contentTg: '',
      imageUrl: null,
      correctNumeric: '',
      options: emptyOptions(),
      leftItems: emptySide('left', 4),
      rightItems: emptySide('right', 5),
    };
    stubStorage(JSON.stringify(draft));
    expect(readDraft()).toEqual(draft);
  });
});
