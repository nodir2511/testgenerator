import { describe, expect, it } from 'vitest';
import { COPY_EVENTS, COPY_GAP_MS, createCopyGuard, isEditable } from '../src/exam/copyGuard';

describe('запрет копирования на странице билета', () => {
  it('попыткой считаются копирование, вырезание и меню по долгому нажатию', () => {
    expect([...COPY_EVENTS]).toEqual(['copy', 'cut', 'contextmenu']);
  });

  it('одно долгое нажатие (несколько событий подряд) — одна попытка, следующее нажатие — новая', () => {
    let sent = 0;
    const g = createCopyGuard(() => { sent++; });
    expect(g.hit(1000)).toBe(true);
    expect(g.hit(1100)).toBe(false); // меню и копирование от одного нажатия
    expect(g.hit(1000 + COPY_GAP_MS - 1)).toBe(false);
    expect(g.count).toBe(1);
    expect(g.hit(1000 + COPY_GAP_MS)).toBe(true);
    expect(g.count).toBe(2);
    expect(sent).toBe(2);
  });

  it('клетки ответа не считаются: в них выделение и меню нужны ученику', () => {
    expect(isEditable({ tagName: 'INPUT' })).toBe(true);
    expect(isEditable({ tagName: 'textarea' })).toBe(true);
    expect(isEditable({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditable({ tagName: 'DIV' })).toBe(false);
    expect(isEditable({ tagName: 'IMG' })).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});
