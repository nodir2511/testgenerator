// Предметы кластерного экзамена и его настройки. Вынесены отдельно, чтобы список сохранённых билетов
// не тянул за собой весь генератор Word (clusterExport).

export type ClusterLang = 'ru' | 'tj';
export type ClusterKind = 'taj' | 'bio' | 'chem' | 'phys' | 'math' | 'hist' | 'law' | 'eng';

export interface ClusterSettings {
  /** Код кластера, например «А.5» */
  code: string;
  /** Название экзамена, например «Авг» */
  exam: string;
  /** Дата на обложке, например «27.09» */
  date: string;
}

export type ClusterCounts = { test: number; matching: number; open: number };

export interface ClusterSubjectDef {
  kind: ClusterKind;
  name: string;
  /** Название по-таджикски (обложка, инструкция, колонтитулы) */
  nameTj: string;
  /** «по …»: «таджикскому языку», «биологии» — для инструкции и ключей */
  dative: string;
  counts: ClusterCounts;
  /** У субтеста часть каждой страницы свободна под черновик (химия, физика, математика) */
  draft: boolean;
  /** Сколько клеток в рамке открытого ответа */
  openBoxes: number;
  /** Файл шаблона ключей в public/key-templates (без .docx): 20+4+2 или 18+2+7 */
  keyTemplate: string;
}

const A: ClusterCounts = { test: 20, matching: 4, open: 2 };
const B: ClusterCounts = { test: 18, matching: 2, open: 7 };

/** Все предметы, которые можно поставить в книжку */
export const CLUSTER_SUBJECTS: Record<ClusterKind, ClusterSubjectDef> = {
  taj: { kind: 'taj', name: 'Таджикский язык', nameTj: 'Забони тоҷикӣ', dative: 'таджикскому языку', counts: A, draft: false, openBoxes: 5, keyTemplate: 'taj-cluster' },
  bio: { kind: 'bio', name: 'Биология', nameTj: 'Биология', dative: 'биологии', counts: A, draft: false, openBoxes: 4, keyTemplate: 'bio' },
  chem: { kind: 'chem', name: 'Химия', nameTj: 'Химия', dative: 'химии', counts: B, draft: true, openBoxes: 4, keyTemplate: 'chem' },
  phys: { kind: 'phys', name: 'Физика', nameTj: 'Физика', dative: 'физике', counts: B, draft: true, openBoxes: 4, keyTemplate: 'phys' },
  math: { kind: 'math', name: 'Математика', nameTj: 'Математика', dative: 'математике', counts: B, draft: true, openBoxes: 4, keyTemplate: 'math' },
  // История, право и английский: те же 20+4+2 и тот же шаблон ключей, что у биологии
  hist: { kind: 'hist', name: 'История', nameTj: 'Таърих', dative: 'истории', counts: A, draft: false, openBoxes: 4, keyTemplate: 'bio' },
  law: { kind: 'law', name: 'Право', nameTj: 'Ҳуқуқ', dative: 'праву', counts: A, draft: false, openBoxes: 4, keyTemplate: 'bio' },
  eng: { kind: 'eng', name: 'Английский язык', nameTj: 'Забони англисӣ', dative: 'английскому языку', counts: A, draft: false, openBoxes: 5, keyTemplate: 'bio' },
};

/** Предметы в порядке списка выбора */
export const CLUSTER_KINDS: ClusterKind[] = ['taj', 'bio', 'chem', 'phys', 'math', 'hist', 'law', 'eng'];

/** Сколько предметов может быть в книжке */
export const CLUSTER_MIN_SUBJECTS = 2;
export const CLUSTER_MAX_SUBJECTS = 4;

/** Прежний состав книжки (taj, bio, chem, phys в этом порядке): так читаются партии, сохранённые до выбора предметов */
export const LEGACY_KINDS: ClusterKind[] = ['taj', 'bio', 'chem', 'phys'];
export const CLUSTER_SLOTS: ClusterSubjectDef[] = LEGACY_KINDS.map((k) => CLUSTER_SUBJECTS[k]);
