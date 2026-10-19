import { describe, expect, it } from 'vitest';
import {
  CLOCK_DRIFT_MS_PER_S, MAX_GOOD_RTT_MS, SETTLE_MS, bestSample, closeCall, countdownLeft, estimateAt, estimateError, freshBoard, inputOf, mergeEstimate, netLevel,
  pickSpecials, queueOf, settleLeft, standings, type ClockSample, type GameBuzz, type GameQ, type GameTimer, type LayoutRound,
} from '../src/game/api';
import { buildReview, resultText } from '../src/game/review';
import type { GameRound } from '../src/game/content';

const q = (p: Partial<GameQ> = {}): GameQ => ({
  r: 'r1', ci: 0, qi: 0, v: 100, pts: 100, cat: 'Тема', catt: 'Мавзӯъ', text: { q: 'Вопрос', qt: 'Савол' },
  shown: false, wrong: [], mode: 'buzz', seq: 1000, ...p,
});

describe('очередь нажатий', () => {
  it('берёт только нажатия текущего вопроса (по номеру)', () => {
    const buzz = [{ n: 5, t: 1, s: 999 }, { n: 2, t: 2, s: 1000 }, { n: 3, t: 3, s: 1000 }];
    expect(queueOf(buzz, q()).map((b) => b.n)).toEqual([2, 3]);
  });
  it('без номера у нажатия — не считается (остаток старой версии)', () => {
    expect(queueOf([{ n: 1, t: 1 }], q())).toEqual([]);
  });
  it('убирает ошибившихся и тех, кому нельзя отвечать на доп. вопрос', () => {
    const buzz = [{ n: 1, t: 1, s: 1000 }, { n: 2, t: 2, s: 1000 }, { n: 3, t: 3, s: 1000 }];
    expect(queueOf(buzz, q({ wrong: [1] })).map((b) => b.n)).toEqual([2, 3]);
    expect(queueOf(buzz, q({ only: [3] })).map((b) => b.n)).toEqual([3]);
  });
  it('без открытого вопроса очередь пустая', () => {
    expect(queueOf([{ n: 1, t: 1, s: 1000 }], null)).toEqual([]);
  });
});

describe('действия команд', () => {
  it('«кот» и ставки прошлого вопроса не попадают в новый', () => {
    expect(inputOf({ seq: 999, cat: 3, bidders: [1] }, q())).toEqual({});
    expect(inputOf({ seq: 1000, cat: 3 }, q()).cat).toBe(3);
    expect(inputOf({ seq: 1000, cat: 3 }, null)).toEqual({});
  });
});

describe('места', () => {
  it('одинаковые очки — одно место', () => {
    const teams = [{ n: 1, name: 'A' }, { n: 2, name: 'B' }, { n: 3, name: 'C' }];
    const s = standings(teams, { 1: 300, 2: 500, 3: 300 });
    expect(s.map((t) => [t.name, t.place])).toEqual([['B', 1], ['A', 2], ['C', 2]]);
  });
});

describe('случайные «Кот в мешке» и «Аукцион»', () => {
  const layout: LayoutRound[] = [1, 2].map((i) => ({
    id: 'r' + i, tab: '', tabt: '', sub: '', subt: '',
    cats: Array.from({ length: 6 }, (_x, c) => ({ name: 'c' + c, nt: '', values: [100, 200, 300, 400, 500] })),
  }));
  it('по одной клетке каждого вида на уровень, в разных клетках', () => {
    for (let k = 0; k < 50; k++) {
      const sp = pickSpecials(layout);
      for (const r of ['r1', 'r2']) {
        const vals = Object.values(sp[r]);
        expect(vals.sort()).toEqual(['auction', 'cat']);
      }
    }
  });
  it('не ставит на уже сыгранные клетки', () => {
    const used: Record<string, Record<string, true>> = { r1: {} };
    layout[0].cats.forEach((_c, ci) => [0, 1, 2, 3, 4].forEach((qi) => { if (!(ci === 5 && qi >= 3)) used.r1[ci + '-' + qi] = true; }));
    const sp = pickSpecials(layout, used);
    expect(Object.keys(sp.r1).sort()).toEqual(['5-3', '5-4']);
  });
});

describe('разбор игры', () => {
  it('берёт тексты вопросов и ответов из пакета и имена команд', () => {
    const pack: GameRound[] = [{
      id: 'r1', tab: 'Уровень 1', tabt: '', sub: '', subt: '',
      cats: [{ name: 'Тема', nt: '', qs: [{ v: 100, q: 'H_2O?', qt: 'H_2O?', a: 'вода', at: 'об' }] }],
    }];
    const board = { ...freshBoard(), log: [{ r: 'r1', ci: 0, qi: 0, v: 100, res: 'ok' as const, n: 2, wrong: [1] }] };
    const rows = buildReview(board, pack, [{ n: 1, name: 'A' }, { n: 2, name: 'B' }]);
    expect(rows[0].q).toBe('H2O?');
    expect(resultText(rows[0])).toBe('Верно: B; ошиблись: A');
  });
});


