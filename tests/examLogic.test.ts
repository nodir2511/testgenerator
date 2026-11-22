import { describe, it, expect } from 'vitest';
import {
  formatRemaining, remainingMs, countAnswered, isAnswered, pickText, normalizeOpen, matchingAnswer, reviewMistakes, nameOk, sortByOrder, lobbyView, waitText, minutesLeft,
} from '../src/exam/examLogic';

describe('formatRemaining', () => {
  it('минуты и секунды', () => {
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(-5000)).toBe('0:00');
    expect(formatRemaining(61_000)).toBe('1:01');
    expect(formatRemaining(29 * 60_000 + 59_900)).toBe('29:59');
  });
  it('часы', () => expect(formatRemaining(3_725_000)).toBe('1:02:05'));
});

describe('remainingMs', () => {
  it('учитывает смещение часов сервера', () => {
    const deadline = '2026-01-01T10:30:00.000Z';
    const serverNow = Date.parse('2026-01-01T10:00:00.000Z');
    const clientNow = serverNow + 3 * 3600_000; // часы телефона спешат
    const offset = serverNow - clientNow;
    expect(remainingMs(deadline, offset, clientNow)).toBe(30 * 60_000);
  });
});

describe('ответы', () => {
  it('isAnswered', () => {
    expect(isAnswered('test', 'a')).toBe(true);
    expect(isAnswered('test', null)).toBe(false);
    expect(isAnswered('open', ' ')).toBe(false);
    expect(isAnswered('open', '12')).toBe(true);
    expect(isAnswered('matching', {})).toBe(false);
    expect(isAnswered('matching', { l1: 'r1' })).toBe(true);
  });
  it('countAnswered считает только вопросы билета', () => {
    const qs = [
      { tqId: 'a', snapshot: { type: 'test' } },
      { tqId: 'b', snapshot: { type: 'open' } },
      { tqId: 'c', snapshot: { empty: true, type: 'test' } },
    ];
    expect(countAnswered(qs, { a: 'x', b: '', c: 'y', z: 'q' })).toEqual({ answered: 1, total: 2 });
  });
  it('normalizeOpen', () => {
    expect(normalizeOpen(' 12,5 ')).toBe('12,5');
    expect(normalizeOpen('abc1-2')).toBe('12');
    expect(normalizeOpen('-3.5.1')).toBe('-3.51');
  });
  it('matchingAnswer', () => {
    expect(matchingAnswer({ l1: 'r1' }, 'l2', 'r2')).toEqual({ l1: 'r1', l2: 'r2' });
    expect(matchingAnswer({ l1: 'r1' }, 'l1', null)).toEqual({});
    expect(matchingAnswer(null, 'l1', 'r1')).toEqual({ l1: 'r1' });
  });
  it('nameOk', () => {
    expect(nameOk('Я')).toBe(false);
    expect(nameOk('  Ив  ')).toBe(true);
    expect(nameOk('x'.repeat(81))).toBe(false);
  });
});

describe('pickText / sortByOrder', () => {
  it('язык', () => {
    const o = { text: 'b', text_ru: 'ру', text_tg: 'тҷ' };
    expect(pickText(o, 'ru')).toBe('ру');
    expect(pickText(o, 'tg')).toBe('тҷ');
    expect(pickText({ text: 'b', text_tg: '' }, 'tg')).toBe('b');
    expect(pickText({ content_tg: 'к' }, 'tg', 'content')).toBe('к');
  });
  it('sortByOrder', () => expect([{ order_index: 2 }, { order_index: 1 }].sort(sortByOrder)[0].order_index).toBe(1));
});

describe('reviewMistakes', () => {
  it('только вопросы с потерянными баллами, номера сохраняются', () => {
    const r = [
      { tqId: 'a', snapshot: {}, answer: null, points: 1, max: 1 },
      { tqId: 'b', snapshot: {}, answer: null, points: 0, max: 1 },
      { tqId: 'c', snapshot: {}, answer: null, points: 1, max: 2 },
      { tqId: 'd', snapshot: { empty: true }, answer: null, points: 0, max: 0 },
    ];
    const withEmpty = [{ tqId: 'e', snapshot: { empty: true }, answer: null, points: 0, max: 0 }, { tqId: 'z', snapshot: {}, answer: null, points: 0, max: 1 }];
    expect(reviewMistakes(withEmpty).map((x) => x.n)).toEqual([1]); // пустое место не занимает номер
    expect(reviewMistakes(r).map((x) => [x.n, x.item.tqId])).toEqual([[2, 'b'], [3, 'c']]);
  });
});

import { serverOffset } from '../src/exam/examLogic';

