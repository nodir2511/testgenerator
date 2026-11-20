import { describe, expect, it } from 'vitest';
import { pickNct, planNct, sectionOfQuestion, sectionPoints } from '../supabase/functions/_shared/nct';
import { TAJ_CONFIG, tajTopicSection } from '../supabase/functions/_shared/nctTaj';
import { nctConfigByKey, nctConfigFor } from '../supabase/functions/_shared/nctConfigs';
import { examProfileFor } from '../supabase/functions/_shared/examProfiles';
import { NCT_SLOT_TYPES_TAJ, NCT_TYPE_SECTION_TAJ } from '../supabase/functions/_shared/nctSlotsTaj';
import { NCT_TYPES_TAJ } from '../src/lib/nctTypesTaj';
import { NCT_TYPES_BIO } from '../src/lib/nctTypesBio';
import { NCT_TYPES_ENGLISH } from '../src/lib/nctTypesEnglish';
import { NCT_TYPES_HISTORY } from '../src/lib/nctTypesHistory';
import { NCT_TYPES_LAW } from '../src/lib/nctTypesLaw';
import { NCT_TYPES_MATH } from '../src/lib/nctTypesMath';
import { NCT_TYPES_PHYS } from '../src/lib/nctTypesPhys';
import { NCT_TYPES, nctTypesFor, nctTypeName } from '../src/lib/nctTypes';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Число тем в главах банка таджикского языка */
const SIZES: Record<number, number> = { 1: 8, 2: 11, 3: 14, 4: 10, 5: 12, 6: 10 };
const SECTIONS = TAJ_CONFIG.sections.map((s) => s.key);
const SECTIONS_NO_LIT = SECTIONS.filter((s) => s !== 'lit');

const codes = (sec: string, kind: string) => Object.keys(NCT_SLOT_TYPES_TAJ[`${sec}:${kind}`] ?? {}).filter((c) => NCT_TYPE_SECTION_TAJ[c] === sec);

