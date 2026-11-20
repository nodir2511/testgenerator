import { describe, expect, it } from 'vitest';
import { CHEM_CONFIG, pickNct, planNct, sectionOfQuestion, sectionPoints } from '../supabase/functions/_shared/nct';
import { LAW_CONFIG, lawTopicNumber } from '../supabase/functions/_shared/nctLaw';
import { nctConfigByKey, nctConfigFor } from '../supabase/functions/_shared/nctConfigs';
import { NCT_SLOT_TYPES_LAW, NCT_TYPE_SECTION_LAW } from '../supabase/functions/_shared/nctSlotsLaw';
import { NCT_TYPES_LAW } from '../src/lib/nctTypesLaw';
import { nctTypesFor, nctTypeName } from '../src/lib/nctTypes';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZES: Record<number, number> = { 1: 14, 2: 11, 3: 11, 4: 8, 5: 8, 6: 8, 7: 8, 8: 8, 9: 9, 10: 8 };

/** Банк права: по 5 глав, у каждой темы по `per` вопросов каждого вида; метки типов раздела раздаются по кругу */
function lawPool(per: { test: number; matching: number; open: number }, labelled = true) {
  const out: any[] = [];
  const codes = (sec: string, kind: string) => Object.keys(NCT_SLOT_TYPES_LAW[`${sec}:${kind}`] ?? {});
  for (const ch of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const sec = LAW_CONFIG.topicSection(ch, 1)!;
    for (let tp = 1; tp <= SIZES[ch]; tp++) {
      for (const type of ['test', 'matching', 'open'] as const) {
        const list = codes(sec, type);
        for (let i = 1; i <= per[type]; i++) {
          out.push({
            id: `${type}-${ch}-${tp}-${i}`, type, topic_id: `t${ch}.${tp}`, chapter_id: `c${ch}`,
            chapter: { order_index: ch }, topic: { order_index: tp },
            nct_type: labelled && list.length ? list[(tp * 7 + i) % list.length] : null,
          });
        }
      }
    }
  }
  return out;
}

describe('режим НЦТ: право — карта тем и состав', () => {
  it('сквозные номера тем 1–93, остальное вне режима', () => {
    expect(lawTopicNumber(1, 1)).toBe(1);
    expect(lawTopicNumber(1, 14)).toBe(14);
    expect(lawTopicNumber(2, 1)).toBe(15);
    expect(lawTopicNumber(3, 11)).toBe(36);
    expect(lawTopicNumber(4, 1)).toBe(37);
    expect(lawTopicNumber(5, 8)).toBe(52);
    expect(lawTopicNumber(5, 9)).toBeNull();
    expect(lawTopicNumber(6, 1)).toBe(53);
    expect(lawTopicNumber(9, 9)).toBe(85);
    expect(lawTopicNumber(10, 8)).toBe(93);
    expect(lawTopicNumber(10, 9)).toBeNull();
    expect(lawTopicNumber(11, 1)).toBeNull();
    expect(lawTopicNumber(0, 1)).toBeNull();
  });

  it('раздел темы по главе: теория и отрасли (гл. 1, 3), конституционное право и права в Таджикистане (гл. 2, 5, 6), международные нормы (гл. 4, 7–10)', () => {
    const sec = (c: number, t: number) => LAW_CONFIG.topicSection(c, t);
    expect([sec(1, 1), sec(3, 11)]).toEqual(['state', 'state']);
    expect([sec(2, 1), sec(2, 11), sec(5, 1), sec(5, 8), sec(6, 1), sec(6, 8)]).toEqual(['rights', 'rights', 'rights', 'rights', 'rights', 'rights']);
    expect([sec(4, 1), sec(4, 8), sec(7, 1), sec(10, 8)]).toEqual(['intl', 'intl', 'intl', 'intl']);
    expect([sec(11, 1), sec(3, 12), sec(5, 9)]).toEqual([null, null, null]);
  });

  it('размеченное задание идёт в раздел своего типа; тема вне режима остаётся вне', () => {
    const q = { chapter: { order_index: 1 }, topic: { order_index: 10 }, nct_type: 'ACT' }; // акты — конституционное право
    expect(sectionOfQuestion(q, LAW_CONFIG)).toBe('rights');
    expect(sectionOfQuestion({ ...q, nct_type: 'TOL' }, LAW_CONFIG)).toBe('intl'); // толерантность — международные нормы, где бы ни лежало
    expect(sectionOfQuestion({ ...q, nct_type: null }, LAW_CONFIG)).toBe('state');
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 11 } }, LAW_CONFIG)).toBeNull();
    expect(sectionOfQuestion({ ...q, nct_type: 'НЕТ_ТАКОГО' }, LAW_CONFIG)).toBe('state');
  });

  it('доли разделов дают 40 баллов; химия не изменилась', () => {
    const p = sectionPoints(['state', 'rights', 'intl'], undefined, LAW_CONFIG);
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBe(40);
    expect(LAW_CONFIG.sections.reduce((a, s) => a + s.share, 0)).toBe(100);
    expect(CHEM_CONFIG.composition).toEqual({ test: 18, matching: 2, open: 7, points: 40 });
  });

  it('предмет выбирает свои настройки', () => {
    expect(nctConfigFor('Право')?.key).toBe('law');
    expect(nctConfigFor('Химия')?.key).toBe('chemistry');
    expect(nctConfigFor('Биология')?.key).toBe('biology');
    expect(nctConfigByKey('law')).toBe(LAW_CONFIG);
    expect(nctConfigByKey(undefined)).toBe(CHEM_CONFIG);
  });

  it('справочник типов: 76 типов, таблица слотов и раздел каждого типа согласованы', () => {
    expect(NCT_TYPES_LAW.length).toBe(76);
    expect(new Set(NCT_TYPES_LAW.map((t) => t.code)).size).toBe(76);
    for (const t of NCT_TYPES_LAW) expect(NCT_TYPE_SECTION_LAW[t.code]).toBe(t.section);
    for (const [key, codes] of Object.entries(NCT_SLOT_TYPES_LAW)) {
      for (const c of Object.keys(codes)) expect(NCT_TYPE_SECTION_LAW[c]).toBe(key.split(':')[0]);
    }
    expect(nctTypesFor('Право')).toBe(NCT_TYPES_LAW);
    expect(nctTypeName('OPENPOWER')).toContain('полномочия Президента');
    expect(nctTypeName('BOND')).toBe('Вид химической связи');
  });
});

