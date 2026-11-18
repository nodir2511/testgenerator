// Сложность вопроса для экзамена НЦТ (questions.nct_difficulty): 1 — лёгкий, 2 — средний, 3 — сложный.
export const NCT_DIFFICULTIES = [
  { value: 1, name: 'Лёгкий' },
  { value: 2, name: 'Средний' },
  { value: 3, name: 'Сложный' },
] as const;

export function nctDifficultyName(v: number | null | undefined): string {
  return NCT_DIFFICULTIES.find((d) => d.value === v)?.name ?? '';
}

/** Сложность ставится пока только у химии */
export function isChemistrySubject(name: string | null | undefined): boolean {
  return (name ?? '').toLowerCase().includes('хим');
}
