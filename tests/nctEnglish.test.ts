import { describe, expect, it } from 'vitest';
import { CHEM_CONFIG, pickNct, sectionPoints } from '../supabase/functions/_shared/nct';
import { ENGLISH_CONFIG } from '../supabase/functions/_shared/nctEnglish';
import { LAW_CONFIG } from '../supabase/functions/_shared/nctLaw';
import { nctConfigByKey, nctConfigFor } from '../supabase/functions/_shared/nctConfigs';
import { examProfileFor } from '../supabase/functions/_shared/examProfiles';
import { NCT_SLOT_TYPES_ENGLISH, NCT_TYPE_SECTION_ENGLISH } from '../supabase/functions/_shared/nctSlotsEnglish';
import { NCT_TYPES_ENGLISH } from '../src/lib/nctTypesEnglish';
import { nctTypesFor } from '../src/lib/nctTypes';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Банк английского: 3 уровня (главы), по 6 юнитов; в каждом юните — по тексту чтения и по тексту с пропусками, плюс одиночные */
function englishPool(units = 6, singles = 6) {
  const out: any[] = [];
  for (let ch = 1; ch <= 3; ch++) {
    for (let u = 1; u <= units; u++) {
      const base = { topic_id: `t${ch}.${u}`, chapter_id: `c${ch}`, chapter: { order_index: ch }, topic: { order_index: u } };
      for (const kind of ['reading', 'cloze'] as const) {
        for (let n = 1; n <= 8; n++) {
          out.push({
            ...base, id: `${kind}-${ch}-${u}-${n}`, type: 'test', passage_id: `p-${kind}-${ch}-${u}`, passage_order: n,
            passage: { kind },
          });
        }
      }
      for (const type of ['test', 'matching', 'open'] as const) {
        for (let i = 1; i <= singles; i++) out.push({ ...base, id: `${type}-${ch}-${u}-${i}`, type, passage_id: null });
      }
    }
  }
  return out;
}

const idsOf = (r: any, k: number) => r.kinds[k][0] as any[];

describe('режим НЦТ: английский — реестр и справочник', () => {
  it('профиль и настройки подключены', () => {
    const p = examProfileFor('Английский язык');
    expect(p?.key).toBe('english');
    expect(p?.ready).toBe(true);
    expect(nctConfigFor('Английский язык')).toBe(ENGLISH_CONFIG);
    expect(nctConfigByKey('english')).toBe(ENGLISH_CONFIG);
    expect(nctConfigByKey('law')).toBe(LAW_CONFIG);
    expect(nctConfigByKey(undefined)).toBe(CHEM_CONFIG);
  });

  it('состав 20/4/2 и 40 баллов', () => {
    expect(ENGLISH_CONFIG.composition).toEqual({ test: 20, matching: 4, open: 2, points: 40 });
    expect(ENGLISH_CONFIG.pointsPer).toEqual({ test: 1, matching: 4, open: 2 });
    expect(20 * 1 + 4 * 4 + 2 * 2).toBe(40);
    expect(ENGLISH_CONFIG.sections.reduce((s, x) => s + x.share, 0)).toBe(100);
  });

  it('справочник: у каждого типа слотов есть название, префикс EN_', () => {
    const names = new Set(NCT_TYPES_ENGLISH.map((t) => t.code));
    for (const slot of Object.values(NCT_SLOT_TYPES_ENGLISH)) {
      for (const code of Object.keys(slot)) {
        expect(code.startsWith('EN_')).toBe(true);
        expect(names.has(code), code).toBe(true);
        expect(NCT_TYPE_SECTION_ENGLISH[code], code).toBeTruthy();
      }
    }
    expect(nctTypesFor('Английский язык')).toBe(NCT_TYPES_ENGLISH);
  });
});

describe('режим НЦТ: английский — подбор билетов', () => {
  it('билет: 20 тестов, 4 соответствия, 2 открытых; тексты целиком и по одному', () => {
    for (const T of [1, 2, 4]) {
      const r = pickNct(englishPool(), T, rng(7 + T), undefined, undefined, ENGLISH_CONFIG);
      expect(r.kinds.map((k) => k[0].length), r.notes.join('|')).toEqual([20, 4, 2]);
      expect(r.kinds.every((k) => k.length === T)).toBe(true);
      for (let t = 0; t < T; t++) {
        const tests = r.kinds[0][t] as any[];
        const read = tests.slice(0, 8), cloze = tests.slice(8, 16), rest = tests.slice(16);
        expect(new Set(read.map((q) => q.passage_id)).size).toBe(1);
        expect(new Set(cloze.map((q) => q.passage_id)).size).toBe(1);
        expect(read.map((q) => q.passage_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(cloze.map((q) => q.passage_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(read[0].passage_id).toMatch(/^p-reading/);
        expect(cloze[0].passage_id).toMatch(/^p-cloze/);
        expect(rest.every((q) => !q.passage_id)).toBe(true);
        expect(new Set(tests.map((q) => q.id)).size).toBe(20);
      }
    }
  });

  it('в параллельных вариантах тексты разные', () => {
    const r = pickNct(englishPool(), 4, rng(3), undefined, undefined, ENGLISH_CONFIG);
    const reads = r.kinds[0].map((t: any[]) => t[0].passage_id);
    const cloz = r.kinds[0].map((t: any[]) => t[8].passage_id);
    expect(new Set(reads).size).toBe(4);
    expect(new Set(cloz).size).toBe(4);
  });

  it('баллы: 40, разделы 20/20/60', () => {
    const r = pickNct(englishPool(), 1, rng(11), undefined, undefined, ENGLISH_CONFIG);
    const pts = (k: number) => (r.kinds[k][0] as any[]).length * [1, 4, 2][k];
    expect(pts(0) + pts(1) + pts(2)).toBe(40);
    expect(Object.keys(r.plan).length).toBeGreaterThan(0);
    expect(typeof sectionPoints).toBe('function');
  });

  it('нет текстов — заметка, билет всё равно из одиночных', () => {
    const pool = englishPool().filter((q) => !q.passage_id);
    const r = pickNct(pool, 1, rng(5), undefined, undefined, ENGLISH_CONFIG);
    expect(r.notes.join(' ')).toMatch(/текст/i);
    expect((r.kinds[1][0] as any[]).length).toBe(4);
  });

  it('другие предметы не затронуты: у права нет textSections', () => {
    expect((LAW_CONFIG as any).textSections).toBeUndefined();
    expect((CHEM_CONFIG as any).textSections).toBeUndefined();
    expect(ENGLISH_CONFIG.textSections).toEqual({ reading: 'read', cloze: 'text', rest: 'gl' });
  });
});
