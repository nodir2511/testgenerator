import { describe, expect, it } from 'vitest';
import { CHEM_CONFIG, pickNct, planNct, sectionOfQuestion, sectionPoints } from '../supabase/functions/_shared/nct';
import { HISTORY_CONFIG, historyTopicNumber, historyTopicPeriod } from '../supabase/functions/_shared/nctHistory';
import { LAW_CONFIG } from '../supabase/functions/_shared/nctLaw';
import { nctConfigByKey, nctConfigFor } from '../supabase/functions/_shared/nctConfigs';
import { NCT_SLOT_TYPES_HISTORY, NCT_TYPE_SECTION_HISTORY } from '../supabase/functions/_shared/nctSlotsHistory';
import { NCT_TYPES_HISTORY } from '../src/lib/nctTypesHistory';
import { nctTypesFor, nctTypeName } from '../src/lib/nctTypes';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZES: Record<number, number> = { 1: 13, 2: 19, 3: 18, 4: 15, 5: 15 };
const HIST_TOPICS = (ch: number) => Array.from({ length: SIZES[ch] }, (_, i) => i + 1).filter((tp) => historyTopicNumber(ch, tp) !== null);

/** Банк истории: по 5 глав, у каждой темы по `per` вопросов каждого вида; метки типов раздела темы и «всеобщей» раздаются по кругу */
function historyPool(per: { test: number; matching: number; open: number }, labelled = true, world = true) {
  const out: any[] = [];
  const codes = (sec: string, kind: string) => Object.keys(NCT_SLOT_TYPES_HISTORY[`${sec}:${kind}`] ?? {});
  for (const ch of [1, 2, 3, 4, 5]) {
    for (const tp of HIST_TOPICS(ch)) {
      for (const type of ['test', 'matching', 'open'] as const) {
        const tp3 = HISTORY_CONFIG.topicSection(ch, tp)!;
        const list = [...codes(tp3, type), ...(world ? codes('world', type) : [])];
        for (let i = 1; i <= per[type]; i++) {
          out.push({
            id: `${type}-${ch}-${tp}-${i}`, type, topic_id: `t${ch}.${tp}`, chapter_id: `c${ch}`,
            chapter: { order_index: ch }, topic: { order_index: tp },
            nct_type: labelled && list.length ? list[(ch * 31 + tp * 7 + i * 3) % list.length] : null,
          });
        }
      }
    }
  }
  return out;
}

