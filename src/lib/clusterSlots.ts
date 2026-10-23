// Предметы кластерного экзамена и его настройки. Вынесены отдельно, чтобы список сохранённых билетов
// не тянул за собой весь генератор Word (clusterExport).

export type ClusterLang = 'ru' | 'tj';
export type ClusterKind = 'taj' | 'bio' | 'chem' | 'phys';

export interface ClusterSettings {
  /** Код кластера, например «А.5» */
  code: string;
  /** Название экзамена, например «Авг» */
  exam: string;
  /** Дата на обложке, например «27.09» */
  date: string;
}

/** Предметы книжки в порядке следования */
export const CLUSTER_SLOTS: Array<{ kind: ClusterKind; name: string; counts: { test: number; matching: number; open: number } }> = [
  { kind: 'taj', name: 'Таджикский язык', counts: { test: 20, matching: 4, open: 2 } },
  { kind: 'bio', name: 'Биология', counts: { test: 20, matching: 4, open: 2 } },
  { kind: 'chem', name: 'Химия', counts: { test: 18, matching: 2, open: 7 } },
  { kind: 'phys', name: 'Физика', counts: { test: 18, matching: 2, open: 7 } },
];
