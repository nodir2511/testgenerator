import { describe, it, expect } from 'vitest';
import {
  formatRemaining, remainingMs, countAnswered, isAnswered, pickText, normalizeOpen, matchingAnswer, reviewMistakes, nameOk, sortByOrder, lobbyView, waitText, minutesLeft,
  lobbyWaitText, lobbyMinutesText, saveOutcome, SAVE_WAIT_RETRY_MS, SAVE_WAIT_MAX_TRIES, saveStatus, openDigits, openCellsFor, OPEN_CELLS } from '../src/exam/examLogic';
import { openBoxesFor } from '../src/lib/docxExport';

describe('saveOutcome: что делать по ответу save', () => {
  it('ok — сохранено', () => expect(saveOutcome({ ok: true })).toBe('saved'));
  it('waiting (расхождение часов на границе старта) — повторить, не сдавать', () => {
    expect(saveOutcome({ ok: false, state: 'waiting' })).toBe('retry');
  });
  it('закрыто или уже сдано — сдать', () => {
    expect(saveOutcome({ ok: false, state: 'closed' })).toBe('finish');
    expect(saveOutcome({ ok: false, state: 'finished' })).toBe('finish');
  });
  it('прочее (нет попытки, неизвестное состояние) — не сдавать', () => {
    expect(saveOutcome({ ok: false, state: 'new' })).toBe('keep');
    expect(saveOutcome({ ok: false })).toBe('keep');
  });
  it('повтор ~700 мс, до 5 раз', () => {
    expect(SAVE_WAIT_RETRY_MS).toBe(700);
    expect(SAVE_WAIT_MAX_TRIES).toBe(5);
  });
});

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
  // Сервер ставит старт на «сейчас + 6 с»; цифры 3-2-1 — только последние 3 секунды
  const startsAt = '2026-01-01T10:00:06.000Z';
  const server = (ms: number) => Date.parse('2026-01-01T10:00:00.000Z') + ms;
  const cd = { state: 'countdown' as const, attempt: { ticketNumber: 4, startsAt } };
  it('ожидание — без отсчёта', () => expect(lobbyView({ state: 'waiting', attempt: { ticketNumber: 4 } }, 0, 0)).toEqual({ kind: 'waiting' }));
  it('до старта больше 3 с — «скоро начнём», цифры нет', () => {
    expect(lobbyView(cd, 0, server(0))).toEqual({ kind: 'soon' });
    expect(lobbyView(cd, 0, server(500))).toEqual({ kind: 'soon' }); // осталось 5,5 с
    expect(lobbyView(cd, 0, server(1000))).toEqual({ kind: 'soon' }); // 5 с
    expect(lobbyView(cd, 0, server(2999))).toEqual({ kind: 'soon' }); // чуть больше 3 с
  });
  it('отсчёт 3, 2, 1 по серверному времени', () => {
    expect(lobbyView(cd, 0, server(3000))).toEqual({ kind: 'countdown', digit: 3 });
    expect(lobbyView(cd, 0, server(3500))).toEqual({ kind: 'countdown', digit: 3 });
    expect(lobbyView(cd, 0, server(4500))).toEqual({ kind: 'countdown', digit: 2 });
    expect(lobbyView(cd, 0, server(5500))).toEqual({ kind: 'countdown', digit: 1 });
  });
  it('в момент старта и позже — запуск', () => {
    expect(lobbyView(cd, 0, server(6000))).toEqual({ kind: 'run' });
    expect(lobbyView(cd, 0, server(12000))).toEqual({ kind: 'run' });
  });
  it('телефон спешит или отстаёт на минуту — те же цифры', () => {
    for (const skew of [60_000, -60_000]) {
      // часы телефона = серверные + skew, смещение = −skew
      expect(lobbyView(cd, -skew, server(1000) + skew)).toEqual({ kind: 'soon' });
      expect(lobbyView(cd, -skew, server(4500) + skew)).toEqual({ kind: 'countdown', digit: 2 });
      expect(lobbyView(cd, -skew, server(6000) + skew)).toEqual({ kind: 'run' });
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
  it('lobbyWaitText по виду зала', () => {
    expect(lobbyWaitText({ kind: 'waiting' })).toBe('Ждите, преподаватель начнёт сессию');
    expect(lobbyWaitText({ kind: 'soon' })).toBe('Скоро начнём…');
    expect(lobbyWaitText({ kind: 'run' })).toBe('Начинаем!');
  });
  it('lobbyMinutesText — время сессии, если сервер его назвал', () => {
    expect(lobbyMinutesText({ minutes: 30 })).toBe('Время: 30 мин');
    expect(lobbyMinutesText({ minutes: null })).toBe('');
    expect(lobbyMinutesText({})).toBe('');
  });
  it('minutesLeft округляет вверх и не уходит ниже 1', () => {
    expect(minutesLeft(29 * 60_000 + 1)).toBe(30);
    expect(minutesLeft(60_000)).toBe(1);
    expect(minutesLeft(5)).toBe(1);
    expect(minutesLeft(-1)).toBe(1);
  });
});

describe('saveStatus', () => {
  const e = new Set<string>();
  it('нет ответа — ничего не показываем', () => expect(saveStatus('a', e, e, e)).toBe('none'));
  it('ответ в полёте — «сохраняем» (жёлтое), а не ошибка', () => expect(saveStatus('a', new Set(['a']), e, e)).toBe('saving'));
  it('отправка не удалась — «не сохранено»', () => expect(saveStatus('a', new Set(['a']), new Set(['a']), e)).toBe('failed'));
  it('записано — «сохранено»', () => expect(saveStatus('a', e, e, new Set(['a']))).toBe('saved'));
  it('другой вопрос не влияет', () => expect(saveStatus('b', new Set(['a']), new Set(['a']), new Set(['a']))).toBe('none'));
});

describe('openDigits', () => {
  it('4 клетки по одной цифре', () => expect(OPEN_CELLS).toBe(4));
  it('оставляет только цифры', () => expect(openDigits('1a2,5')).toBe('125'));
  it('не больше четырёх', () => expect(openDigits('123456')).toBe('1234'));
  it('пусто', () => expect(openDigits('')).toBe(''));
  it('пять клеток — пять цифр', () => expect(openDigits('135799', 5)).toBe('13579'));
});

describe('openCellsFor', () => {
  it('таджикский и английский — 5 клеток, как на бланке', () => {
    expect(openCellsFor('Таджикский язык')).toBe(5);
    expect(openCellsFor('Забони тоҷикӣ')).toBe(5);
    expect(openCellsFor('Английский язык')).toBe(5);
  });
  it('остальные предметы и пустое имя — 4', () => {
    for (const s of ['Математика', 'Физика', 'Химия', 'Биология', 'История', 'Право', '', null, undefined]) expect(openCellsFor(s)).toBe(4);
  });
  it('совпадает с числом клеток в Word-билете', () => {
    for (const s of ['Таджикский язык', 'Английский язык', 'English', 'Математика', 'Физика', 'Право', '']) expect(openCellsFor(s)).toBe(openBoxesFor(s));
  });
  it('страница ученика рисует столько клеток, сколько задано, и показывает сохранённый ответ целиком', async () => {
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ExamQuestion } = await import('../src/exam/ExamQuestion');
    const html = (answer: string | undefined, openCells?: number) => renderToStaticMarkup(React.createElement(ExamQuestion, {
      snap: { id: 'q', type: 'open', content: 'Условие' }, n: 1, lang: 'ru', prevPassageId: null, answer, saveState: 'none', onAnswer: () => {}, openCells,
    }));
    const values = (s: string) => [...s.matchAll(/class="open-cell"[^>]*value="(\d?)"/g)].map((m) => m[1]);
    expect(values(html(undefined))).toHaveLength(4);
    expect(values(html('13579', openCellsFor('Таджикский язык')))).toEqual(['1', '3', '5', '7', '9']);
    expect(values(html('13579', openCellsFor('Физика')))).toEqual(['1', '3', '5', '7']);
  });
});
