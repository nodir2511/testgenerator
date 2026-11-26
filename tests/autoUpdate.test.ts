import { describe, expect, it } from 'vitest';
import { shouldAutoReload } from '../src/lib/autoUpdate';

describe('обновление открытого сайта', () => {
  it('новая версия замечена при открытии — страница обновляется сама', () => {
    expect(shouldAutoReload({ firstCheck: true, newId: '2', triedId: null })).toBe(true);
  });
  it('замечена во время работы — только кнопка, чтобы не потерять набранное', () => {
    expect(shouldAutoReload({ firstCheck: false, newId: '2', triedId: null })).toBe(false);
  });
  it('для этой версии уже перезагружались — второй раз не пробуем', () => {
    expect(shouldAutoReload({ firstCheck: true, newId: '2', triedId: '2' })).toBe(false);
    expect(shouldAutoReload({ firstCheck: true, newId: '3', triedId: '2' })).toBe(true);
  });
});
