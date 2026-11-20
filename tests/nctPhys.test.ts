import { describe, expect, it } from 'vitest';
import { CHEM_CONFIG, pickNct, planNct, sectionOfQuestion, sectionPoints } from '../supabase/functions/_shared/nct';
import { PHYS_BANK_CH3, PHYS_CONFIG, physTopicSection } from '../supabase/functions/_shared/nctPhys';
import { BIO_CONFIG } from '../supabase/functions/_shared/nctBio';
import { nctConfigByKey, nctConfigFor } from '../supabase/functions/_shared/nctConfigs';
import { examProfileFor } from '../supabase/functions/_shared/examProfiles';
import { NCT_SLOT_TYPES_PHYS, NCT_TYPE_SECTION_PHYS } from '../supabase/functions/_shared/nctSlotsPhys';
import { NCT_TYPES_PHYS } from '../src/lib/nctTypesPhys';
import { NCT_TYPES_BIO } from '../src/lib/nctTypesBio';
import { NCT_TYPES_ENGLISH } from '../src/lib/nctTypesEnglish';
import { NCT_TYPES_HISTORY } from '../src/lib/nctTypesHistory';
import { NCT_TYPES_LAW } from '../src/lib/nctTypesLaw';
import { NCT_TYPES_MATH } from '../src/lib/nctTypesMath';
import { NCT_TYPES, nctTypesFor, nctTypeName } from '../src/lib/nctTypes';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Число тем в главах банка физики (глава 3 — 8 тем банка, в программе 9) */
const SIZES: Record<number, number> = { 1: 8, 2: 9, 3: 8, 4: 8, 5: 7, 6: 9, 7: 8, 8: 10, 9: 10, 10: 10 };
const SECTIONS = PHYS_CONFIG.sections.map((s) => s.key);
const CHAPTERS = Object.keys(SIZES).map(Number);

/** Коды типов раздела и вида, чей основной раздел — этот (метка не «перекинет» вопрос в другой раздел) */
const codes = (sec: string, kind: string) => Object.keys(NCT_SLOT_TYPES_PHYS[`${sec}:${kind}`] ?? {}).filter((c) => NCT_TYPE_SECTION_PHYS[c] === sec);