describe('режим НЦТ: право — подбор билета', () => {
  const per = { test: 6, matching: 3, open: 2 };

  it('план 20 тестов + 4 соответствия + 2 открытых; открытые только в разделах «Государство и право» и «Права в Таджикистане»', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const have = { state: { test: 60, matching: 20, open: 10 }, rights: { test: 60, matching: 20, open: 10 }, intl: { test: 60, matching: 20, open: 10 } };
      const plan = planNct(['state', 'rights', 'intl'], have, 4, rng(seed), LAW_CONFIG)!;
      expect(plan).toBeTruthy();
      const sum = (k: 'test' | 'matching' | 'open') => Object.values(plan).reduce((a, p) => a + p[k], 0);
      expect([sum('test'), sum('matching'), sum('open')]).toEqual([20, 4, 2]);
      expect(plan.intl.open).toBe(0);
    }
  });

  it('билет на 1, 2 и 4 варианта: состав, один тип на месте, типы и вопросы не повторяются', () => {
    for (const T of [1, 2, 4]) {
      for (let seed = 1; seed <= 6; seed++) {
        const r = pickNct(lawPool(per), T, rng(seed), undefined, undefined, LAW_CONFIG);
        expect(r.kinds.map((k) => k[0].length), `T${T} seed${seed} ${r.notes.join('|')}`).toEqual([20, 4, 2]);
        for (const byTicket of r.kinds) {
          for (let t = 1; t < T; t++) {
            expect(byTicket[t].map((q) => q.nct_type)).toEqual(byTicket[0].map((q) => q.nct_type));
          }
        }
        const t0 = r.kinds.flatMap((k) => k[0]);
        const codes = t0.map((q) => q.nct_type).filter(Boolean);
        expect(new Set(codes).size).toBe(codes.length);
        const ids = r.kinds.flatMap((k) => k.flat()).map((q) => q.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('открытые берутся из раздела с открытыми типами; баллы билета = 40', () => {
    const r = pickNct(lawPool(per), 2, rng(5), undefined, undefined, LAW_CONFIG);
    const secs = r.kinds[2][0].map((q) => sectionOfQuestion(q, LAW_CONFIG));
    expect(secs.every((s) => s === 'state' || s === 'rights')).toBe(true);
    expect(r.kinds[0][0].length + 4 * r.kinds[1][0].length + 2 * r.kinds[2][0].length).toBe(40);
  });

  it('блоки разделов идут по порядку конфига', () => {
    const order = LAW_CONFIG.sections.map((s) => s.key);
    const r = pickNct(lawPool(per), 2, rng(9), undefined, undefined, LAW_CONFIG);
    const idx = r.kinds[0][0].map((q) => order.indexOf(sectionOfQuestion(q, LAW_CONFIG)!));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('темы не повторяются, пока тем в разделе хватает (по тестам)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = pickNct(lawPool({ test: 5, matching: 2, open: 2 }, false), 2, rng(seed), undefined, undefined, LAW_CONFIG);
      const bySec = new Map<string, string[]>();
      for (const q of r.kinds[0][0]) {
        const s = sectionOfQuestion(q, LAW_CONFIG)!;
        bySec.set(s, [...(bySec.get(s) ?? []), q.topic_id]);
      }
      for (const [s, topics] of bySec) {
        const cap = s === 'state' ? 25 : s === 'rights' ? 27 : 49;
        // каждое место в разделе — своя тема, пока тем хватает; повтор — только когда мест больше, чем тем
        expect(topics.length - new Set(topics).size, `${s} seed ${seed}`).toBe(Math.max(0, topics.length - cap));
      }
    }
  });

  it('банк без меток тоже даёт полный билет', () => {
    const r = pickNct(lawPool(per, false), 2, rng(2), undefined, undefined, LAW_CONFIG);
    expect(r.kinds.map((k) => k[0].length)).toEqual([20, 4, 2]);
  });

  it('при выборе только одной главы (раздел state) билет собирается на 20 тестов, 4 соответствия, 2 открытых', () => {
    const ch1Pool = lawPool(per).filter((q) => q.chapter.order_index === 1);
    const r = pickNct(ch1Pool, 2, rng(15), undefined, undefined, LAW_CONFIG);
    expect(r.kinds.map((k) => k[0].length)).toEqual([20, 4, 2]);
  });

  it('вопросы тем вне глав 1–10 в билет не берутся', () => {
    const pool = [...lawPool(per), { id: 'x1', type: 'test', topic_id: 'tx', chapter_id: 'c6', chapter: { order_index: 11 }, topic: { order_index: 1 }, nct_type: null }];
    const r = pickNct(pool, 1, rng(4), undefined, undefined, LAW_CONFIG);
    expect(r.kinds.flatMap((k) => k.flat()).some((q) => q.id === 'x1')).toBe(false);
    expect(r.notes.join(' ')).toContain('вне глав 1–10');
  });
});