describe('режим НЦТ: история — карта тем и состав', () => {
  it('сквозные номера тем центра: книги 1–5, обобщающие 4–5 и главы 6+ вне режима', () => {
    expect(historyTopicNumber(1, 1)).toBe(1);
    expect(historyTopicNumber(1, 13)).toBe(13);
    expect(historyTopicNumber(1, 14)).toBeNull();
    expect(historyTopicNumber(2, 1)).toBe(15);
    expect(historyTopicNumber(2, 12)).toBe(26); // Саманиды — № 26 (кн. 2, § 12)
    expect(historyTopicNumber(2, 19)).toBe(33);
    expect(historyTopicNumber(3, 1)).toBe(34);
    expect(historyTopicNumber(3, 9)).toBe(42);
    expect(historyTopicNumber(4, 1)).toBe(52);
    expect(historyTopicNumber(4, 14)).toBe(65);
    expect(historyTopicNumber(4, 15)).toBeNull();
    expect(historyTopicNumber(5, 9)).toBe(74);
    expect(historyTopicNumber(5, 15)).toBeNull();
    expect(historyTopicNumber(6, 1)).toBeNull();
    expect(historyTopicNumber(0, 1)).toBeNull();
  });

  it('раздел темы по периоду: гл. 1–2 и 3.1–3.3 до XV в., 3.4–3.18 с конца XV в., гл. 4–5 с 1920; всеобщая — по метке W_', () => {
    const sec = (c: number, t: number) => HISTORY_CONFIG.topicSection(c, t);
    expect([sec(1, 1), sec(1, 13), sec(2, 1), sec(2, 19), sec(3, 1), sec(3, 3)]).toEqual(['p1', 'p1', 'p1', 'p1', 'p1', 'p1']);
    expect([sec(3, 4), sec(3, 10), sec(3, 17), sec(3, 18)]).toEqual(['p2', 'p2', 'p2', 'p2']);
    expect([sec(4, 1), sec(4, 14), sec(5, 1), sec(5, 14)]).toEqual(['p3', 'p3', 'p3', 'p3']);
    expect([sec(4, 15), sec(5, 15), sec(6, 1), sec(3, 19)]).toEqual([null, null, null, null]);
    expect(historyTopicPeriod(3, 3)).toBe('p1');
    const q = { chapter: { order_index: 3 }, topic: { order_index: 5 }, nct_type: 'PERSON' };
    expect(sectionOfQuestion(q, HISTORY_CONFIG)).toBe('p2');
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 1 } }, HISTORY_CONFIG)).toBe('p1'); // тот же тип в другом разделе
    expect(sectionOfQuestion({ ...q, nct_type: 'W_PERSON' }, HISTORY_CONFIG)).toBe('world');
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 5 }, nct_type: 'W_PERSON' }, HISTORY_CONFIG)).toBe('world');
    expect(sectionOfQuestion({ ...q, nct_type: null }, HISTORY_CONFIG)).toBe('p2');
    expect(sectionOfQuestion({ ...q, nct_type: 'НЕТ_ТАКОГО' }, HISTORY_CONFIG)).toBe('p2');
    expect(sectionOfQuestion({ ...q, nct_type: 'W_PERSON', chapter: { order_index: 6 } }, HISTORY_CONFIG)).toBeNull();
  });

  it('доли разделов дают 40 баллов; химия и право не изменились', () => {
    const p = sectionPoints(['p1', 'p2', 'p3', 'world'], undefined, HISTORY_CONFIG);
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBe(40);
    expect(p).toEqual({ p1: 11, p2: 8, p3: 11, world: 10 });
    expect(HISTORY_CONFIG.sections.reduce((a, s) => a + s.share, 0)).toBe(100);
    expect(CHEM_CONFIG.composition).toEqual({ test: 18, matching: 2, open: 7, points: 40 });
    expect(CHEM_CONFIG.maxTypeUse).toBeUndefined();
    expect(LAW_CONFIG.maxTypeUse).toBeUndefined();
  });

  it('предмет выбирает свои настройки; история не пересекается с другими', () => {
    expect(nctConfigFor('История')?.key).toBe('history');
    expect(nctConfigFor('Таърих')?.key).toBe('history');
    expect(nctConfigFor('Право')?.key).toBe('law');
    expect(nctConfigFor('Химия')?.key).toBe('chemistry');
    expect(nctConfigFor('Биология')).toBeNull();
    expect(nctConfigFor('Физика')).toBeNull();
    expect(nctConfigFor('Таджикский язык')).toBeNull();
    expect(nctConfigByKey('history')).toBe(HISTORY_CONFIG);
    expect(nctConfigByKey(undefined)).toBe(CHEM_CONFIG);
  });

  it('справочник типов: 49 типов (29 таджикской + 20 всеобщей), таблица слотов и раздел типа согласованы', () => {
    expect(NCT_TYPES_HISTORY.length).toBe(49);
    expect(new Set(NCT_TYPES_HISTORY.map((t) => t.code)).size).toBe(49);
    expect(NCT_TYPES_HISTORY.filter((t) => !t.code.startsWith('W_')).length).toBe(29);
    for (const t of NCT_TYPES_HISTORY) expect(NCT_TYPE_SECTION_HISTORY[t.code]).toBe(t.section);
    for (const [key, codes] of Object.entries(NCT_SLOT_TYPES_HISTORY)) {
      for (const c of Object.keys(codes)) {
        // W_-типы стоят только в «всеобщей», таджикские — в разделах 1–3 (один код — в нескольких)
        expect(c.startsWith('W_')).toBe(key.startsWith('world:'));
      }
    }
    expect(Object.keys(NCT_SLOT_TYPES_HISTORY).filter((k) => k.endsWith(':test') && !k.startsWith('world')).flatMap((k) => Object.keys(NCT_SLOT_TYPES_HISTORY[k])).filter((c, i, a) => a.indexOf(c) !== i).length).toBeGreaterThan(0);
    expect(nctTypesFor('История')).toBe(NCT_TYPES_HISTORY);
    expect(nctTypeName('OPYEAR')).toContain('год');
    expect(nctTypeName('W_PERSON')).toContain('Всеобщая история');
    expect(nctTypeName('BOND')).toBe('Вид химической связи');
  });
});

