import { useEffect, useState } from 'react';
import type { NctTypeInfo } from '../lib/nctTypes';
import { loadNctTypes, loadedNctTypes } from '../lib/nctTypesLazy';

const NONE: NctTypeInfo[] = [];

/**
 * Типы заданий НЦТ предмета: список подгружается отдельным небольшим файлом (без предмета — все предметы).
 * `enabled = false` — ничего не грузится (метки видит только главный админ; название предмета ещё не известно).
 * Пока идёт загрузка — пустой список; после неё компонент перерисовывается, и `nctTypeLabel` отдаёт названия.
 */
export function useNctTypes(subjectName?: string | null, enabled = true): NctTypeInfo[] {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled || loadedNctTypes(subjectName)) return;
    let alive = true;
    loadNctTypes(subjectName).then(() => { if (alive) bump((n) => n + 1); }, () => undefined);
    return () => { alive = false; };
  }, [subjectName, enabled]);
  return (enabled ? loadedNctTypes(subjectName) : null) ?? NONE;
}