/** Синтетический банк физики: главы 1–10, у каждой темы по `per` вопросов каждого вида; метки — по разделу темы (раздача по кругу) */
function physPool(per: { test: number; matching: number; open: number }, chapters = CHAPTERS, labelled = true) {
  const out: any[] = [];
  for (const ch of chapters) {
    for (let tp = 1; tp <= SIZES[ch]; tp++) {
      const sec = physTopicSection(ch, tp)!;
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

describe('режим НЦТ: физика — карта тем и настройки', () => {
  it('карта «глава банка → тема → раздел»: границы уровней 4, 5 и 10, механика ур.1–3 и 6–7, МКТ ур.8, электродинамика ур.9', () => {
    const sec = (c: number, t: number) => physTopicSection(c, t);
    expect([sec(1, 1), sec(1, 8), sec(2, 1), sec(2, 9), sec(3, 1), sec(3, 8)]).toEqual(Array(6).fill('mech'));
    // ур.4: 27–31 → МКТ (темы 1–5), 32–34 → электродинамика (6–8)
    expect([sec(4, 1), sec(4, 5)]).toEqual(['mol', 'mol']);
    expect([sec(4, 6), sec(4, 8)]).toEqual(['elec', 'elec']);
    // ур.5: 35–37 → оптика, 38–41 → атом
    expect([sec(5, 1), sec(5, 3)]).toEqual(['opt', 'opt']);
    expect([sec(5, 4), sec(5, 5), sec(5, 6), sec(5, 7)]).toEqual(Array(4).fill('atom'));
    expect([sec(6, 1), sec(6, 9), sec(7, 1), sec(7, 8)]).toEqual(Array(4).fill('mech'));
    expect([sec(8, 1), sec(8, 10)]).toEqual(['mol', 'mol']);
    expect([sec(9, 1), sec(9, 10)]).toEqual(['elec', 'elec']);
    // ур.10: 79–81 механика, 82–84 электродинамика, 85–86 оптика, 87–88 атом
    expect([sec(10, 1), sec(10, 3)]).toEqual(['mech', 'mech']);
    expect([sec(10, 4), sec(10, 6)]).toEqual(['elec', 'elec']);
    expect([sec(10, 7), sec(10, 8)]).toEqual(['opt', 'opt']);
    expect([sec(10, 9), sec(10, 10)]).toEqual(['atom', 'atom']);
  });

  it('темы вне глав и границ глав пропускаются (null)', () => {
    const sec = (c: number, t: number) => physTopicSection(c, t);
    expect(sec(3, 9)).toBeNull(); // в банке у главы 3 восемь тем
    expect([sec(1, 0), sec(1, 9), sec(2, 10), sec(4, 9), sec(5, 8), sec(6, 10), sec(7, 9), sec(8, 11), sec(9, 11), sec(10, 11)]).toEqual(Array(10).fill(null));
    expect([sec(0, 1), sec(11, 1), sec(1, NaN), sec(1, 1.5), sec(NaN, 1)]).toEqual(Array(5).fill(null));
    expect(PHYS_BANK_CH3).toHaveLength(8);
  });

  it('раздел задания: по теме; метка своего раздела переводит в него, метка из нескольких разделов раздела не меняет', () => {
    const q = { chapter: { order_index: 4 }, topic: { order_index: 2 }, nct_type: null as string | null };
    expect(sectionOfQuestion(q, PHYS_CONFIG)).toBe('mol');
    expect(sectionOfQuestion({ ...q, nct_type: 'PHYS_ISO' }, PHYS_CONFIG)).toBe('mol');
    expect(sectionOfQuestion({ ...q, nct_type: 'НЕТ_ТАКОГО' }, PHYS_CONFIG)).toBe('mol');
    // однозначная метка (закон Ома — электродинамика) уводит задание в свой раздел
    expect(sectionOfQuestion({ ...q, nct_type: 'PHYS_OHM' }, PHYS_CONFIG)).toBe('elec');
    // MATCH_F стоит и в механике, и в электродинамике; WAVE — атом и оптика: раздел по теме
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 1 }, nct_type: 'PHYS_MATCH_F' }, PHYS_CONFIG)).toBe('mech');
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 9 }, nct_type: 'PHYS_MATCH_F' }, PHYS_CONFIG)).toBe('elec');
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 10 }, topic: { order_index: 8 }, nct_type: 'PHYS_WAVE' }, PHYS_CONFIG)).toBe('opt');
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 5 }, topic: { order_index: 5 }, nct_type: 'PHYS_WAVE' }, PHYS_CONFIG)).toBe('atom');
    // тема вне режима даёт null при любой метке
    expect(sectionOfQuestion({ ...q, chapter: { order_index: 11 }, nct_type: 'PHYS_OHM' }, PHYS_CONFIG)).toBeNull();
  });

  it('доли разделов дают 100, баллы раздела — 14 / 5 / 12 / 3 / 6 = 40; другие предметы не изменились', () => {
    expect(PHYS_CONFIG.sections.reduce((a, s) => a + s.share, 0)).toBe(100);
    expect(sectionPoints(SECTIONS, undefined, PHYS_CONFIG)).toEqual({ mech: 14, mol: 5, elec: 12, opt: 3, atom: 6 });
    expect(PHYS_CONFIG.composition).toEqual({ test: 18, matching: 2, open: 7, points: 40 });
    expect(PHYS_CONFIG.pointsPer).toEqual({ test: 1, matching: 4, open: 2 });
    expect(PHYS_CONFIG.quotaPoints).toBe(16);
    expect(PHYS_CONFIG.quota).toEqual({ test: 8, matching: 1, open: 2 });
    expect(PHYS_CONFIG.openDifficulty.reduce((a, b) => a + b, 0)).toBe(7);
    // состав по kindRange = состав билета
    const sum = (k: 'test' | 'matching' | 'open', i: 0 | 1) => Object.values(PHYS_CONFIG.kindRange!).reduce((a, r) => a + r[k]![i], 0);
    expect([sum('test', 0), sum('matching', 0), sum('open', 0)]).toEqual([18, 2, 7]);
    expect([sum('test', 1), sum('matching', 1), sum('open', 1)]).toEqual([18, 2, 7]);
    expect(CHEM_CONFIG.composition).toEqual({ test: 18, matching: 2, open: 7, points: 40 });
    expect(CHEM_CONFIG.maxTypeUse).toBeUndefined();
    expect(BIO_CONFIG.composition).toEqual({ test: 20, matching: 4, open: 2, points: 40 });
  });

  it('профиль и настройки выбираются по названию; «физ» не пересекается с другими предметами', () => {
    expect(nctConfigFor('Физика')).toBe(PHYS_CONFIG);
    expect(nctConfigFor('физика')).toBe(PHYS_CONFIG);
    expect(nctConfigByKey('physics')).toBe(PHYS_CONFIG);
    expect(examProfileFor('Физика')?.key).toBe('physics');
    expect(examProfileFor('Физика')?.sections.map((s) => [s.key, s.share])).toEqual(PHYS_CONFIG.sections.map((s) => [s.key, s.share]));
    expect(nctConfigFor('Химия')?.key).toBe('chemistry');
    expect(nctConfigFor('Биология')?.key).toBe('biology');
    expect(nctConfigFor('Право')?.key).toBe('law');
    expect(nctConfigFor('История')?.key).toBe('history');
    expect(nctConfigFor('Математика')?.key).toBe('math');
    expect(nctConfigFor('Английский язык')?.key).toBe('english');
    expect(nctConfigFor('Таджикский язык')?.key).toBe('taj');
    expect(nctConfigByKey(undefined)).toBe(CHEM_CONFIG);
  });

  it('справочник типов: коды PHYS_…, раздел типа и таблица слотов согласованы, коды не пересекаются с другими предметами', () => {
    expect(NCT_TYPES_PHYS).toHaveLength(103);
    expect(new Set(NCT_TYPES_PHYS.map((t) => t.code)).size).toBe(NCT_TYPES_PHYS.length);
    for (const t of NCT_TYPES_PHYS) {
      expect(t.code.startsWith('PHYS_')).toBe(true);
      expect(t.code).toMatch(/^[A-Z0-9_]+$/);
      expect(NCT_TYPE_SECTION_PHYS[t.code]).toBe(t.section);
      expect(SECTIONS).toContain(t.section);
    }
    const others = new Set([...NCT_TYPES, ...NCT_TYPES_LAW, ...NCT_TYPES_HISTORY, ...NCT_TYPES_MATH, ...NCT_TYPES_ENGLISH, ...NCT_TYPES_BIO].map((t) => t.code));
    expect(NCT_TYPES_PHYS.filter((t) => others.has(t.code))).toEqual([]);
    for (const [key, list] of Object.entries(NCT_SLOT_TYPES_PHYS)) {
      expect(SECTIONS).toContain(key.split(':')[0]);
      for (const [c, n] of Object.entries(list)) { expect(NCT_TYPE_SECTION_PHYS[c], c).toBeTruthy(); expect(n).toBeGreaterThan(0); expect(n).toBeLessThanOrEqual(45); }
    }
    // «Закон Ома» — самый частый тест электродинамики; соответствие №19 — MATCH_F
    expect(NCT_SLOT_TYPES_PHYS['elec:test'].PHYS_OHM).toBe(30);
    expect(NCT_SLOT_TYPES_PHYS['mech:matching'].PHYS_MATCH_F).toBe(33);
    expect(nctTypesFor('Физика')).toBe(NCT_TYPES_PHYS);
    expect(nctTypesFor('Химия')).toBe(NCT_TYPES);
    expect(nctTypesFor('Биология')).toBe(NCT_TYPES_BIO);
    expect(nctTypesFor()).toEqual(expect.arrayContaining(NCT_TYPES_PHYS));
    expect(nctTypeName('PHYS_OHM')).not.toBe('PHYS_OHM');
    expect(nctTypeName('BOND')).toBe('Вид химической связи');
  });
});

