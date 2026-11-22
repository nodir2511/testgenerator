import { describe, expect, it } from 'vitest';
import {
  TIP_GAP_MS,
  TIP_START_DELAY_MS,
  anchorKeys,
  pickTip,
  placeTip,
  readLastShown,
  shouldShowTip,
  showTabButton,
  writeLastShown,
  type Rect,
  type SiteTip,
  type TipGate,
} from '../src/lib/tips';

const NOW = 1_800_000_000_000;
const gate = (over: Partial<TipGate> = {}): TipGate => ({
  now: NOW,
  startedAt: NOW - TIP_START_DELAY_MS - 1,
  lastShownAt: null,
  sessionShown: false,
  newsOpen: false,
  newsShownThisSession: false,
  modalOpen: false,
  tab: 'generator',
  gameOnly: false,
  ...over,
});

describe('shouldShowTip', () => {
  it('показывает, когда все условия выполнены', () => {
    expect(shouldShowTip(gate())).toBe(true);
  });
  it('не раньше чем через 8 секунд после входа', () => {
    expect(shouldShowTip(gate({ startedAt: NOW - 2000 }))).toBe(false);
    expect(shouldShowTip(gate({ startedAt: NOW - TIP_START_DELAY_MS }))).toBe(true);
  });
  it('не больше одной подсказки за открытие сайта', () => {
    expect(shouldShowTip(gate({ sessionShown: true }))).toBe(false);
  });
  it('не чаще одной в сутки', () => {
    expect(shouldShowTip(gate({ lastShownAt: NOW - 60_000 }))).toBe(false);
    expect(shouldShowTip(gate({ lastShownAt: NOW - TIP_GAP_MS + 1 }))).toBe(false);
    expect(shouldShowTip(gate({ lastShownAt: NOW - TIP_GAP_MS }))).toBe(true);
  });
  it('время из будущего (сбитые часы) не блокирует навсегда', () => {
    expect(shouldShowTip(gate({ lastShownAt: NOW + 5 * TIP_GAP_MS }))).toBe(true);
  });
  it('не пока открыто окно «Что нового» и не после него в тот же заход', () => {
    expect(shouldShowTip(gate({ newsOpen: true }))).toBe(false);
    expect(shouldShowTip(gate({ newsShownThisSession: true }))).toBe(false);
  });
  it('не поверх другого окна', () => {
    expect(shouldShowTip(gate({ modalOpen: true }))).toBe(false);
  });
  it('не в разделе «Что нового» и не в режиме только-игра', () => {
    expect(shouldShowTip(gate({ tab: 'releases' }))).toBe(false);
    expect(shouldShowTip(gate({ gameOnly: true }))).toBe(false);
  });
});

const tip = (id: string, target: string, tab: string | null = null): SiteTip =>
  ({ id, version: '1.0.0', text: id, target, tab, min_rank: 1, released_at: '2026-11-23T00:00:00Z' });

describe('pickTip', () => {
  it('берёт первую (самую новую) подсказку, чей якорь виден', () => {
    const tips = [tip('new', 'cluster-history'), tip('mid', 'nav-exams'), tip('old', 'archive-variants')];
    const visible = new Set(['nav-exams', 'archive-variants']);
    expect(pickTip(tips, (k) => visible.has(k))?.id).toBe('mid');
  });
  it('ничего, если ни одного якоря нет на экране', () => {
    expect(pickTip([tip('a', 'cluster-history')], () => false)).toBeNull();
    expect(pickTip([], () => true)).toBeNull();
  });
  it('у пункта меню запасной якорь — кнопка «Ещё» (телефон)', () => {
    expect(anchorKeys('nav-exams')).toEqual(['nav-exams', 'nav-more']);
    expect(anchorKeys('archive-variants')).toEqual(['archive-variants']);
    expect(pickTip([tip('a', 'nav-exams')], (k) => k === 'nav-more')?.id).toBe('a');
  });
});

describe('showTabButton', () => {
  it('«Показать» — только если раздел задан, доступен и мы не в нём', () => {
    const can = (t: string) => t !== 'cluster';
    expect(showTabButton(tip('a', 'nav-exams', 'exams'), 'generator', can)).toBe(true);
    expect(showTabButton(tip('a', 'nav-exams', 'exams'), 'exams', can)).toBe(false);
    expect(showTabButton(tip('a', 'cluster-history', 'cluster'), 'generator', can)).toBe(false);
    expect(showTabButton(tip('a', 'telegram-link'), 'generator', can)).toBe(false);
  });
});

const rect = (left: number, top: number, width: number, height: number): Rect =>
  ({ left, top, width, height, right: left + width, bottom: top + height });
const desktop = { width: 1280, height: 800 };
const phone = { width: 360, height: 640, safeTop: 0, safeBottom: 34 };
const card = { width: 320, height: 150 };

