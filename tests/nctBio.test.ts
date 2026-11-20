import { describe, expect, it } from 'vitest';
import { CHEM_CONFIG, pickNct, planNct, sectionOfQuestion, sectionPoints } from '../supabase/functions/_shared/nct';
import { BIO_CONFIG, bioTopicSection } from '../supabase/functions/_shared/nctBio';
import { HISTORY_CONFIG } from '../supabase/functions/_shared/nctHistory';
import { LAW_CONFIG } from '../supabase/functions/_shared/nctLaw';
import { nctConfigByKey, nctConfigFor } from '../supabase/functions/_shared/nctConfigs';
import { examProfileFor } from '../supabase/functions/_shared/examProfiles';
import { NCT_SLOT_TYPES_BIO, NCT_TYPE_SECTION_BIO } from '../supabase/functions/_shared/nctSlotsBio';
import { NCT_TYPES_BIO } from '../src/lib/nctTypesBio';
import { nctTypesFor, nctTypeName } from '../src/lib/nctTypes';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Число тем в главах банка биологии */
const SIZES: Record<number, number> = { 1: 13, 2: 10, 3: 21, 4: 20, 5: 16 };
const SECTIONS = BIO_CONFIG.sections.map((s) => s.key);

/** Коды типов раздела и вида, которые относятся именно к этому разделу (метка не «перекинет» вопрос в другой раздел) */
const codes = (sec: string, kind: string) => Object.keys(NCT_SLOT_TYPES_BIO[`${sec}:${kind}`] ?? {}).filter((c) => NCT_TYPE_SECTION_BIO[c] === sec);

/**
 * Синтетический банк биологии: 5 глав, у каждой темы по `per` вопросов каждого вида.
 * Метки типов — по разделу темы (раздача по кругу); открытые размечены только в общей биологии, в остальных разделах — без меток.
 */
