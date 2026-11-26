// Типы заданий НЦТ (метка вопроса в банке, questions.nct_type). Список составлен по анализу НЦТ 2022–2026:
// код, раздел НЦТ, название, номера билета, на которых тип встречался.
export type NctTypeSection = string; // ключ раздела предмета (химия: basic, atom, …; право: const, theory, branch, rights; история: tj, world)
export interface NctTypeInfo { code: string; section: NctTypeSection; name: string; numbers: string }

import { NCT_TYPES } from './nctTypesChem';
export { NCT_TYPES };

import { NCT_TYPES_ENGLISH } from './nctTypesEnglish';
import { NCT_TYPES_LAW } from './nctTypesLaw';
import { NCT_TYPES_HISTORY } from './nctTypesHistory';
import { NCT_TYPES_MATH } from './nctTypesMath';
import { NCT_TYPES_BIO } from './nctTypesBio';
import { NCT_TYPES_PHYS } from './nctTypesPhys';
import { NCT_TYPES_TAJ } from './nctTypesTaj';

import { nctSubjectKey, type NctSubjectKey } from './nctTypesLazy';

const BY_SUBJECT: Record<NctSubjectKey, NctTypeInfo[]> = {
  chem: NCT_TYPES, law: NCT_TYPES_LAW, history: NCT_TYPES_HISTORY, math: NCT_TYPES_MATH,
  english: NCT_TYPES_ENGLISH, bio: NCT_TYPES_BIO, phys: NCT_TYPES_PHYS, taj: NCT_TYPES_TAJ,
};
const BY_CODE = new Map([...NCT_TYPES, ...NCT_TYPES_LAW, ...NCT_TYPES_HISTORY, ...NCT_TYPES_MATH, ...NCT_TYPES_ENGLISH, ...NCT_TYPES_BIO, ...NCT_TYPES_PHYS, ...NCT_TYPES_TAJ].map((t) => [t.code, t]));

/** Справочник типов предмета по его названию (химия — прежний список, право, история, математика, английский, биология и физика — свои; другой предмет — пусто; без предмета — все) */
export function nctTypesFor(subjectName?: string | null): NctTypeInfo[] {
  const key = nctSubjectKey(subjectName);
  if (key) return BY_SUBJECT[key];
  return (subjectName ?? '').trim() ? [] : Object.values(BY_SUBJECT).flat(); // предмет не выбран — все типы
}
export const nctTypeName = (code?: string | null): string => (code ? BY_CODE.get(code)?.name ?? code : '');
export const isNctType = (code?: string | null): boolean => !!code && BY_CODE.has(code);
