import { describe, it, expect, afterEach, vi } from 'vitest';
import { confirmAction, registerConfirmHost } from '../src/lib/confirm';

describe('confirmAction', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('передаёт запрос окну и возвращает ответ пользователя', async () => {
    const off = registerConfirmHost((req) => req.resolve(req.title === 'да'));
    expect(await confirmAction({ title: 'да' })).toBe(true);
    expect(await confirmAction({ title: 'нет' })).toBe(false);
    off();
  });

  it('без окна спрашивает системным confirm, а если его нет — отказывает', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    expect(await confirmAction({ title: 'Удалить?', details: ['3 темы'] })).toBe(true);
    expect((globalThis.confirm as any).mock.calls[0][0]).toContain('3 темы');
    vi.stubGlobal('confirm', undefined);
    expect(await confirmAction({ title: 'Удалить?' })).toBe(false);
  });

  it('отключённое окно больше не получает запросы', async () => {
    const seen = vi.fn();
    const off = registerConfirmHost((r) => { seen(); r.resolve(true); });
    off();
    vi.stubGlobal('confirm', () => false);
    expect(await confirmAction({ title: 'x' })).toBe(false);
    expect(seen).not.toHaveBeenCalled();
  });
});
