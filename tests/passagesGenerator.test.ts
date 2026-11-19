import { describe, expect, it } from 'vitest';
import { PASSAGE_SIZE, checkSettings, fitSettings, pickTickets, poolStats, singleTests, type Settings } from '../supabase/functions/_shared/ticketing';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const base = (type: string, id: string, topic: number, n: number) => ({
  id, type, topic_id: `t${topic}`, chapter_id: 'c1', num: n,
  chapter: { name: 'Глава', order_index: 1 }, topic: { name: `Тема ${topic}`, order_index: topic },
});
const passage = (id: string, kind: 'reading' | 'cloze', topic: number) =>
  Array.from({ length: PASSAGE_SIZE }, (_, k) => ({ ...base('test', `${id}-q${k + 1}`, topic, k + 1), passage_id: id, passage_order: k + 1, passage: { kind } }));

/** Пул английского: 4 текста чтения, 4 пропусков, одиночные тесты, соответствия, открытые */
function englishPool() {
  const pool: any[] = [];
  for (let i = 0; i < 4; i++) pool.push(...passage(`r${i}`, 'reading', i), ...passage(`c${i}`, 'cloze', i));
  for (let i = 0; i < 12; i++) pool.push(base('test', `s${i}`, i % 4, i));
  for (let i = 0; i < 16; i++) pool.push(base('matching', `m${i}`, i % 4, i));
  for (let i = 0; i < 8; i++) pool.push(base('open', `o${i}`, i % 4, i));
  return pool;
}
const S: Settings = { testCount: 20, readingCount: 1, clozeCount: 1, matchingCount: 4, openCount: 2, ticketCount: 3, shuffleOptions: true, shuffleMatching: true, title: 'English' };

describe('генератор английского: билет 20 + 4 + 2 с двумя текстами', () => {
  it('настройки проходят проверку; одиночных тестов 4', () => {
    expect(checkSettings(S)).toBeNull();
    expect(singleTests(S)).toBe(4);
  });
  it('по подбору и подгонке: пул позволяет 1 + 1 текст, ошибки нет', () => {
    const fit = fitSettings(poolStats(englishPool()), S);
    expect(fit.error).toBeNull();
    expect(fit.settings.readingCount).toBe(1);
    expect(fit.settings.clozeCount).toBe(1);
  });
  it('каждый билет: 8 вопросов одного текста чтения подряд (1–8), 8 одного текста пропусков (1–8), затем 4 одиночных; 4 соответствия, 2 открытых', () => {
    const picked = pickTickets(englishPool(), S, rng(7));
    const [tests, matching, open] = picked.kinds;
    expect(tests).toHaveLength(3);
    for (let t = 0; t < 3; t++) {
      const list = tests[t];
      expect(list).toHaveLength(20);
      const reading = list.slice(0, 8), cloze = list.slice(8, 16), single = list.slice(16);
      expect(new Set(reading.map((q: any) => q.passage_id)).size).toBe(1);
      expect(reading[0].passage.kind).toBe('reading');
      expect(reading.map((q: any) => q.passage_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(new Set(cloze.map((q: any) => q.passage_id)).size).toBe(1);
      expect(cloze[0].passage.kind).toBe('cloze');
      expect(cloze.map((q: any) => q.passage_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(single.every((q: any) => !q.passage_id)).toBe(true);
      expect(matching[t]).toHaveLength(4);
      expect(open[t]).toHaveLength(2);
    }
  });
  it('пока хватает текстов, в трёх билетах тексты не повторяются', () => {
    const [tests] = pickTickets(englishPool(), S, rng(11)).kinds;
    const readIds = tests.map((l: any[]) => l[0].passage_id);
    const clozeIds = tests.map((l: any[]) => l[8].passage_id);
    expect(new Set(readIds).size).toBe(3);
    expect(new Set(clozeIds).size).toBe(3);
  });
  it('без текстов в пуле предмет без текстов работает как раньше: 20 одиночных', () => {
    const pool = [...Array.from({ length: 40 }, (_, i) => base('test', `s${i}`, i % 5, i)), ...Array.from({ length: 8 }, (_, i) => base('matching', `m${i}`, i % 2, i)), ...Array.from({ length: 4 }, (_, i) => base('open', `o${i}`, i % 2, i))];
    const plain: Settings = { testCount: 20, matchingCount: 4, openCount: 2, ticketCount: 2, shuffleOptions: true, shuffleMatching: true, title: 'x' };
    const [tests] = pickTickets(pool, plain, rng(3)).kinds;
    expect(tests[0]).toHaveLength(20);
    expect(tests[0].every((q: any) => !q.passage_id)).toBe(true);
  });
});