describe('единые часы', () => {
  const sample = (rtt: number, server = 1_000_000, perf = 5000): ClockSample => ({ rtt, server, perf });

  it('берёт самую быструю пробу: у неё наименьшая погрешность', () => {
    expect(bestSample([sample(300), sample(40), sample(120)])?.rtt).toBe(40);
    expect(bestSample([])).toBeNull();
  });
  it('ход времени между пробами считается по монотонным часам, а не по системным', () => {
    const e = { server: 1_000_000, perf: 5000, rtt: 40 };
    expect(estimateAt(e, 5000)).toBe(1_000_000);
    expect(estimateAt(e, 7500)).toBe(1_002_500);
  });
  it('погрешность = половина задержки + уход часов со времени пробы', () => {
    const e = { server: 0, perf: 0, rtt: 100 };
    expect(estimateError(e, 0)).toBe(50);
    expect(estimateError(e, 10_000)).toBeCloseTo(50 + 10 * CLOCK_DRIFT_MS_PER_S);
  });
  it('медленная проба не вытесняет точную оценку', () => {
    const good = { server: 1_000_000, perf: 5000, rtt: 30 };
    expect(mergeEstimate(good, sample(900, 1_010_000, 15_000), 15_000)).toBe(good);
  });
  it('новая быстрая проба заменяет устаревшую оценку', () => {
    const old = { server: 1_000_000, perf: 5000, rtt: 200 };
    const next = mergeEstimate(old, sample(30, 1_100_000, 105_000), 105_000);
    expect(next).toEqual({ server: 1_100_000, perf: 105_000, rtt: 30 });
  });
  it('очень медленные пробы принимаются только если оценки ещё нет или после сна устройства', () => {
    const slow = sample(MAX_GOOD_RTT_MS + 500);
    expect(mergeEstimate(null, slow, 6000)).not.toBeNull();
    const prev = { server: 1, perf: 1, rtt: 20 };
    expect(mergeEstimate(prev, slow, 6000)).toBe(prev);
    expect(mergeEstimate(prev, slow, 6000, true)?.rtt).toBe(slow.rtt);
  });
  it('без новых проб оценка не меняется', () => {
    const prev = { server: 1, perf: 1, rtt: 20 };
    expect(mergeEstimate(prev, null, 10)).toBe(prev);
  });
});

describe('отсчёт «3-2-1»', () => {
  const timer = (p: Partial<GameTimer>): GameTimer => ({ running: true, left: 30, endsAt: 40_000, startedAt: 10_000, ...p });
  it('считает секунды до начала приёма по серверному времени', () => {
    expect(countdownLeft(timer({}), 7_000)).toBe(3);
    expect(countdownLeft(timer({}), 8_001)).toBe(2);
    expect(countdownLeft(timer({}), 9_990)).toBe(1);
  });
  it('0 — приём идёт, таймер не запущен или это продолжение после паузы', () => {
    expect(countdownLeft(timer({}), 10_000)).toBe(0);
    expect(countdownLeft(timer({}), 20_000)).toBe(0);
    expect(countdownLeft(timer({ running: false }), 7_000)).toBe(0);
    expect(countdownLeft(timer({ startedAt: null }), 7_000)).toBe(0);
  });
});

describe('порядок нажатий при слабой связи', () => {
  const b = (n: number, t: number, extra: Partial<GameBuzz> = {}): GameBuzz => ({ n, t, s: 1000, ...extra });

  it('ждёт запоздавшие нажатия, пока первое свежее', () => {
    expect(settleLeft([b(1, 100, { a: 1000 })], 1000)).toBe(SETTLE_MS);
    expect(settleLeft([b(1, 100, { a: 1000 })], 1000 + SETTLE_MS)).toBe(0);
    expect(settleLeft([], 5000)).toBe(0);
  });
  it('ожидание не длиннее SETTLE_MS, даже если часы устройства отстают', () => {
    expect(settleLeft([b(1, 100, { a: 1_000_000 })], 0)).toBe(SETTLE_MS);
  });
  it('нажатия без времени прихода (старые записи) считаются установленными', () => {
    expect(settleLeft([b(1, 100)], 5000)).toBe(0);
  });
  it('«почти одновременно»: разница меньше суммы погрешностей и запаса на сенсор', () => {
    const c = closeCall([b(1, 1000, { e: 20 }), b(2, 1040, { e: 20 })]);
    expect(c).toMatchObject({ a: 1, b: 2, gap: 40 });
    expect(closeCall([b(1, 1000, { e: 20 }), b(2, 1500, { e: 20 })])).toBeNull();
  });
  it('у нажатий без данных о погрешности остаётся запас на сенсор', () => {
    expect(closeCall([b(1, 1000), b(2, 1020)])).not.toBeNull();
    expect(closeCall([b(1, 1000), b(2, 1100)])).toBeNull();
  });
  it('одно нажатие — сравнивать не с кем', () => {
    expect(closeCall([b(1, 1000)])).toBeNull();
  });
});

describe('связь команд для ведущего', () => {
  it('оценивает уровень по задержке, погрешности и свежести данных', () => {
    expect(netLevel({ rtt: 40, err: 20, age: 5 })).toBe('good');
    expect(netLevel({ rtt: 250, err: 125, age: 5 })).toBe('fair');
    expect(netLevel({ rtt: 700, err: 350, age: 5 })).toBe('bad');
    expect(netLevel({ rtt: 40, err: 20, age: 200 })).toBe('none');
    expect(netLevel(undefined)).toBe('none');
  });
});
