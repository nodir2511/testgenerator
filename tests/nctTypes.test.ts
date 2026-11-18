import { describe, expect, it } from 'vitest';
import { NCT_TYPES, isNctType, nctTypeName } from '../src/lib/nctTypes';

describe('метки типов НЦТ', () => {
  it('коды уникальны и непусты', () => {
    expect(NCT_TYPES.length).toBeGreaterThan(100);
    expect(new Set(NCT_TYPES.map((t) => t.code)).size).toBe(NCT_TYPES.length);
    for (const t of NCT_TYPES) expect(t.name.length).toBeGreaterThan(2);
  });
  it('название по коду', () => {
    expect(nctTypeName('BOND')).toBe('Вид химической связи');
    expect(nctTypeName('UNKNOWN')).toBe('UNKNOWN');
    expect(nctTypeName(null)).toBe('');
    expect(isNctType('MOL')).toBe(true);
    expect(isNctType('nope')).toBe(false);
  });
});