function bioPool(per: { test: number; matching: number; open: number }, labelled = true) {
  const out: any[] = [];
  for (const ch of [1, 2, 3, 4, 5]) {
    for (let tp = 1; tp <= SIZES[ch]; tp++) {
      const sec = bioTopicSection(ch, tp)!;
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

describe('режим НЦТ: биология — карта тем и настройки', () => {
  it('глава банка → раздел: границы 2.7/2.8, 4.2/4.3, главы 6+ и темы вне глав пропускаются', () => {
    const sec = (c: number, t: number) => BIO_CONFIG.topicSection(c, t);
    expect([sec(1, 1), sec(1, 13), sec(2, 1), sec(2, 7)]).toEqual(['gen', 'gen', 'gen', 'gen']);
    expect([sec(2, 8), sec(2, 10)]).toEqual(['eco', 'eco']);
    expect([sec(3, 1), sec(3, 21)]).toEqual(['anat', 'anat']);
    expect([sec(4, 1), sec(4, 2)]).toEqual(['bot', 'bot']);
    expect([sec(4, 3), sec(4, 20)]).toEqual(['zoo', 'zoo']);
    expect([sec(5, 1), sec(5, 16)]).toEqual(['bot', 'bot']);
    expect([sec(1, 14), sec(2, 11), sec(3, 22), sec(4, 21), sec(5, 17), sec(6, 1), sec(0, 1), sec(1, 0), sec(1, NaN)]).toEqual(Array(9).fill(null));
  });

  it('раздел задания: по теме; метка типа переводит в раздел типа; тема вне режима даёт null при любой метке', () => {
    const q = { chapter: { order_index: 4 }, topic: { order_index: 5 }, nct_type: 'BIO_Z_PROT' };
    expect(sectionOfQuestion(q, BIO_CONFIG)).toBe('zoo');
    expect(sectionOfQuestion({ ...q, nct_type: null }, BIO_CONFIG)).toBe('zoo');
    expect(sectionOfQuestion({ ...q, nct_type: 'НЕТ_ТАКОГО' }, BIO_CONFIG)).toBe('zoo');
    // вирусы (гл. 4, тема 1) — ботаника; метка зоологии перекинула бы в зоологию
    expect(sectionOfQuestion({ ...q, topic: { order_index: 1 }, nct_type: null }, BIO_CONFIG)).toBe('bot');
    expect(sectionOfQuestion({ ...q, topic: { order_index: 1 }, nct_type: 'BIO_B_MIC' }, BIO_CONFIG)).toBe('bot');
    // гормоны лежат в анатомии, соответствие по гормонам — анатомия; задание по экологии в общей теме — экология
    expect(sectionOfQuestion({ chapter: { order_index: 3 }, topic: { order_index: 9 }, nct_type: 'BIO_M_HORM' }, BIO_CONFIG)).toBe('anat');
    expect(sectionOfQuestion({ chapter: { order_index: 1 }, topic: { order_index: 2 }, nct_type: 'BIO_ECO' }, BIO_CONFIG)).toBe('eco');
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 6 } }, BIO_CONFIG)).toBeNull();
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 6 }, nct_type: 'BIO_ECO' }, BIO_CONFIG)).toBeNull();
  });

  it('доли разделов дают 100, баллы раздела — 13 / 9 / 8 / 5 / 5 = 40; химия, право и история не изменились', () => {
    expect(BIO_CONFIG.sections.reduce((a, s) => a + s.share, 0)).toBe(100);
    expect(sectionPoints(SECTIONS, undefined, BIO_CONFIG)).toEqual({ gen: 13, bot: 9, zoo: 8, anat: 5, eco: 5 });
    expect(BIO_CONFIG.composition).toEqual({ test: 20, matching: 4, open: 2, points: 40 });
    expect(BIO_CONFIG.pointsPer).toEqual({ test: 1, matching: 4, open: 2 });
    expect(BIO_CONFIG.quotaPoints).toBe(0);
    expect(BIO_CONFIG.openDifficulty.reduce((a, b) => a + b, 0)).toBe(2);
    expect(CHEM_CONFIG.composition).toEqual({ test: 18, matching: 2, open: 7, points: 40 });
    expect(CHEM_CONFIG.maxTypeUse).toBeUndefined();
    expect(CHEM_CONFIG.uiNote).toBeUndefined();
    expect(LAW_CONFIG.maxTypeUse).toBeUndefined();
    expect(HISTORY_CONFIG.maxTypeUse).toBe(2);
  });

  it('профиль и настройки выбираются по названию; «биол» не пересекается с другими предметами', () => {
    expect(nctConfigFor('Биология')).toBe(BIO_CONFIG);
    expect(nctConfigFor('биология')).toBe(BIO_CONFIG);
    expect(nctConfigByKey('biology')).toBe(BIO_CONFIG);
    expect(examProfileFor('Биология')?.key).toBe('biology');
    expect(examProfileFor('Биология')?.sections.map((s) => [s.key, s.share])).toEqual(BIO_CONFIG.sections.map((s) => [s.key, s.share]));
    expect(nctConfigFor('Химия')?.key).toBe('chemistry');
    expect(nctConfigFor('Право')?.key).toBe('law');
    expect(nctConfigFor('История')?.key).toBe('history');
    expect(nctConfigFor('Математика')?.key).toBe('math');
    expect(nctConfigFor('Английский язык')?.key).toBe('english');
    expect(nctConfigFor('Физика')?.key).toBe('physics');
    expect(nctConfigFor('Таджикский язык')?.key).toBe('taj');
    expect(nctConfigByKey(undefined)).toBe(CHEM_CONFIG);
  });

  it('справочник типов: коды BIO_…, раздел типа и таблица слотов согласованы', () => {
    expect(NCT_TYPES_BIO.length).toBeGreaterThan(40);
    expect(new Set(NCT_TYPES_BIO.map((t) => t.code)).size).toBe(NCT_TYPES_BIO.length);
    for (const t of NCT_TYPES_BIO) {
      expect(t.code.startsWith('BIO_')).toBe(true);
      expect(NCT_TYPE_SECTION_BIO[t.code]).toBe(t.section);
      expect(SECTIONS).toContain(t.section);
    }
    for (const [key, list] of Object.entries(NCT_SLOT_TYPES_BIO)) {
      expect(SECTIONS).toContain(key.split(':')[0]);
      for (const c of Object.keys(list)) expect(NCT_TYPE_SECTION_BIO[c], c).toBeTruthy();
    }
    expect(nctTypesFor('Биология')).toBe(NCT_TYPES_BIO);
    expect(nctTypesFor('Химия')).not.toBe(NCT_TYPES_BIO);
    expect(nctTypesFor()).toEqual(expect.arrayContaining(NCT_TYPES_BIO));
    expect(nctTypeName('BIO_ECO')).not.toBe('BIO_ECO');
    expect(nctTypeName('BOND')).toBe('Вид химической связи');
  });
});

