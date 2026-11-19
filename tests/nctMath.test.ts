import { describe, expect, it } from 'vitest';
import { CHEM_CONFIG, pickNct, planNct, sectionOfQuestion, sectionPoints } from '../supabase/functions/_shared/nct';
import { MATH_CONFIG, mathTopicNumber } from '../supabase/functions/_shared/nctMath';
import { nctConfigByKey, nctConfigFor } from '../supabase/functions/_shared/nctConfigs';
import { examProfileFor } from '../supabase/functions/_shared/examProfiles';
import { NCT_SLOT_TYPES_MATH, NCT_TYPE_SECTION_MATH } from '../supabase/functions/_shared/nctSlotsMath';
import { NCT_TYPES_MATH } from '../src/lib/nctTypesMath';
import { nctTypesFor, nctTypeName } from '../src/lib/nctTypes';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZES: Record<number, number> = { 1: 11, 2: 8, 3: 5, 4: 9 };
const ALL = ['arith', 'alg', 'func', 'trig', 'anal', 'geo'];

/** Банк математики: главы 1–4; на каждый тип слота по `per` вопросов (метка типа сама переносит вопрос в раздел типа) */
function mathPool(per: number) {
  const out: any[] = [];
  let n = 0;
  for (const [key, codes] of Object.entries(NCT_SLOT_TYPES_MATH)) {
    const kind = key.split(':')[1];
    for (const code of Object.keys(codes)) {
      for (let i = 0; i < per; i++, n++) {
        const ch = (n % 4) + 1, tp = (Math.floor(n / 4) % SIZES[ch]) + 1;
        out.push({ id: `${code}-${i}`, type: kind, topic_id: `t${ch}.${tp}`, chapter_id: `c${ch}`, chapter: { order_index: ch }, topic: { order_index: tp }, nct_type: code });
      }
    }
  }
  return out;
}

/** Банк без меток: только главы 1–4 (разделы «Арифметика» и «Алгебра») */
function plainPool(per: { test: number; matching: number; open: number }) {
  const out: any[] = [];
  for (const ch of [1, 2, 3, 4]) {
    for (let tp = 1; tp <= SIZES[ch]; tp++) {
      for (const type of ['test', 'matching', 'open'] as const) {
        for (let i = 1; i <= per[type]; i++) {
          out.push({ id: `${type}-${ch}-${tp}-${i}`, type, topic_id: `t${ch}.${tp}`, chapter_id: `c${ch}`, chapter: { order_index: ch }, topic: { order_index: tp }, nct_type: null });
        }
      }
    }
  }
  return out;
}