/** Синтетический банк: главы 1–6, в каждой теме по `per` вопросов каждого вида; метки — по разделу темы */
function tajPool(per: { test: number; matching: number; open: number }, labelled = true) {
  const out: any[] = [];
  for (const ch of Object.keys(SIZES).map(Number)) {
    for (let tp = 1; tp <= SIZES[ch]; tp++) {
      const sec = tajTopicSection(ch, tp);
      if (!sec) continue;
      for (const type of ['test', 'matching', 'open'] as const) {
        const list = codes(sec, type);
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

describe('режим НЦТ: таджикский язык — настройки', () => {
  it('карта тем банка: введения глав 1 и 2 и главы 7+ не берутся, остальное — по разделам', () => {
    expect(tajTopicSection(1, 1)).toBeNull();
    expect(tajTopicSection(1, 3)).toBe('phon');
    expect(tajTopicSection(1, 7)).toBe('lex');
    expect(tajTopicSection(2, 1)).toBeNull();
    expect(tajTopicSection(2, 9)).toBe('morph');
    expect(tajTopicSection(3, 14)).toBe('morph');
    expect(tajTopicSection(4, 1)).toBe('synt');
    expect(tajTopicSection(4, 2)).toBe('ibora');
    expect(tajTopicSection(4, 10)).toBe('synt');
    expect(tajTopicSection(5, 1)).toBe('phon');
    expect(tajTopicSection(5, 3)).toBe('phr');
    expect(tajTopicSection(5, 8)).toBe('style');
    expect(tajTopicSection(6, 5)).toBe('phon');
    expect(tajTopicSection(7, 1)).toBeNull();
    expect(tajTopicSection(1, 9)).toBeNull();
    expect(tajTopicSection(1, 0)).toBeNull();
  });

  it('раздел вопроса: метка перекидывает его в раздел своего типа (морфологический разбор из главы 1 — в морфологию)', () => {
    const q: any = { chapter: { order_index: 1 }, topic: { order_index: 7 }, type: 'open', nct_type: null };
    expect(sectionOfQuestion(q, TAJ_CONFIG)).toBe('lex');
    expect(sectionOfQuestion({ ...q, nct_type: 'TAJ_MORPH_AN' }, TAJ_CONFIG)).toBe('morph');
    expect(sectionOfQuestion({ ...q, nct_type: 'TAJ_TEXT_ORDER' }, TAJ_CONFIG)).toBe('synt');
    expect(sectionOfQuestion({ ...q, nct_type: 'TAJ_PICK_MANY' }, TAJ_CONFIG)).toBe('lex');
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 8 } }, TAJ_CONFIG)).toBeNull();
  });

  it('состав 20 + 4 + 2 = 40 баллов, баллы разделов 3 / 2 / 2 / 1 / 12 / 5 / 10 / 5', () => {
    expect(TAJ_CONFIG.sections.reduce((a, s) => a + s.share, 0)).toBe(100);
    expect(sectionPoints(SECTIONS, undefined, TAJ_CONFIG)).toEqual({ phon: 3, lex: 2, phr: 2, style: 1, morph: 12, ibora: 5, synt: 10, lit: 5 });
    expect(TAJ_CONFIG.composition).toEqual({ test: 20, matching: 4, open: 2, points: 40 });
    expect(TAJ_CONFIG.pointsPer).toEqual({ test: 1, matching: 4, open: 2 });
    expect(TAJ_CONFIG.quotaPoints).toBe(0);
    expect(TAJ_CONFIG.openDifficulty.reduce((a, b) => a + b, 0)).toBe(2);
    const sum = (k: 'test' | 'matching' | 'open', i: 0 | 1) => Object.values(TAJ_CONFIG.kindRange!).reduce((a, r) => a + r[k]![i], 0);
    expect(sum('test', 0)).toBeLessThanOrEqual(20); expect(sum('test', 1)).toBeGreaterThanOrEqual(20);
    expect(sum('matching', 0)).toBeLessThanOrEqual(4); expect(sum('matching', 1)).toBeGreaterThanOrEqual(4);
    expect(sum('open', 0)).toBeLessThanOrEqual(2); expect(sum('open', 1)).toBeGreaterThanOrEqual(2);
  });

  it('реестр: профиль taj, настройки по названию и ключу; другие предметы не затронуты', () => {
    expect(nctConfigFor('Таджикский язык')).toBe(TAJ_CONFIG);
    expect(nctConfigByKey('taj')).toBe(TAJ_CONFIG);
    expect(examProfileFor('Таджикский язык')?.key).toBe('taj');
    expect(examProfileFor('Забони тоҷикӣ')?.key).toBe('taj');
    expect(examProfileFor('Таджикский язык')?.sections.map((s) => [s.key, s.share])).toEqual(TAJ_CONFIG.sections.map((s) => [s.key, s.share]));
    expect(examProfileFor('Английский язык')?.key).toBe('english');
    expect(examProfileFor('Право')?.key).toBe('law');
    expect(examProfileFor('История')?.key).toBe('history');
  });

  it('справочник типов: коды TAJ_…, раздел типа и таблица слотов согласованы, коды не пересекаются с другими предметами', () => {
    expect(new Set(NCT_TYPES_TAJ.map((t) => t.code)).size).toBe(NCT_TYPES_TAJ.length);
    for (const t of NCT_TYPES_TAJ) {
      expect(t.code.startsWith('TAJ_')).toBe(true);
      expect(t.code).toMatch(/^[A-Z0-9_]+$/);
      expect(SECTIONS).toContain(t.section);
      if (NCT_TYPE_SECTION_TAJ[t.code]) expect(NCT_TYPE_SECTION_TAJ[t.code]).toBe(t.section);
    }
    const others = new Set([...NCT_TYPES, ...NCT_TYPES_LAW, ...NCT_TYPES_HISTORY, ...NCT_TYPES_MATH, ...NCT_TYPES_ENGLISH, ...NCT_TYPES_BIO, ...NCT_TYPES_PHYS].map((t) => t.code));
    expect(NCT_TYPES_TAJ.filter((t) => others.has(t.code))).toEqual([]);
    for (const [key, list] of Object.entries(NCT_SLOT_TYPES_TAJ)) {
      expect(SECTIONS).toContain(key.split(':')[0]);
      for (const [c, n] of Object.entries(list)) { expect(NCT_TYPE_SECTION_TAJ[c], c).toBeTruthy(); expect(n).toBeGreaterThan(0); expect(n).toBeLessThanOrEqual(42); }
    }
    // №25 — морфологический разбор, №26 — порядок предложений, №23 — синтаксический разбор, №24 — смысл бейтов
    expect(Object.keys(NCT_SLOT_TYPES_TAJ['morph:open'])).toEqual(['TAJ_MORPH_AN']);
    expect(Object.keys(NCT_SLOT_TYPES_TAJ['synt:open'])).toEqual(['TAJ_TEXT_ORDER']);
    expect(Object.keys(NCT_SLOT_TYPES_TAJ['synt:matching'])).toEqual(['TAJ_SYNT_AN']);
    expect(Object.keys(NCT_SLOT_TYPES_TAJ['lit:matching'])).toEqual(['TAJ_BAYT_MEAN']);
    expect(nctTypesFor('Таджикский язык')).toBe(NCT_TYPES_TAJ);
    expect(nctTypesFor()).toEqual(expect.arrayContaining(NCT_TYPES_TAJ));
    expect(nctTypeName('TAJ_MORPH_AN')).not.toBe('TAJ_MORPH_AN');
  });
});