/** Карточка целиком в экране, стрелка начинается на краю карточки и смотрит в якорь */
function expectSane(p: ReturnType<typeof placeTip>, a: Rect, vp: { width: number; height: number; safeTop?: number; safeBottom?: number }) {
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.y).toBeGreaterThanOrEqual(vp.safeTop ?? 0);
  expect(p.x + p.width).toBeLessThanOrEqual(vp.width);
  expect(p.y + card.height).toBeLessThanOrEqual(vp.height - (vp.safeBottom ?? 0));
  expect(p.width).toBeLessThanOrEqual(card.width);
  const { from, to } = p.arrow;
  // Начало стрелки — на краю карточки
  const onEdge = (Math.abs(from.y - p.y) < 0.5 || Math.abs(from.y - (p.y + card.height)) < 0.5) && from.x >= p.x && from.x <= p.x + p.width
    || (Math.abs(from.x - p.x) < 0.5 || Math.abs(from.x - (p.x + p.width)) < 0.5) && from.y >= p.y && from.y <= p.y + card.height;
  expect(onEdge).toBe(true);
  // Конец стрелки — у самого якоря (с отступом выреза)
  expect(to.x).toBeGreaterThanOrEqual(a.left - 12);
  expect(to.x).toBeLessThanOrEqual(a.right + 12);
  expect(to.y).toBeGreaterThanOrEqual(a.top - 12);
  expect(to.y).toBeLessThanOrEqual(a.bottom + 12);
}

describe('placeTip', () => {
  it('якорь вверху по центру — карточка снизу, стрелка вверх', () => {
    const a = rect(600, 20, 120, 40);
    const p = placeTip(a, desktop, card);
    expect(p.side).toBe('bottom');
    expect(p.y).toBeGreaterThan(a.bottom);
    expect(p.arrow.to.y).toBeLessThan(p.arrow.from.y);
    expectSane(p, a, desktop);
  });
  it('якорь внизу — карточка сверху', () => {
    const a = rect(600, 740, 120, 40);
    const p = placeTip(a, desktop, card);
    expect(p.side).toBe('top');
    expect(p.y + card.height).toBeLessThan(a.top);
    expect(p.arrow.to.y).toBeGreaterThan(p.arrow.from.y);
    expectSane(p, a, desktop);
  });
  it('якорь по центру экрана — карточка снизу', () => {
    const a = rect(580, 380, 120, 40);
    const p = placeTip(a, desktop, card);
    expect(p.side).toBe('bottom');
    expectSane(p, a, desktop);
  });
  it('якорь в левом верхнем углу — карточка не уходит за край', () => {
    const a = rect(0, 0, 40, 40);
    const p = placeTip(a, desktop, card);
    expect(p.x).toBeGreaterThanOrEqual(8);
    expectSane(p, a, desktop);
  });
  it('якорь в правом нижнем углу', () => {
    const a = rect(1240, 760, 40, 40);
    const p = placeTip(a, desktop, card);
    expect(p.side).toBe('top');
    expect(p.x + p.width).toBeLessThanOrEqual(1280 - 8);
    expectSane(p, a, desktop);
  });
  it('высокий якорь во всю высоту (боковое меню) — карточка сбоку', () => {
    const a = rect(0, 64, 256, 736);
    const p = placeTip(a, desktop, card);
    expect(p.side).toBe('right');
    expect(p.x).toBeGreaterThan(a.right);
    expectSane(p, a, desktop);
  });
  it('узкий телефон: кнопка «Ещё» в нижнем меню — карточка сверху, над safe-area', () => {
    const a = rect(270, 572, 90, 34);
    const p = placeTip(a, phone, card);
    expect(p.side).toBe('top');
    expectSane(p, a, phone);
  });
  it('узкий телефон: карточка шире экрана сужается', () => {
    const a = rect(10, 80, 100, 40);
    const p = placeTip(a, { width: 300, height: 600 }, { width: 400, height: 150 });
    expect(p.width).toBe(300 - 16);
    expect(p.x).toBe(8);
  });
  it('якорь почти во весь экран — карточка всё равно в экране', () => {
    const a = rect(4, 4, 352, 600);
    const p = placeTip(a, phone, card);
    expectSane(p, a, phone);
  });
});

describe('хранилище', () => {
  const fake = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage;
  };
  it('время последнего показа хранится по пользователю', () => {
    const s = fake();
    expect(readLastShown('u1', s)).toBeNull();
    writeLastShown('u1', 123, s);
    expect(readLastShown('u1', s)).toBe(123);
    expect(readLastShown('u2', s)).toBeNull();
  });
  it('недоступное хранилище не роняет сайт', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(readLastShown('u1', broken)).toBeNull();
    expect(() => writeLastShown('u1', 1, broken)).not.toThrow();
  });
});
