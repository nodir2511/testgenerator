// Типы заданий НЦТ с загрузкой по предмету: интерфейс берёт список только открытого предмета,
// а не все предметы сразу (полный справочник — nctTypes.ts, им пользуются тесты и скрипты).
import type { NctTypeInfo } from './nctTypes';

export type NctSubjectKey = 'chem' | 'law' | 'history' | 'math' | 'english' | 'bio' | 'phys' | 'taj';

/** Предмет справочника по названию предмета на сайте; null — у предмета типов нет */
export function nctSubjectKey(subjectName?: string | null): NctSubjectKey | null {
  const n = (subjectName ?? '').toLowerCase();
  if (n.includes('прав') || n.includes('ҳуқуқ')) return 'law';
  if (n.includes('истор') || n.includes('таърих')) return 'history';
  if (n.includes('матем') || n.includes('риёз')) return 'math';
  if (n.includes('англи') || n.includes('english')) return 'english';
  if (n.includes('биол')) return 'bio';
  if (n.includes('физ')) return 'phys';
  if (n.includes('таджик') || n.includes('тоҷик')) return 'taj';
  if (n.includes('хим')) return 'chem';
  return null;
}

const LOADERS: Record<NctSubjectKey, () => Promise<NctTypeInfo[]>> = {
  chem: () => import('./nctTypesChem').then((m) => m.NCT_TYPES),
  law: () => import('./nctTypesLaw').then((m) => m.NCT_TYPES_LAW),
  history: () => import('./nctTypesHistory').then((m) => m.NCT_TYPES_HISTORY),
  math: () => import('./nctTypesMath').then((m) => m.NCT_TYPES_MATH),
  english: () => import('./nctTypesEnglish').then((m) => m.NCT_TYPES_ENGLISH),
  bio: () => import('./nctTypesBio').then((m) => m.NCT_TYPES_BIO),
  phys: () => import('./nctTypesPhys').then((m) => m.NCT_TYPES_PHYS),
  taj: () => import('./nctTypesTaj').then((m) => m.NCT_TYPES_TAJ),
};
const ALL_KEYS = Object.keys(LOADERS) as NctSubjectKey[];

const lists = new Map<NctSubjectKey, NctTypeInfo[]>();
const pending = new Map<NctSubjectKey, Promise<NctTypeInfo[]>>();
const byCode = new Map<string, NctTypeInfo>();

function loadKey(key: NctSubjectKey): Promise<NctTypeInfo[]> {
  let p = pending.get(key);
  if (!p) {
    p = LOADERS[key]().then((list) => {
      lists.set(key, list);
      for (const t of list) byCode.set(t.code, t);
      return list;
    });
    // сбой загрузки не запоминаем: следующая попытка скачает файл заново
    p.catch(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

/** Какие списки нужны: предмет с типами — один, предмет не выбран — все, предмет без типов — ни одного */
function keysFor(subjectName?: string | null): NctSubjectKey[] {
  const key = nctSubjectKey(subjectName);
  if (key) return [key];
  return (subjectName ?? '').trim() ? [] : ALL_KEYS;
}

/** Загружает типы предмета (без предмета — всех предметов) */
export async function loadNctTypes(subjectName?: string | null): Promise<NctTypeInfo[]> {
  return (await Promise.all(keysFor(subjectName).map(loadKey))).flat();
}

/** Уже загруженные типы предмета; null — ещё не все загружены */
export function loadedNctTypes(subjectName?: string | null): NctTypeInfo[] | null {
  const keys = keysFor(subjectName);
  return keys.every((k) => lists.has(k)) ? keys.flatMap((k) => lists.get(k)!) : null;
}

/** Название типа по коду среди уже загруженных списков; пока список грузится — сам код */
export const nctTypeLabel = (code?: string | null): string => (code ? byCode.get(code)?.name ?? code : '');
