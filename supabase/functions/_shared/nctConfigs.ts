// Реестр настроек режима НЦТ по предметам. Предмет без настроек режима не видит (см. examProfiles.ts).
import { CHEM_CONFIG, type NctConfig } from './nct';
import { LAW_CONFIG } from './nctLaw';
import { HISTORY_CONFIG } from './nctHistory';
import { MATH_CONFIG } from './nctMath';
import { ENGLISH_CONFIG } from './nctEnglish';
import { examProfileFor } from './examProfiles';

/** Настройки по ключу, записанному в параметрах набора (`nct_subject`); у старых наборов ключа нет — химия */
export function nctConfigByKey(key: string | null | undefined): NctConfig {
  return key === 'law' ? LAW_CONFIG : key === 'history' ? HISTORY_CONFIG : key === 'math' ? MATH_CONFIG : key === 'english' ? ENGLISH_CONFIG : CHEM_CONFIG;
}

export function nctConfigFor(subjectName: string | null | undefined): NctConfig | null {
  const p = examProfileFor(subjectName);
  if (!p) return null;
  return p.key === 'law' ? LAW_CONFIG : p.key === 'history' ? HISTORY_CONFIG : p.key === 'math' ? MATH_CONFIG : p.key === 'english' ? ENGLISH_CONFIG : p.key === 'chemistry' ? CHEM_CONFIG : null;
}