describe('режим НЦТ: таджикский язык — подбор билета', () => {
  const per = { test: 12, matching: 6, open: 8 };

  it('в банке нет литературы: билет 20 + 4 + 2 по семи разделам, тесты первых четырёх разделов — 3 / 2 / 2 / 1', () => {
    for (const T of [1, 2, 4]) {
      for (let seed = 1; seed <= 8; seed++) {
        const r = pickNct(tajPool(per), T, rng(seed), undefined, undefined, TAJ_CONFIG);
        expect(r.kinds.map((k) => k[0].length), `T ${T} seed ${seed}`).toEqual([20, 4, 2]);
        expect([...r.sections].sort()).toEqual([...SECTIONS_NO_LIT].sort());
        const want: Record<string, number> = { phon: 3, lex: 2, phr: 2, style: 1 };
        for (const s of Object.keys(want)) {
          expect(r.plan[s].test).toBe(want[s]);
          expect(r.plan[s].matching + r.plan[s].open).toBe(0);
        }
      }
    }
  });

  it('открытые — по одному в морфологии (разбор) и в синтаксисе (порядок предложений); соответствия — в морфологии, ибора и синтаксисе', () => {
    for (const seed of [3, 5, 9, 11]) {
      const r = pickNct(tajPool(per), 2, rng(seed), undefined, undefined, TAJ_CONFIG);
      const [, matching, open] = r.kinds.map((k) => k[0]);
      expect(open.map((q) => q.nct_type)).toEqual(['TAJ_MORPH_AN', 'TAJ_TEXT_ORDER']);
      expect(open.map((q) => sectionOfQuestion(q, TAJ_CONFIG))).toEqual(['morph', 'synt']);
      for (const q of matching) expect(['morph', 'ibora', 'synt']).toContain(sectionOfQuestion(q, TAJ_CONFIG));
      expect(matching.some((q) => sectionOfQuestion(q, TAJ_CONFIG) === 'ibora')).toBe(true);
      expect(matching.some((q) => sectionOfQuestion(q, TAJ_CONFIG) === 'synt')).toBe(true);
    }
  });

  it('блоки разделов идут в порядке НЦТ; баллы билета = 40; вопросы не повторяются; один тип на месте во всех вариантах', () => {
    for (const seed of [2, 6, 10]) {
      const r = pickNct(tajPool(per), 3, rng(seed), undefined, undefined, TAJ_CONFIG);
      const [tests, matching, open] = r.kinds.map((k) => k[0]);
      expect(tests.length + 4 * matching.length + 2 * open.length).toBe(40);
      const idx = tests.map((q) => SECTIONS.indexOf(sectionOfQuestion(q, TAJ_CONFIG)!));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
      const ids = r.kinds.flatMap((k) => k.flat()).map((q) => q.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const byTicket of r.kinds) for (let t = 1; t < 3; t++) expect(byTicket[t].map((q) => q.nct_type)).toEqual(byTicket[0].map((q) => q.nct_type));
    }
  });

  it('банк без меток тоже даёт полный билет', () => {
    const r = pickNct(tajPool(per, false), 2, rng(2), undefined, undefined, TAJ_CONFIG);
    expect(r.kinds.map((k) => k[0].length)).toEqual([20, 4, 2]);
  });

  it('выбрана часть тем — ограничения полного экзамена не мешают подбору', () => {
    const only = tajPool(per).filter((q) => q.chapter.order_index === 3);
    const r = pickNct(only, 2, rng(4), undefined, undefined, TAJ_CONFIG);
    expect(r.kinds.map((k) => k[0].length)).toEqual([20, 4, 2]);
    expect(r.sections).toEqual(['morph']);
  });

  it('если литература появится в банке, она занимает №20 и №24', () => {
    const have = Object.fromEntries(SECTIONS.map((s) => [s, { test: 50, matching: 20, open: 20 }]));
    const plan = planNct(SECTIONS, have, 2, rng(1), TAJ_CONFIG)!;
    expect(plan.lit).toEqual({ test: 1, matching: 1, open: 0 });
    const total = Object.values(plan).reduce((a, p) => ({ test: a.test + p.test, matching: a.matching + p.matching, open: a.open + p.open }), { test: 0, matching: 0, open: 0 });
    expect(total).toEqual({ test: 20, matching: 4, open: 2 });
  });
});