describe('режим НЦТ: биология — подбор билета', () => {
  const per = { test: 6, matching: 3, open: 3 };

  it('план 20 тестов + 4 соответствия + 2 открытых: как в билетах — 5/5/4/5/1 тестов, открытые на общей биологии', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const mk = (m: number, o: number) => ({ test: 200, matching: m, open: o });
      const have = { gen: mk(40, 30), bot: mk(30, 0), zoo: mk(30, 0), anat: mk(20, 0), eco: mk(20, 0) };
      const plan = planNct(SECTIONS, have, 4, rng(seed), BIO_CONFIG)!;
      expect(plan).toBeTruthy();
      const sum = (k: 'test' | 'matching' | 'open') => Object.values(plan).reduce((a, p) => a + p[k], 0);
      expect([sum('test'), sum('matching'), sum('open')]).toEqual([20, 4, 2]);
      expect(plan).toEqual({
        gen: { test: 5, matching: 1, open: 2 }, bot: { test: 5, matching: 1, open: 0 }, zoo: { test: 4, matching: 1, open: 0 },
        anat: { test: 5, matching: 0, open: 0 }, eco: { test: 1, matching: 1, open: 0 },
      });
    }
  });

  it('билет на 1, 2 и 4 варианта: состав, один тип на месте, тип не более 2 раз, вопросы не повторяются', () => {
    for (const T of [1, 2, 4]) {
      for (let seed = 1; seed <= 6; seed++) {
        const r = pickNct(bioPool(per), T, rng(seed), undefined, undefined, BIO_CONFIG);
        expect(r.kinds.map((k) => k[0].length)).toEqual([20, 4, 2]);
        for (const byTicket of r.kinds) {
          for (let t = 1; t < T; t++) {
            expect(byTicket[t].map((q) => q.nct_type)).toEqual(byTicket[0].map((q) => q.nct_type));
          }
        }
        const cnt = new Map<string, number>();
        for (const q of r.kinds.flatMap((k) => k[0])) if (q.nct_type) cnt.set(q.nct_type, (cnt.get(q.nct_type) ?? 0) + 1);
        for (const [c, n] of cnt) expect(n, `${c} seed ${seed}`).toBeLessThanOrEqual(BIO_CONFIG.maxTypeUse!);
        const ids = r.kinds.flatMap((k) => k.flat()).map((q) => q.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('блоки разделов по порядку (общая, ботаника, зоология, анатомия, экология); №20 — экология, единственный тест раздела', () => {
    for (const seed of [3, 5, 9, 11]) {
      const r = pickNct(bioPool(per), 2, rng(seed), undefined, undefined, BIO_CONFIG);
      const tests = r.kinds[0][0];
      const secs = tests.map((q) => sectionOfQuestion(q, BIO_CONFIG)!);
      const idx = secs.map((s) => SECTIONS.indexOf(s));
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      expect(secs.filter((s) => s === 'eco').length).toBe(1);
      expect(secs[19]).toBe('eco');
      expect(secs.slice(0, 5)).toEqual(Array(5).fill('gen'));
      expect(secs.slice(5, 10)).toEqual(Array(5).fill('bot'));
      expect(secs.slice(10, 14)).toEqual(Array(4).fill('zoo'));
      expect(secs.slice(14, 19)).toEqual(Array(5).fill('anat'));
      // у экологического теста метка — BIO_ECO (единственный тип раздела)
      expect(tests[19].nct_type).toBe('BIO_ECO');
    }
  });

  it('баллы билета = 40; открытые — только из общей биологии, соответствия — по одному в общую, ботанику, зоологию и экологию', () => {
    for (const seed of [2, 6, 10]) {
      const r = pickNct(bioPool(per), 2, rng(seed), undefined, undefined, BIO_CONFIG);
      const [tests, matching, open] = r.kinds.map((k) => k[0]);
      expect(tests.length + 4 * matching.length + 2 * open.length).toBe(40);
      expect(open.every((q) => sectionOfQuestion(q, BIO_CONFIG) === 'gen')).toBe(true);
      expect(open.every((q) => ['BIO_O_PIC', 'BIO_O_DNA', 'BIO_O_GEN', 'BIO_O_LIST'].includes(q.nct_type))).toBe(true);
      expect(matching.map((q) => sectionOfQuestion(q, BIO_CONFIG))).toEqual(['gen', 'bot', 'zoo', 'eco']);
    }
  });

  it('при выборе одной главы (4 — ботаника и зоология) билет собирается полностью, ограничения полного экзамена снимаются', () => {
    const ch4 = bioPool(per).filter((q) => q.chapter.order_index === 4);
    const r = pickNct(ch4, 2, rng(42), undefined, undefined, BIO_CONFIG);
    expect(r.kinds.map((k) => k[0].length)).toEqual([20, 4, 2]);
    expect(r.sections.sort()).toEqual(['bot', 'zoo']);
  });

  it('банк без меток тоже даёт полный билет', () => {
    const r = pickNct(bioPool(per, false), 2, rng(2), undefined, undefined, BIO_CONFIG);
    expect(r.kinds.map((k) => k[0].length)).toEqual([20, 4, 2]);
  });

  it('вопросы тем вне режима в билет не берутся', () => {
    const pool = [...bioPool(per), { id: 'x1', type: 'test', topic_id: 'tx', chapter_id: 'c6', chapter: { order_index: 6 }, topic: { order_index: 1 }, nct_type: null },
      { id: 'x2', type: 'test', topic_id: 'ty', chapter_id: 'c2', chapter: { order_index: 2 }, topic: { order_index: 11 }, nct_type: null }];
    const r = pickNct(pool, 1, rng(4), undefined, undefined, BIO_CONFIG);
    const ids = r.kinds.flatMap((k) => k.flat()).map((q) => q.id);
    expect(ids.includes('x1') || ids.includes('x2')).toBe(false);
    expect(r.notes.join(' ')).toContain('вне глав 1–5');
  });
});
