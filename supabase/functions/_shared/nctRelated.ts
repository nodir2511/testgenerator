// Близкие типы заданий НЦТ (химия): чем можно заменить задание, если вопросов нужного типа в выбранных темах нет.
// Семья — типы одного смысла: органика ↔ неорганика (вывод формулы, выход, расчёт по уравнению, смеси, «с чем реагирует»…)
// и родственные подтипы внутри раздела. Тип может входить в несколько семей; связи симметричные.
// Составлено по анализу НЦТ 2022–2026 (какие типы стоят на одних и тех же номерах билета).

export const CHEM_FAMILIES: string[][] = [
  // --- открытые расчёты ---
  // нахождение вещества / элемента / формулы (№ 21, 25, 26, 27)
  ['ORG_FORMULA', 'FORMULA_CALC', 'EL_IDENT_CALC', 'EQUIV_AR', 'MASSFRAC_EL', 'CRYST', 'VAL_VOL'],
  // выход продукта, доля разложившегося
  ['ORG_YIELD', 'YIELD', 'EL_DECOMP_PCT'],
  // расчёт по уравнению (одно или два действия)
  ['ORG_STOICH1', 'STOICH1', 'STOICH2', 'STOICH_REDOX', 'EL_PROD', 'CALC1', 'ORG_CALC'],
  // смеси
  ['ORG_MIX', 'MIX_ACID', 'MIX_SALT', 'MIX_METAL', 'DISPLACE', 'GASMIX_REACT', 'GASMIX_DENS'],
  // многостадийные расчёты, избыток
  ['EL_MULTISTEP', 'EXCESS', 'EXCESS_SALT', 'EXCESS_PIC', 'EL_DECOMP_PCT'],
  // моль, масса, объём, плотность газа
  ['MOL', 'DENS_CALC', 'GASMASS', 'DENS', 'NPART'],
  // термохимия, скорость, равновесие (расчёты)
  ['THERMO', 'STOICH1'],
  ['RATE_CALC', 'VANTHOFF', 'RATE', 'RATE_FACT', 'RATE_GRAPH'],
  ['EQ', 'EQ_CALC'],
  // растворы (расчёты)
  ['SOL_DILUTE', 'SOL_EVAP', 'SOL_ADD'],
  ['SOL_SOLUB', 'SOL_REACTWATER', 'SOL_REACT', 'SOL_MOLAR', 'SOL_MOLAR_CRYST', 'CRYST'],
  // атом (открытые)
  ['ATOM_EP', 'ATOM_POS', 'ATOM_CONF_Z', 'ATOM_D', 'ATOM_UNPAIRED', 'EPN'],

  // --- тесты: органика ↔ неорганика ---
  ['ORG_REACT', 'REACT_WITH'],
  ['ORG_PRODUCT', 'PRODUCT'],
  ['ORG_OBTAIN', 'OBTAIN'],
  ['ORG_CHAIN', 'SCHEME_X', 'SCHEME_XY', 'CHAIN'],
  ['ORG_IDENT', 'EL_IDENT'],
  ['ORG_RTYPE', 'RTYPE', 'RTYPE_POSS'],
  ['ORG_CLASS', 'OXCLASS', 'ORG_NOMEN'],
  ['ORG_STRUCT', 'SIGMAPI', 'BOND'],
  ['ORG_ISOMER', 'ORG_NOMEN', 'ORG_STRUCT'],
  ['ORG_QUAL', 'QUAL'],

  // --- тесты: неорганика ---
  ['REACT_WITH', 'AMPHO', 'ACTIVITY', 'OX_PROP', 'ACIDBASE'],
  ['DECOMP', 'PRODUCT', 'OBTAIN', 'SALT_FORM'],
  ['FERT', 'APPLIED'],
  ['EL_IDENT', 'HYDROXOCOMPLEX', 'FORMULA_XY', 'COMPOSITION'],
  ['NEUTR_SUM', 'REDOX_SUM', 'IONEQ_SUM'],
  ['REDOX_ROLE', 'REDOX_SUM', 'REDOX_COEF', 'REDOX_E', 'REDOX_ID'],
  ['SO', 'VAL_SO', 'VAL'],
  ['ELECTROLYSIS', 'ACTIVITY'],
  // основные понятия
  ['MIX', 'MIXSEP', 'COMPOSITION'],
  ['VAL', 'VAL_VOL', 'VAL_SO'],
  ['MASSRATIO', 'MASSFRAC_EL'],
  ['SALT_RATIO', 'SALT_FORM'],
  // атом и ПЗ
  ['BOND', 'BOND_ORB', 'LATTICE', 'SIGMAPI'],
  ['PERIODIC', 'ANALOG', 'HIGHOX'],
  ['CONFIG', 'ION_CONFIG', 'IONS_E', 'OUTER_E', 'UNPAIRED', 'ORBITALS', 'EPN'],
  // растворы (тесты)
  ['IONEQ', 'IONEQ_SUM', 'IONEX', 'COEXIST'],
  ['DISS', 'DISS_STEP', 'ELECTROLYTE'],
  ['HYDRO_MEDIUM', 'HYDRO_TYPE', 'PH_ROW', 'NEUTR_IND', 'HYDRO_SHIFT'],
  ['WATER_HARD', 'QUAL'],

  // --- соответствия ---
  ['OM_PRODUCT', 'M_PRODUCT'],
  ['OM_REAGENT', 'M_REACT', 'M_REAGSET', 'OM_PAIR'],
  ['OM_OBTAIN', 'OM_PRODUCT'],
  ['OM_CLASS', 'OM_COUNT'],
  ['M_COEF', 'M_ELEMENT'],
  ['M_SIGN', 'M_REACT'],
];

/** Близкие типы: код → множество других кодов из его семей */
export function buildRelated(families: string[][]): Record<string, string[]> {
  const m = new Map<string, Set<string>>();
  for (const fam of families) {
    for (const a of fam) {
      if (!m.has(a)) m.set(a, new Set());
      for (const b of fam) if (b !== a) m.get(a)!.add(b);
    }
  }
  return Object.fromEntries([...m].map(([k, v]) => [k, [...v]]));
}

export const CHEM_RELATED: Record<string, string[]> = buildRelated(CHEM_FAMILIES);
