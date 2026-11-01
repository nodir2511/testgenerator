import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, buildTickets, pickTickets, snapshotTickets } from '../supabase/functions/_shared/ticketing';
import { QUESTION_FULL_SELECT, POOL_SELECT, hydrateTickets, loadLightPool } from '../supabase/functions/_shared/pool';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePool(type: string, topics: number, perTopic: number) {
  const out: any[] = [];
  for (let t = 0; t < topics; t++) {
    for (let n = 1; n <= perTopic; n++) {
      out.push({
        id: `${type}-${String(t).padStart(2, '0')}-${String(n).padStart(3, '0')}`, type, topic_id: `t${t}`, chapter_id: `c${t % 2}`, num: n,
        chapter: { name: `Глава ${t % 2}`, order_index: t % 2 }, topic: { name: `Тема ${t}`, order_index: t },
        content: `Вопрос ${t}.${n}`,
        options: type === 'test' ? [0, 1, 2, 3].map((k) => ({ id: `${type}-${t}-${n}-o${k}`, text: `v${k}`, order_index: k + 1, is_correct: k === 2 })) : undefined,
      });
    }
  }
  return out;
}

const light = (q: any) => ({ id: q.id, type: q.type, topic_id: q.topic_id, chapter_id: q.chapter_id, num: q.num, linked_ids: q.linked_ids ?? null, chapter: { order_index: q.chapter.order_index }, topic: { order_index: q.topic.order_index } });

// Имитация цепочки запросов Supabase к таблице questions: фильтры eq/in, order('id'), range, плюс select по списку id
function fakeClient(rows: any[]) {
  const log: Array<{ select: string; kind: string; size?: number }> = [];
  const from = (_table: string) => {
    let select = '';
    const filters: Array<(r: any) => boolean> = [];
    let range: [number, number] | null = null;
    const q: any = {
      select: (s: string) => { select = s; return q; },
      eq: () => q, // предмет и признак удаления в тестовых данных не различаются
      in: (col: string, vals: string[]) => { filters.push((r) => vals.includes(r[col])); return q; },
      order: () => q,
      range: (a: number, b: number) => { range = [a, b]; return q; },
      then: (resolve: (v: any) => void) => {
        let data = rows.filter((r) => filters.every((f) => f(r)));
        if (range) data = data.slice(range[0], range[1] + 1).slice(0, 1000);
        log.push({ select, kind: range ? 'pool' : 'ids', size: data.length });
        resolve({ data: select === POOL_SELECT ? data.map(light) : data, error: null });
      },
    };
    return q;
  };
  return { sb: { from }, log };
}

describe('loadLightPool', () => {
  for (const total of [0, 999, 1000, 1001, 5000, 9100]) {
    it(`читает все строки по порядку (${total})`, async () => {
      const rows = Array.from({ length: total }, (_, i) => ({ id: `q${String(i).padStart(5, '0')}`, type: 'test', topic_id: 't', chapter_id: 'c', chapter: { name: 'x', order_index: 1 }, topic: { name: 'x', order_index: 1 } }));
      const { sb } = fakeClient(rows);
      const pool = await loadLightPool(sb, { subjectId: 's', chapterIds: [], topicIds: [] });
      expect(pool.map((q) => q.id)).toEqual(rows.map((r) => r.id));
    });
  }

  it('читает только лёгкие поля, без вариантов и текстов', async () => {
    const { sb, log } = fakeClient(makePool('test', 2, 3));
    await loadLightPool(sb, { subjectId: 's', chapterIds: [], topicIds: [] });
    expect(log[0].select).toBe(POOL_SELECT);
    expect(POOL_SELECT).not.toMatch(/options|matching_items|content|\*/);
  });
});

describe('подбор по лёгкому пулу', () => {
  it('билеты те же, что при подборе по полному пулу, а полные вопросы догружаются только выбранные', async () => {
    const full = [...makePool('test', 6, 40), ...makePool('matching', 4, 12), ...makePool('open', 4, 12)];
    const s = { ...DEFAULT_SETTINGS, ticketCount: 4, testCount: 18, matchingCount: 2, openCount: 3 };
    for (let seed = 1; seed <= 10; seed++) {
      const expected = buildTickets(full, s, rng(seed));

      const { sb, log } = fakeClient(full);
      const lightPool = await loadLightPool(sb, { subjectId: 's', chapterIds: [], topicIds: [] });
      const r = rng(seed);
      const picked = pickTickets(lightPool, s, r);
      await hydrateTickets(sb, picked.kinds);
      const actual = snapshotTickets(picked, s, r);

      expect(actual).toEqual(expected);
      // догружено ровно число уникальных выбранных вопросов
      const fetched = log.filter((l) => l.kind === 'ids').reduce((n, l) => n + (l.size ?? 0), 0);
      expect(fetched).toBe(4 * (18 + 2 + 3));
      expect(fetched).toBeLessThan(full.length);
    }
  });

  it('запросы за полными вопросами идут пачками, а не по одному', async () => {
    const full = makePool('test', 20, 60);
    const s = { ...DEFAULT_SETTINGS, ticketCount: 5, testCount: 40, matchingCount: 0, openCount: 0 };
    const { sb, log } = fakeClient(full);
    const picked = pickTickets(await loadLightPool(sb, { subjectId: 's', chapterIds: [], topicIds: [] }), s, rng(3));
    log.length = 0;
    await hydrateTickets(sb, picked.kinds);
    expect(log.length).toBe(2); // 200 вопросов → 2 запроса по 100
    expect(log.every((l) => l.select === QUESTION_FULL_SELECT)).toBe(true);
  });

  it('вопрос, исчезнувший между подбором и догрузкой, даёт понятную ошибку', async () => {
    const full = makePool('test', 4, 10);
    const s = { ...DEFAULT_SETTINGS, ticketCount: 2, testCount: 4, matchingCount: 0, openCount: 0 };
    const { sb } = fakeClient(full);
    const picked = pickTickets(await loadLightPool(sb, { subjectId: 's', chapterIds: [], topicIds: [] }), s, rng(1));
    const gone = picked.kinds[0][0][0].id;
    const { sb: sb2 } = fakeClient(full.filter((q) => q.id !== gone));
    await expect(hydrateTickets(sb2, picked.kinds)).rejects.toThrow(/изменилась/);
  });
});
