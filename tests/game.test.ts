import { describe, expect, it } from 'vitest';
import { freshBoard, inputOf, pickSpecials, queueOf, standings, type GameQ, type LayoutRound } from '../src/game/api';
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
