import { describe, it, expect } from 'vitest';
import { autoBatchTitle, compressRanges } from '../src/lib/batchTitle';

describe('compressRanges', () => {
  it('сжимает подряд идущие номера', () => {
    expect(compressRanges([3, 1, 2, 5, 7, 8])).toBe('1–3, 5, 7–8');
    expect(compressRanges([4])).toBe('4');
    expect(compressRanges([2, 2, 3])).toBe('2–3');
  });
});

describe('autoBatchTitle', () => {
  const d = new Date(2026, 9, 6);
  it('весь предмет', () => {
    expect(autoBatchTitle('Химия', null, d)).toBe('Химия — весь предмет — 06.10');
  });
  it('выбранные главы', () => {
    expect(autoBatchTitle('Физика', [1, 2, 3, 5], d)).toBe('Физика — гл. 1–3, 5 — 06.10');
  });
  it('много разрозненных глав — только их число', () => {
    expect(autoBatchTitle('Биология', [1, 3, 5, 7, 9], d)).toBe('Биология — 5 гл. — 06.10');
  });
});