describe('режим НЦТ: история — подбор билета', () => {
  const per = { test: 12, matching: 3, open: 3 };

  it('план 20 тестов + 4 соответствия + 2 открытых; открытые на таджикской истории, не больше одного в разделе', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const mk = (o: number) => ({ test: 300, matching: 60, open: o });
      const have = { p1: mk(30), p2: mk(10), p3: mk(5), world: { test: 100, matching: 20, open: 5 } };
      const plan = planNct(['p1', 'p2', 'p3', 'world'], have, 4, rng(seed), HISTORY_CONFIG)!;
      expect(plan).toBeTruthy();
      const sum = (k: 'test' | 'matching' | 'open') => Object.values(plan).reduce((a, p) => a + p[k], 0);
      expect([sum('test'), sum('matching'), sum('open')]).toEqual([20, 4, 2]);
      expect(plan.world.open).toBeLessThanOrEqual(1);
      for (const s of ['p1', 'p2', 'p3', 'world']) expect(plan[s].open).toBeLessThanOrEqual(1);
    }
  });

  it('на 30 прогонах баллы раздела в пределах ±2 от доли; всеобщая — 5 тестов и 1 соответствие; в таджикских разделах есть тесты', () => {
    const target = sectionPoints(['p1', 'p2', 'p3', 'world'], undefined, HISTORY_CONFIG);
    for (let seed = 1; seed <= 30; seed++) {
      const mk = (o: number) => ({ test: 200 + seed, matching: 30, open: o });
      const have = { p1: mk(20), p2: mk(8), p3: mk(6), world: { test: 90, matching: 12, open: seed % 2 ? 3 : 0 } };
      const plan = planNct(['p1', 'p2', 'p3', 'world'], have, (seed % 4) + 1, rng(seed), HISTORY_CONFIG)!;
      expect(plan).toBeTruthy();
      for (const k of ['p1', 'p2', 'p3', 'world']) {
        const pts = plan[k].test + 4 * plan[k].matching + 2 * plan[k].open;
        expect(Math.abs(pts - target[k]), `${k} seed ${seed}`).toBeLessThanOrEqual(2);
        if (k !== 'world') expect(plan[k].test, `${k} seed ${seed}`).toBeGreaterThanOrEqual(3);
      }
      expect([plan.world.test, plan.world.matching]).toEqual([5, 1]);
    }
  });

  it('билет на 1, 2 и 4 варианта: состав, один тип на месте, тип не более 2 раз, вопросы не повторяются', () => {
    for (const T of [1, 2, 4]) {
      for (let seed = 1; seed <= 6; seed++) {
        const r = pickNct(historyPool(per), T, rng(seed), undefined, undefined, HISTORY_CONFIG);
        expect(r.kinds.map((k) => k[0].length)).toEqual([20, 4, 2]);
        for (const byTicket of r.kinds) {
          for (let t = 1; t < T; t++) {
            expect(byTicket[t].map((q) => q.nct_type)).toEqual(byTicket[0].map((q) => q.nct_type));
          }
        }
        const t0 = r.kinds.flatMap((k) => k[0]);
        const cnt = new Map<string, number>();
        for (const q of t0) if (q.nct_type) cnt.set(q.nct_type, (cnt.get(q.nct_type) ?? 0) + 1);
        for (const [c, n] of cnt) expect(n, `${c} seed ${seed}`).toBeLessThanOrEqual(2);
        const ids = r.kinds.flatMap((k) => k.flat()).map((q) => q.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('баллы билета = 40; открытые из таджикского раздела; блоки разделов по порядку', () => {
    const order = HISTORY_CONFIG.sections.map((s) => s.key);
    for (const seed of [3, 5, 9]) {
      const r = pickNct(historyPool(per), 2, rng(seed), undefined, undefined, HISTORY_CONFIG);
      expect(r.kinds[0][0].length + 4 * r.kinds[1][0].length + 2 * r.kinds[2][0].length).toBe(40);
      expect(r.kinds[2][0].every((q) => sectionOfQuestion(q, HISTORY_CONFIG) !== 'world')).toBe(true);
      const idx = r.kinds[0][0].map((q) => order.indexOf(sectionOfQuestion(q, HISTORY_CONFIG)!));
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });

  it('при выборе только одной главы (раздел p1) билет успешно собирается на 20 тестов, 4 соответствия, 2 открытых', () => {
    const ch1Pool = historyPool(per).filter((q) => q.chapter.order_index === 1);
    const r = pickNct(ch1Pool, 2, rng(42), undefined, undefined, HISTORY_CONFIG);
    expect(r.kinds.map((k) => k[0].length)).toEqual([20, 4, 2]);
    expect(r.kinds[0][0].length + 4 * r.kinds[1][0].length + 2 * r.kinds[2][0].length).toBe(40);
  });

  it('без вопросов всеобщей истории билет целиком из таджикских разделов', () => {
    const r = pickNct(historyPool(per, true, false), 2, rng(7), undefined, undefined, HISTORY_CONFIG);
    expect(r.kinds.map((k) => k[0].length)).toEqual([20, 4, 2]);
    expect(r.kinds.flat(2).every((q) => sectionOfQuestion(q, HISTORY_CONFIG) !== 'world')).toBe(true);
  });

  it('с разметкой всеобщей истории в билете есть задания раздела «Всеобщая история»', () => {
    const r = pickNct(historyPool(per), 2, rng(4), undefined, undefined, HISTORY_CONFIG);
    const w = r.kinds.flat(2).filter((q) => sectionOfQuestion(q, HISTORY_CONFIG) === 'world').length;
    expect(w).toBeGreaterThan(0);
  });

  it('банк без меток тоже даёт полный билет', () => {
    const r = pickNct(historyPool(per, false), 2, rng(2), undefined, undefined, HISTORY_CONFIG);
    expect(r.kinds.map((k) => k[0].length)).toEqual([20, 4, 2]);
  });

  it('темы не повторяются, пока тем хватает (по тестам)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = pickNct(historyPool({ test: 5, matching: 2, open: 2 }, false), 2, rng(seed), undefined, undefined, HISTORY_CONFIG);
      const topics = r.kinds[0][0].map((q) => q.topic_id);
      expect(topics.length - new Set(topics).size, `seed ${seed}`).toBe(0); // 20 мест, тем 78
    }
  });

  it('вопросы тем вне режима в билет не берутся', () => {
    const pool = [...historyPool(per), { id: 'x1', type: 'test', topic_id: 'tx', chapter_id: 'c6', chapter: { order_index: 6 }, topic: { order_index: 1 }, nct_type: null },
      { id: 'x2', type: 'test', topic_id: 'ty', chapter_id: 'c4', chapter: { order_index: 4 }, topic: { order_index: 15 }, nct_type: null }];
    const r = pickNct(pool, 1, rng(4), undefined, undefined, HISTORY_CONFIG);
    const ids = r.kinds.flatMap((k) => k.flat()).map((q) => q.id);
    expect(ids.includes('x1') || ids.includes('x2')).toBe(false);
    expect(r.notes.join(' ')).toContain('вне глав 1–5');
  });
});
