import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ADMIN_SITE_LIMITS,
  STANDARDS,
  standardFor,
  isEnglishName,
  plural,
  dushanbeDayStart,
  formatWait,
  getStorageJSON,
  getStorageString,
  getStorageNumber,
  getStorageBool,
} from '../src/lib/generatorHelpers';
import { LIMITS } from '../supabase/functions/_shared/ticketing';

// Заглушка localStorage: тесты идут в среде node, без jsdom
const makeStorage = (init: Record<string, string> = {}) => {
  const data = new Map<string, string>(Object.entries(init));
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('formatWait', () => {
  it('показывает минуты и секунды с ведущим нулём', () => {
    expect(formatWait(65)).toBe('1:05');
    expect(formatWait(5)).toBe('0:05');
    expect(formatWait(600)).toBe('10:00');
  });
});

describe('plural', () => {
  it('выбирает форму слова по числу', () => {
    expect(plural(1, 'билет', 'билета', 'билетов')).toBe('билет');
    expect(plural(2, 'билет', 'билета', 'билетов')).toBe('билета');
    expect(plural(5, 'билет', 'билета', 'билетов')).toBe('билетов');
    expect(plural(21, 'билет', 'билета', 'билетов')).toBe('билет');
    expect(plural(11, 'билет', 'билета', 'билетов')).toBe('билетов');
    expect(plural(12, 'билет', 'билета', 'билетов')).toBe('билетов');
    expect(plural(0, 'билет', 'билета', 'билетов')).toBe('билетов');
  });
});

describe('isEnglishName', () => {
  it('узнаёт английский язык по названию предмета', () => {
    expect(isEnglishName('Английский язык')).toBe(true);
    expect(isEnglishName('Забони инглисӣ')).toBe(true);
    expect(isEnglishName('English')).toBe(true);
    expect(isEnglishName('Химия')).toBe(false);
    expect(isEnglishName(null)).toBe(false);
    expect(isEnglishName(undefined)).toBe(false);
  });
});

describe('standardFor', () => {
  it('право, история, биология: 20 + 4 + 2', () => {
    expect(standardFor('Право')).toMatchObject({ test: 20, matching: 4, open: 2 });
    expect(standardFor('История')).toMatchObject({ test: 20, matching: 4, open: 2 });
    expect(standardFor('Право')?.reading).toBeUndefined();
  });
  it('химия, физика, математика: 18 + 2 + 7', () => {
    expect(standardFor('Химия')).toMatchObject({ test: 18, matching: 2, open: 7 });
    expect(standardFor('Математика')).toMatchObject({ test: 18, matching: 2, open: 7 });
  });
  it('английский: в тестовые входят тексты для чтения и с пропусками', () => {
    expect(standardFor('Английский язык')).toMatchObject({ test: 20, matching: 4, open: 2, reading: 1, cloze: 1 });
  });
  it('неизвестный предмет и пустое название — стандарта нет', () => {
    expect(standardFor('Рисование')).toBeNull();
    expect(standardFor()).toBeNull();
  });
  it('в списке стандартов три группы предметов', () => {
    expect(STANDARDS).toHaveLength(3);
  });
});

describe('ADMIN_SITE_LIMITS', () => {
  it('администратору на сайте — до 50 вариантов, остальное как в общих лимитах', () => {
    expect(ADMIN_SITE_LIMITS).toEqual({ ...LIMITS, tickets: 50 });
  });
});

describe('dushanbeDayStart', () => {
  it('возвращает начало суток по Душанбе (UTC+5) в миллисекундах', () => {
    vi.useFakeTimers();
    // 10:00 UTC = 15:00 по Душанбе: сутки начались в 19:00 UTC предыдущего дня
    vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
    expect(dushanbeDayStart()).toBe(Date.parse('2026-11-21T19:00:00Z'));
    // 20:00 UTC = 01:00 следующего дня по Душанбе
    vi.setSystemTime(new Date('2026-11-22T20:00:00Z'));
    expect(dushanbeDayStart()).toBe(Date.parse('2026-11-22T19:00:00Z'));
  });
});

describe('getStorage*', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorage({
      str: 'abc',
      num: '12',
      zero: '0',
      bad_num: 'много',
      empty: '',
      yes: 'true',
      no: 'false',
      other: '1',
      json: '{"a":[1,2]}',
      bad_json: '{не json',
    }));
  });

  it('getStorageNumber: запасное значение, если ключа нет, значение пустое или не число', () => {
    expect(getStorageNumber('нет такого', 7)).toBe(7);
    expect(getStorageNumber('empty', 7)).toBe(7);
    expect(getStorageNumber('bad_num', 7)).toBe(7);
    expect(getStorageNumber('num', 7)).toBe(12);
    expect(getStorageNumber('zero', 7)).toBe(0);
  });

  it('getStorageString: значение как есть, запасное — только если ключа нет', () => {
    expect(getStorageString('str', 'x')).toBe('abc');
    expect(getStorageString('empty', 'x')).toBe('');
    expect(getStorageString('нет такого', 'x')).toBe('x');
  });

  it('getStorageBool: истина только для строки «true»', () => {
    expect(getStorageBool('yes', false)).toBe(true);
    expect(getStorageBool('no', true)).toBe(false);
    expect(getStorageBool('other', true)).toBe(false);
    expect(getStorageBool('нет такого', true)).toBe(true);
    expect(getStorageBool('нет такого', false)).toBe(false);
  });

  it('getStorageJSON: разбирает JSON, при ошибке и отсутствии ключа — запасное значение', () => {
    expect(getStorageJSON('json', null)).toEqual({ a: [1, 2] });
    expect(getStorageJSON('bad_json', [])).toEqual([]);
    expect(getStorageJSON('нет такого', { x: 1 })).toEqual({ x: 1 });
    expect(getStorageJSON('empty', 5)).toBe(5);
  });

  it('getStorageJSON: недоступное хранилище не роняет страницу', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('нет доступа'); } });
    expect(getStorageJSON('json', 'запас')).toBe('запас');
  });
});
