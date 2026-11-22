import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { POOL_SELECT, QUESTION_FULL_SELECT, hydrateTickets, loadLightPool } from '../supabase/functions/_shared/pool';
import {
  PASSAGE_SIZE, checkSettings, fitSettings, passageBlocks, pickBlocks, pickTickets, poolStats, singleTests, toSnapshot, snapshotTickets,
  type Settings,
} from '../supabase/functions/_shared/ticketing';

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

/** Пул без текстов: topics × per вопросов одного вида */
function mk(type: string, topics: number, per: number) {
  const out: any[] = [];
  for (let t = 0; t < topics; t++) for (let n = 1; n <= per; n++) out.push(base(type, `${type}-${t}-${n}`, t, n));
  return out;
}

/** Текст из `size` вопросов (passage_order 1…size), лежащий в теме topic */
function mkPassage(id: string, kind: 'reading' | 'cloze', topic: number, size = PASSAGE_SIZE) {
  const out: any[] = [];
  for (let k = 1; k <= size; k++) {
    out.push({
      ...base('test', `${id}-q${k}`, topic, k),
      passage_id: id, passage_order: k, passage: { kind },
    });
  }
  return out;
}

/** reading / cloze — по тексту на тему, single — одиночные тесты по 4 в теме */
function mkPool(o: { reading?: number; cloze?: number; single?: number; matching?: number; open?: number }) {
  const pool: any[] = [];
  for (let i = 0; i < (o.reading ?? 0); i++) pool.push(...mkPassage(`r${i}`, 'reading', i));
  for (let i = 0; i < (o.cloze ?? 0); i++) pool.push(...mkPassage(`c${i}`, 'cloze', i));
  if (o.single) pool.push(...mk('test', Math.ceil(o.single / 4), 4).slice(0, o.single));
  if (o.matching) pool.push(...mk('matching', Math.ceil(o.matching / 4), 4).slice(0, o.matching));
  if (o.open) pool.push(...mk('open', Math.ceil(o.open / 2), 2).slice(0, o.open));
  return pool;
}

const eng = (over: Partial<Settings> = {}): Settings => ({
  testCount: 20, readingCount: 1, clozeCount: 1, matchingCount: 4, openCount: 2, ticketCount: 2,
  shuffleOptions: true, shuffleMatching: true, title: 'x', ...over,
});