describe('режим НЦТ: математика — карта тем и состав', () => {
  it('сквозные номера тем 1–57, остальное вне режима', () => {
    expect(mathTopicNumber(1, 1)).toBe(1);
    expect(mathTopicNumber(1, 11)).toBe(11);
    expect(mathTopicNumber(2, 1)).toBe(12);
    expect(mathTopicNumber(2, 8)).toBe(19);
    expect(mathTopicNumber(3, 1)).toBe(20);
    expect(mathTopicNumber(3, 5)).toBe(24);
    expect(mathTopicNumber(4, 1)).toBe(25);
    expect(mathTopicNumber(4, 9)).toBe(33);
    expect(mathTopicNumber(4, 10)).toBeNull();
    expect(mathTopicNumber(5, 1)).toBe(34);
    expect(mathTopicNumber(5, 5)).toBe(38);
    expect(mathTopicNumber(6, 1)).toBe(39);
    expect(mathTopicNumber(7, 4)).toBe(46);
    expect(mathTopicNumber(8, 1)).toBe(47);
    expect(mathTopicNumber(8, 11)).toBe(57);
    expect(mathTopicNumber(8, 12)).toBeNull();
    expect(mathTopicNumber(9, 1)).toBeNull();
    expect(mathTopicNumber(0, 1)).toBeNull();
  });

  it('раздел темы: главы 1–2 и §9 гл. 4 — арифметика, гл. 3 и §1–8 гл. 4 — алгебра, гл. 5–8 — функция, тригонометрия, анализ, геометрия', () => {
    const sec = (c: number, t: number) => MATH_CONFIG.topicSection(c, t);
    expect([sec(1, 1), sec(2, 8)]).toEqual(['arith', 'arith']);
    expect([sec(3, 1), sec(3, 5), sec(4, 1), sec(4, 8)]).toEqual(['alg', 'alg', 'alg', 'alg']);
    expect(sec(4, 9)).toBe('arith');
    expect([sec(5, 1), sec(6, 4), sec(7, 2), sec(8, 11)]).toEqual(['func', 'trig', 'anal', 'geo']);
    expect([sec(9, 1), sec(1, 12), sec(4, 10), sec(8, 12)]).toEqual([null, null, null, null]);
  });

  it('размеченное задание идёт в раздел своего типа; тема вне режима остаётся вне', () => {
    const q = { chapter: { order_index: 1 }, topic: { order_index: 3 }, nct_type: 'DERIV_CALC' };
    expect(sectionOfQuestion(q, MATH_CONFIG)).toBe('anal');
    expect(sectionOfQuestion({ ...q, nct_type: 'TRIG_VAL' }, MATH_CONFIG)).toBe('trig');
    expect(sectionOfQuestion({ ...q, nct_type: 'LINFUNC' }, MATH_CONFIG)).toBe('func');
    expect(sectionOfQuestion({ ...q, nct_type: 'PLAN_LEN' }, MATH_CONFIG)).toBe('geo');
    expect(sectionOfQuestion({ ...q, nct_type: 'O_PLAN_LEN' }, MATH_CONFIG)).toBe('geo');
    expect(sectionOfQuestion({ ...q, nct_type: null }, MATH_CONFIG)).toBe('arith');
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 4 }, nct_type: null }, MATH_CONFIG)).toBe('alg');
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 9 } }, MATH_CONFIG)).toBeNull();
    expect(sectionOfQuestion({ ...q, nct_type: 'НЕТ_ТАКОГО' }, MATH_CONFIG)).toBe('arith');
  });

  it('формат 18 + 2 + 7, 40 баллов; доли разделов дают 40; химия не изменилась', () => {
    expect(MATH_CONFIG.composition).toEqual({ test: 18, matching: 2, open: 7, points: 40 });
    expect(MATH_CONFIG.pointsPer).toEqual({ test: 1, matching: 4, open: 2 });
    expect(MATH_CONFIG.sections.reduce((a, s) => a + s.share, 0)).toBe(100);
    const p = sectionPoints(ALL, undefined, MATH_CONFIG);
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBe(40);
    const p2 = sectionPoints(['arith', 'alg'], undefined, MATH_CONFIG);
    expect(Object.values(p2).reduce((a, b) => a + b, 0)).toBe(40);
    expect(CHEM_CONFIG.composition).toEqual({ test: 18, matching: 2, open: 7, points: 40 });
  });

  it('предмет выбирает свои настройки', () => {
    expect(nctConfigFor('Математика')?.key).toBe('math');
    expect(nctConfigFor('Риёзиёт')?.key).toBe('math');
    expect(examProfileFor('Математика')?.key).toBe('math');
    expect(nctConfigFor('Химия')?.key).toBe('chemistry');
    expect(nctConfigFor('Право')?.key).toBe('law');
    expect(nctConfigFor('Физика')).toBeNull();
    expect(nctConfigByKey('math')).toBe(MATH_CONFIG);
    expect(nctConfigByKey(undefined)).toBe(CHEM_CONFIG);
  });

  it('профиль и конфиг согласованы (разделы, доли, состав)', () => {
    const p = examProfileFor('Математика')!;
    expect(p.sections).toEqual(MATH_CONFIG.sections);
    expect(p.composition).toEqual(MATH_CONFIG.composition);
    expect(p.pointsPer).toEqual(MATH_CONFIG.pointsPer);
  });

  it('справочник типов: 56 типов, таблица слотов и раздел каждого типа согласованы', () => {
    expect(NCT_TYPES_MATH.length).toBe(56);
    expect(new Set(NCT_TYPES_MATH.map((t) => t.code)).size).toBe(56);
    for (const t of NCT_TYPES_MATH) expect(NCT_TYPE_SECTION_MATH[t.code]).toBe(t.section);
    for (const [key, codes] of Object.entries(NCT_SLOT_TYPES_MATH)) {
      for (const c of Object.keys(codes)) expect(NCT_TYPE_SECTION_MATH[c]).toBe(key.split(':')[0]);
    }
    const inSlots = new Set(Object.values(NCT_SLOT_TYPES_MATH).flatMap((c) => Object.keys(c)));
    expect(inSlots).toEqual(new Set(NCT_TYPES_MATH.map((t) => t.code)));
    expect(nctTypesFor('Математика')).toBe(NCT_TYPES_MATH);
    expect(nctTypeName('PROG_AP')).toContain('Арифметическая прогрессия');
    expect(nctTypeName('BOND')).toBe('Вид химической связи');
  });
});