describe('serverOffset', () => {
  it('середина запроса: offset = serverNow − (sent+received)/2', () => {
    expect(serverOffset(10_000, 1_000, 1_200)).toBe(10_000 - 1_100);
  });
  it('телефон спешит на 5 минут: остаток не уменьшается', () => {
    const serverNow = Date.parse('2026-01-01T10:00:00Z');
    const phone = serverNow + 5 * 60_000;
    const off = serverOffset(serverNow, phone - 100, phone + 100);
    expect(remainingMs('2026-01-01T10:30:00Z', off, phone)).toBe(30 * 60_000);
  });
  it('телефон отстаёт на 5 минут: остаток не завышается', () => {
    const serverNow = Date.parse('2026-01-01T10:00:00Z');
    const phone = serverNow - 5 * 60_000;
    const off = serverOffset(serverNow, phone - 100, phone + 100);
    expect(remainingMs('2026-01-01T10:30:00Z', off, phone)).toBe(30 * 60_000);
  });
});

import { navIndexes, progressFraction, stepNav, firstUnansweredPos } from '../src/exam/examLogic';

describe('постраничная навигация', () => {
  const qs = [
    { tqId: 'a', snapshot: { type: 'test' } },
    { tqId: 'e', snapshot: { empty: true, type: 'test' } },
    { tqId: 'b', snapshot: { type: 'open' } },
    { tqId: 'c', snapshot: { type: 'test' } },
  ];
  it('navIndexes пропускает пустые места', () => expect(navIndexes(qs)).toEqual([0, 2, 3]));
  it('progressFraction', () => {
    expect(progressFraction(0, 0)).toBe(0);
    expect(progressFraction(1, 4)).toBe(0.25);
    expect(progressFraction(9, 4)).toBe(1);
  });
  it('stepNav не выходит за границы', () => {
    expect(stepNav(3, 0, 1)).toBe(1);
    expect(stepNav(3, 2, 1)).toBe(2);
    expect(stepNav(3, 0, -1)).toBe(0);
    expect(stepNav(3, 2, -1)).toBe(1);
  });
  it('firstUnansweredPos — позиция в списке навигации', () => {
    expect(firstUnansweredPos(qs, { a: 'x' })).toBe(1);
    expect(firstUnansweredPos(qs, { a: 'x', b: '5', c: 'y' })).toBe(0);
    expect(firstUnansweredPos(qs, {})).toBe(0);
    expect(firstUnansweredPos(qs, { a: 'x', b: '5' })).toBe(2);
  });
});

describe('lobbyView', () => {
  const startsAt = '2026-01-01T10:00:03.000Z';
  const server = (ms: number) => Date.parse('2026-01-01T10:00:00.000Z') + ms;
  const cd = { state: 'countdown' as const, attempt: { ticketNumber: 4, startsAt } };
  it('ожидание — без отсчёта', () => expect(lobbyView({ state: 'waiting', attempt: { ticketNumber: 4 } }, 0, 0)).toEqual({ kind: 'waiting' }));
  it('отсчёт 3, 2, 1 по серверному времени', () => {
    expect(lobbyView(cd, 0, server(500))).toEqual({ kind: 'countdown', digit: 3 });
    expect(lobbyView(cd, 0, server(1500))).toEqual({ kind: 'countdown', digit: 2 });
    expect(lobbyView(cd, 0, server(2500))).toEqual({ kind: 'countdown', digit: 1 });
  });
  it('в момент старта и позже — запуск', () => {
    expect(lobbyView(cd, 0, server(3000))).toEqual({ kind: 'run' });
    expect(lobbyView(cd, 0, server(9000))).toEqual({ kind: 'run' });
  });
  it('телефон спешит или отстаёт на минуту — те же цифры', () => {
    for (const skew of [60_000, -60_000]) {
      // часы телефона = серверные + skew, смещение = −skew
      expect(lobbyView(cd, -skew, server(1500) + skew)).toEqual({ kind: 'countdown', digit: 2 });
      expect(lobbyView(cd, -skew, server(3000) + skew)).toEqual({ kind: 'run' });
    }
  });
  it('running сразу (опоздавший) — запуск без отсчёта', () => {
    expect(lobbyView({ state: 'running', attempt: {} }, 0, 0)).toEqual({ kind: 'run' });
  });
  it('countdown без startsAt — ожидание', () => expect(lobbyView({ state: 'countdown', attempt: { ticketNumber: 1 } }, 0, 0)).toEqual({ kind: 'waiting' }));
});

describe('waitText / minutesLeft', () => {
  it('тексты', () => {
    expect(waitText({ state: 'waiting' })).toBe('Ждите, преподаватель начнёт сессию');
    expect(waitText({ state: 'countdown' })).toBe('Начинаем!');
  });
  it('minutesLeft округляет вверх и не уходит ниже 1', () => {
    expect(minutesLeft(29 * 60_000 + 1)).toBe(30);
    expect(minutesLeft(60_000)).toBe(1);
    expect(minutesLeft(5)).toBe(1);
    expect(minutesLeft(-1)).toBe(1);
  });
});