describe('passageBlocks', () => {
  it('блок короче 8 вопросов отбрасывается, длиннее — первые 8 по passage_order', () => {
    const pool = [...mkPassage('r1', 'reading', 0, 7), ...mkPassage('r2', 'reading', 1, 9), ...mkPassage('c1', 'cloze', 2)];
    const { reading, cloze } = passageBlocks(pool);
    expect(reading.map((b) => b.id)).toEqual(['r2']);
    expect(reading[0].questions.map((q) => q.passage_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(cloze.map((b) => b.id)).toEqual(['c1']);
  });
  it('вопросы блока идут по passage_order, даже если пришли вперемешку', () => {
    const pool = mkPassage('r1', 'reading', 0).reverse();
    expect(passageBlocks(pool).reading[0].questions.map((q) => q.passage_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('pickTickets с текстами', () => {
  it('в каждом билете: текст чтения, текст с пропусками, затем одиночные тесты', () => {
    const pool = mkPool({ reading: 3, cloze: 3, single: 12, matching: 8, open: 4 });
    const picked = pickTickets(pool, eng(), rng(3));
    const tests = picked.kinds[0];
    expect(tests).toHaveLength(2);
    for (const t of tests) {
      expect(t).toHaveLength(20);
      expect(new Set(t.slice(0, 8).map((q: any) => q.passage_id)).size).toBe(1);
      expect(t[0].passage.kind).toBe('reading');
      expect(t.slice(0, 8).map((q: any) => q.passage_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(new Set(t.slice(8, 16).map((q: any) => q.passage_id)).size).toBe(1);
      expect(t[8].passage.kind).toBe('cloze');
      expect(t.slice(8, 16).map((q: any) => q.passage_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(t.slice(16).every((q: any) => !q.passage_id)).toBe(true);
    }
  });

  it('два билета получают разные тексты', () => {
    const pool = mkPool({ reading: 3, cloze: 3, single: 12, matching: 8, open: 4 });
    const [a, b] = pickTickets(pool, eng(), rng(5)).kinds[0];
    expect(a[0].passage_id).not.toBe(b[0].passage_id);
    expect(a[8].passage_id).not.toBe(b[8].passage_id);
  });

  it('место текста в разных билетах — из одной темы, пока текстов хватает', () => {
    const pool = mkPool({ reading: 4, cloze: 4, single: 12, matching: 8, open: 4 });
    // в mkPassage каждый текст в своей теме — поэтому место делят разные темы только при нехватке
    const picked = pickBlocks(passageBlocks(pool).reading, 1, 2, rng(1));
    expect(picked).toHaveLength(2);
    expect(picked[0]).toHaveLength(1);
    expect(picked[0][0].id).not.toBe(picked[1][0].id);
  });

  it('Review Focus 1: без текстов результат прежний (эталон до изменений)', () => {
    const pool = [...mk('test', 6, 12), ...mk('matching', 3, 6), ...mk('open', 2, 4)];
    const p = pickTickets(pool, { testCount: 20, matchingCount: 4, openCount: 2, ticketCount: 2, shuffleOptions: true, shuffleMatching: true, title: 'x' }, rng(7));
    const got = p.kinds.map((k) => k.map((t) => t.map((q: any) => q.id)));
    const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/pick-baseline.json', import.meta.url), 'utf8'));
    expect(got).toEqual(baseline);
  });

  it('Review Focus 2: текстов меньше, чем вариантов — билеты полные, текст повторяется, есть заметка', () => {
    const pool = mkPool({ reading: 1, cloze: 1, single: 20, matching: 12, open: 6 });
    const s = eng({ ticketCount: 3 });
    const fit = fitSettings(poolStats(pool), s);
    expect(fit.notes.some((n) => /текст/i.test(n) && /повтор/i.test(n))).toBe(true);
    const tests = pickTickets(pool, fit.settings, rng(9)).kinds[0];
    expect(tests).toHaveLength(3);
    for (const t of tests) expect(t).toHaveLength(20);
    expect(tests[0][0].passage_id).toBe(tests[1][0].passage_id);
  });

  it('Review Focus 3: состав без текстов — вопросы к тексту поодиночке не берутся', () => {
    const pool = mkPool({ reading: 2, cloze: 2, single: 12, matching: 4, open: 2 });
    expect(poolStats(pool).test).toBe(12);
    const tests = pickTickets(pool, { testCount: 10, matchingCount: 0, openCount: 0, ticketCount: 2, shuffleOptions: true, shuffleMatching: true, title: 'x' }, rng(2)).kinds[0];
    for (const t of tests) {
      expect(t).toHaveLength(10);
      expect(t.every((q: any) => !q.passage_id)).toBe(true);
    }
  });
});

describe('настройки с текстами', () => {
  it('singleTests = testCount − 8 × (чтение + пропуски)', () => {
    expect(singleTests(eng())).toBe(4);
    expect(singleTests({ ...eng(), readingCount: 0, clozeCount: 0 })).toBe(20);
    expect(singleTests({ ...eng(), readingCount: undefined, clozeCount: undefined })).toBe(20);
  });
  it('checkSettings: в тестах билета меньше, чем вопросов в текстах — ошибка', () => {
    expect(checkSettings(eng({ testCount: 10 }))).toMatch(/меньше/);
    expect(checkSettings(eng())).toBeNull();
  });
  it('poolStats считает тексты блоками, а одиночные тесты — без вопросов к тексту', () => {
    const st = poolStats(mkPool({ reading: 2, cloze: 1, single: 6 }));
    expect([st.reading, st.cloze, st.test]).toEqual([2, 1, 6]);
  });
  it('fitSettings урезает число текстов до наличия с заметкой и держит testCount согласованным', () => {
    const pool = mkPool({ reading: 1, cloze: 0, single: 8, matching: 4, open: 2 });
    const fit = fitSettings(poolStats(pool), eng({ ticketCount: 1 }));
    expect(fit.settings.readingCount).toBe(1);
    expect(fit.settings.clozeCount).toBe(0);
    expect(fit.notes.some((n) => /Тексты с пропусками/.test(n))).toBe(true);
    expect(fit.settings.testCount).toBe(8 + singleTests(fit.settings));
  });
});

describe('снимок', () => {
  it('вопрос текста несёт passage и passage_order, обычный вопрос — нет (Review Focus 1)', () => {
    const q = { ...mkPassage('r1', 'reading', 0)[2], content: 'Q', options: [], passage: { id: 'r1', kind: 'reading', title: 'T', content: 'Text' } };
    const snap: any = toSnapshot(q, { shuffleOptions: false, shuffleMatching: false });
    expect(snap.passage).toEqual({ id: 'r1', kind: 'reading', title: 'T', content: 'Text' });
    expect(snap.passage_order).toBe(3);
    const plain: any = toSnapshot({ ...base('test', 'x', 0, 1), content: 'Q', options: [] }, { shuffleOptions: false, shuffleMatching: false });
    expect(Object.keys(plain)).not.toContain('passage');
    expect(Object.keys(plain)).not.toContain('passage_order');
  });
  it('snapshotTickets сохраняет блоки в порядке', () => {
    const pool = mkPool({ reading: 2, cloze: 2, single: 8, matching: 8, open: 4 }).map((q) => ({
      ...q, content: 'c', options: [], matching_items: [],
      passage: q.passage_id ? { id: q.passage_id, kind: q.passage.kind, title: '', content: 'T' } : undefined,
    }));
    const t = snapshotTickets(pickTickets(pool, eng(), rng(4)), { shuffleOptions: false, shuffleMatching: false }, rng(4));
    expect(t[0].questions[0].question_snapshot.passage.kind).toBe('reading');
    expect(t[0].questions[8].question_snapshot.passage.kind).toBe('cloze');
  });
});

/** Клиент-заглушка: если в select есть passage и «таблицы нет» — отдаёт ошибку, как база до миграции */
function oldDbClient(rows: any[]) {
  const log: string[] = [];
  const from = () => {
    let select = '';
    let ids: string[] | null = null;
    const q: any = {
      select: (s: string) => { select = s; return q; },
      eq: () => q, in: (_c: string, v: string[]) => { ids = v; return q; }, order: () => q, limit: () => q,
      then: (resolve: (v: any) => void) => {
        log.push(select);
        if (/passage/.test(select)) return resolve({ data: null, error: { message: 'Could not find a relationship between questions and passages' } });
        resolve({ data: ids ? rows.filter((r) => ids!.includes(r.id)) : rows, error: null });
      },
    };
    return q;
  };
  return { sb: { from }, log };
}

describe('пул до применения миграции', () => {
  it('в селектах есть поля текста', () => {
    expect(POOL_SELECT).toMatch(/passage_id/);
    expect(QUESTION_FULL_SELECT).toMatch(/passage:passages\(id, kind, title, content\)/);
  });
  it('loadLightPool и hydrateTickets читают без текстов, если таблицы passages ещё нет', async () => {
    const rows = mk('test', 2, 4);
    const { sb, log } = oldDbClient(rows);
    const pool = await loadLightPool(sb, { subjectId: 's', chapterIds: [], topicIds: [] });
    expect(pool).toHaveLength(8);
    expect(log.some((l) => /passage/.test(l))).toBe(true);
    expect(/passage/.test(log[log.length - 1])).toBe(false);
    const kinds = [[[pool[0], pool[1]]]];
    await hydrateTickets(sb, kinds as any);
    expect(kinds[0][0].map((q: any) => q.id)).toEqual([pool[0].id, pool[1].id]);
  });
});
