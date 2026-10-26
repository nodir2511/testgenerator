import { describe, it, expect } from 'vitest';
import { passwordOk, passwordChecks } from '../src/lib/passwordRules';

describe('passwordRules', () => {
  it('требует 9 символов, буквы и цифры', () => {
    expect(passwordOk('abc12345')).toBe(false); // 8 символов
    expect(passwordOk('abcdefghi')).toBe(false); // без цифр
    expect(passwordOk('123456789')).toBe(false); // без букв
    expect(passwordOk('kimiyo2026')).toBe(true);
    expect(passwordOk('химия2026х')).toBe(true); // кириллица тоже буквы
  });
  it('показывает, какие условия выполнены', () => {
    expect(passwordChecks('ab1').map((c) => c.ok)).toEqual([false, true, true]);
  });
});