describe('режим НЦТ: математика — подбор билета', () => {
  it('план 18 + 2 + 7 на шести разделах и только на «Арифметика + Алгебра»', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const big = { test: 80, matching: 20, open: 30 };
      for (const present of [ALL, ['arith', 'alg']]) {
        const have = Object.fromEntries(present.map((k) => [k, big]));
        const plan = planNct(present, have, 4, rng(seed), MATH_CONFIG)!;
        expect(plan).toBeTruthy();
        const sum = (k: 'test' | 'matching' | 'open') => Object.values(plan).reduce((a, p) => a + p[k], 0);
        expect([sum('test'), sum('matching'), sum('open')]).toEqual([18, 2, 7]);
      }
    }
  });

  it('билет на 1, 2 и 4 варианта: состав, один тип на месте, тип не чаще 4 раз, вопросы не повторяются', () => {
    for (const T of [1, 2, 4]) {
      for (let seed = 1; seed <= 6; seed++) {
        const r = pickNct(mathPool(4 * T + 1), T, rng(seed), undefined, undefined, MATH_CONFIG);
        expect(r.kinds.map((k) => k[0].length)).toEqual([18, 2, 7]);
        for (const byTicket of r.kinds) {
          for (let t = 1; t < T; t++) {
            expect(byTicket[t].map((q) => q.nct_type)).toEqual(byTicket[0].map((q) => q.nct_type));
          }
        }
        const codes = r.kinds.flatMap((k) => k[0]).map((q) => q.nct_type).filter(Boolean);
        const cnt = new Map<string, number>();
        for (const c of codes) cnt.set(c, (cnt.get(c) ?? 0) + 1);
        expect(Math.max(...cnt.values())).toBeLessThanOrEqual(4);
        const ids = r.kinds.flatMap((k) => k.flat()).map((q) => q.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(r.kinds[0][0].length + 4 * r.kinds[1][0].length + 2 * r.kinds[2][0].length).toBe(40);
      }
    }
  });

  it('блоки разделов идут по порядку конфига', () => {
    const order = MATH_CONFIG.sections.map((s) => s.key);
    const r = pickNct(mathPool(9), 2, rng(9), undefined, undefined, MATH_CONFIG);
    const idx = r.kinds[0][0].map((q) => order.indexOf(sectionOfQuestion(q, MATH_CONFIG)!));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('банк без меток (главы 1–4) тоже даёт полный билет', () => {
    for (const T of [1, 2, 4]) {
      const r = pickNct(plainPool({ test: 6, matching: 3, open: 3 }), T, rng(2), undefined, undefined, MATH_CONFIG);
      expect(r.kinds.map((k) => k[0].length)).toEqual([18, 2, 7]);
      const secs = new Set(r.kinds.flatMap((k) => k[0]).map((q) => sectionOfQuestion(q, MATH_CONFIG)));
      expect([...secs].every((s) => s === 'arith' || s === 'alg')).toBe(true);
    }
  });

  it('вопросы тем вне глав 1–8 в билет не берутся', () => {
    const pool = [...plainPool({ test: 6, matching: 3, open: 3 }), { id: 'x1', type: 'test', topic_id: 'tx', chapter_id: 'c9', chapter: { order_index: 9 }, topic: { order_index: 1 }, nct_type: null }];
    const r = pickNct(pool, 1, rng(4), undefined, undefined, MATH_CONFIG);
    expect(r.kinds.flatMap((k) => k.flat()).some((q) => q.id === 'x1')).toBe(false);
    expect(r.notes.join(' ')).toContain('вне глав 1–8');
  });
});

describe('режим НЦТ: математика — шесть официальных разделов', () => {
  it('доли 18/21/13/13/17/18 и порядок разделов', () => {
    expect(MATH_CONFIG.sections.map((s) => [s.key, s.share])).toEqual([['arith', 18], ['alg', 21], ['func', 13], ['trig', 13], ['anal', 17], ['geo', 18]]);
    const p = sectionPoints(ALL, undefined, MATH_CONFIG);
    for (const s of MATH_CONFIG.sections) expect(Math.abs(p[s.key] - (40 * s.share) / 100)).toBeLessThanOrEqual(1);
  });

  it('билет из размеченного банка содержит задания всех шести разделов', () => {
    const r = pickNct(mathPool(9), 2, rng(5), undefined, undefined, MATH_CONFIG);
    const secs = new Set(r.kinds.flatMap((k) => k[0]).map((q) => sectionOfQuestion(q, MATH_CONFIG)));
    expect([...secs].sort()).toEqual([...ALL].sort());
  });
});