describe('режим НЦТ: физика — подбор билета', () => {
  const per = { test: 12, matching: 6, open: 8 };
  const EXPECTED_PLAN = {
    mech: { test: 8, matching: 1, open: 1 }, mol: { test: 1, matching: 0, open: 2 }, elec: { test: 6, matching: 1, open: 1 },
    opt: { test: 1, matching: 0, open: 1 }, atom: { test: 2, matching: 0, open: 2 },
  };

  it('план 18 тестов + 2 соответствия + 7 открытых: как в билетах — 8/1/6/1/2 тестов, соответствия в механике и электродинамике', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const mk = (m: number, o: number) => ({ test: 200, matching: m, open: o });
      const have = { mech: mk(40, 30), mol: mk(40, 30), elec: mk(40, 30), opt: mk(40, 30), atom: mk(40, 30) };
      const plan = planNct(SECTIONS, have, 4, rng(seed), PHYS_CONFIG)!;
      expect(plan).toEqual(EXPECTED_PLAN);
    }
  });

  it('билет на 1, 2 и 4 варианта: состав, один тип на месте, тип не более 2 раз, вопросы не повторяются', () => {
    for (const T of [1, 2, 4]) {
      for (let seed = 1; seed <= 6; seed++) {
        const r = pickNct(physPool(per), T, rng(seed), undefined, undefined, PHYS_CONFIG);
        expect(r.kinds.map((k) => k[0].length)).toEqual([18, 2, 7]);
        expect(r.plan).toEqual(EXPECTED_PLAN);
        const cnt = new Map<string, number>();
        for (const q of r.kinds.flatMap((k) => k[0])) if (q.nct_type) cnt.set(q.nct_type, (cnt.get(q.nct_type) ?? 0) + 1);
        for (const [c, n] of cnt) expect(n, `${c} seed ${seed}`).toBeLessThanOrEqual(PHYS_CONFIG.maxTypeUse!);
        const ids = r.kinds.flatMap((k) => k.flat()).map((q) => q.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('параллельные клоны: в разных вариантах на месте стоит один и тот же тип', () => {
    for (const seed of [1, 4, 8]) {
      const r = pickNct(physPool(per), 4, rng(seed), undefined, undefined, PHYS_CONFIG);
      for (const byTicket of r.kinds) {
        for (let t = 1; t < 4; t++) expect(byTicket[t].map((q) => q.nct_type)).toEqual(byTicket[0].map((q) => q.nct_type));
      }
    }
  });

  it('блоки разделов по номерам: тесты 8 механика, 1 МКТ, 6 электродинамика, 1 оптика, 2 атом; №9 — МКТ, №16 — оптика', () => {
    for (const seed of [3, 5, 9, 11]) {
      const r = pickNct(physPool(per), 2, rng(seed), undefined, undefined, PHYS_CONFIG);
      const secs = r.kinds[0][0].map((q) => sectionOfQuestion(q, PHYS_CONFIG)!);
      expect(secs).toEqual([...Array(8).fill('mech'), 'mol', ...Array(6).fill('elec'), 'opt', 'atom', 'atom']);
      const [, matching, open] = r.kinds.map((k) => k[0]);
      expect(matching.map((q) => sectionOfQuestion(q, PHYS_CONFIG))).toEqual(['mech', 'elec']);
      expect(open.map((q) => sectionOfQuestion(q, PHYS_CONFIG))).toEqual(['mech', 'mol', 'mol', 'elec', 'opt', 'atom', 'atom']);
    }
  });

  it('баллы билета = 40, баллы по разделам 14 / 5 / 12 / 3 / 6', () => {
    for (const seed of [2, 6, 10]) {
      const r = pickNct(physPool(per), 2, rng(seed), undefined, undefined, PHYS_CONFIG);
      const [tests, matching, open] = r.kinds.map((k) => k[0]);
      expect(tests.length + 4 * matching.length + 2 * open.length).toBe(40);
      const pts: Record<string, number> = {};
      for (const [list, w] of [[tests, 1], [matching, 4], [open, 2]] as Array<[any[], number]>) {
        for (const q of list) { const s = sectionOfQuestion(q, PHYS_CONFIG)!; pts[s] = (pts[s] ?? 0) + w; }
      }
      expect(pts).toEqual({ mech: 14, mol: 5, elec: 12, opt: 3, atom: 6 });
    }
  });

  it('пока в банке только главы 1–4 (нет оптики и атома): билет собирается полностью, ограничения полного экзамена снимаются', () => {
    const early = physPool(per, [1, 2, 3, 4]);
    const r = pickNct(early, 2, rng(42), undefined, undefined, PHYS_CONFIG);
    expect(r.kinds.map((k) => k[0].length)).toEqual([18, 2, 7]);
    expect([...r.sections].sort()).toEqual(['elec', 'mech', 'mol']);
  });

  it('банк без меток тоже даёт полный билет', () => {
    const r = pickNct(physPool(per, CHAPTERS, false), 2, rng(2), undefined, undefined, PHYS_CONFIG);
    expect(r.kinds.map((k) => k[0].length)).toEqual([18, 2, 7]);
  });

  it('вопросы тем вне режима в билет не берутся', () => {
    const pool = [...physPool(per), { id: 'x1', type: 'test', topic_id: 'tx', chapter_id: 'c11', chapter: { order_index: 11 }, topic: { order_index: 1 }, nct_type: null },
      { id: 'x2', type: 'test', topic_id: 'ty', chapter_id: 'c3', chapter: { order_index: 3 }, topic: { order_index: 9 }, nct_type: null }];
    const r = pickNct(pool, 1, rng(4), undefined, undefined, PHYS_CONFIG);
    const ids = r.kinds.flatMap((k) => k.flat()).map((q) => q.id);
    expect(ids.includes('x1') || ids.includes('x2')).toBe(false);
    expect(r.notes.join(' ')).toContain('вне глав 1–10');
  });
});
