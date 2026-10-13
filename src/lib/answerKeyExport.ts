import { saveAs } from 'file-saver';
import { supabase } from './supabase';
import { buildAnswerKeyDocx, keyKindOf, selectionInfo, selectionChips, type KeyTicket, type SelectionChip } from './answerKey';

// Скачивание ключей ответов (Word по шаблону предмета) для созданных билетов.
// Старые сохранённые билеты не хранят верные ответы в снимке — они подгружаются из банка вопросов.

const chunk = <T,>(a: T[], n: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n));
  return r;
};

const needsAnswers = (snap: any) =>
  (snap.type === 'test' && (snap.options || []).some((o: any) => !('is_correct' in o))) ||
  (snap.type === 'matching' && (snap.matching_items || []).some((m: any) => m.side === 'left' && !('correct_match_id' in m))) ||
  (snap.type === 'open' && !('correct_numeric_answer' in snap));

async function enrich(tickets: KeyTicket[]): Promise<KeyTicket[]> {
  const snaps = tickets.flatMap((t) => t.questions.map((q) => q.question_snapshot)).filter(Boolean);
  const stale = snaps.filter(needsAnswers);
  if (!stale.length) return tickets;

  const optCorrect = new Map<string, boolean>();
  const matchTarget = new Map<string, string | null>();
  const numeric = new Map<string, number | null>();

  for (const ids of chunk([...new Set(stale.map((s: any) => s.id as string))], 100)) {
    const [opts, items, qs] = await Promise.all([
      supabase.from('question_options').select('id, is_correct').in('question_id', ids),
      supabase.from('matching_items').select('id, correct_match_id').in('question_id', ids),
      supabase.from('questions').select('id, correct_numeric_answer').in('id', ids),
    ]);
    for (const e of [opts.error, items.error, qs.error]) if (e) throw e;
    opts.data?.forEach((o: any) => optCorrect.set(o.id, !!o.is_correct));
    items.data?.forEach((m: any) => matchTarget.set(m.id, m.correct_match_id ?? null));
    qs.data?.forEach((q: any) => numeric.set(q.id, q.correct_numeric_answer ?? null));
  }

  return tickets.map((t) => ({
    ...t,
    questions: t.questions.map((q) => {
      const s = q.question_snapshot;
      if (!s || !needsAnswers(s)) return q;
      return {
        ...q,
        question_snapshot: {
          ...s,
          options: s.options?.map((o: any) => ('is_correct' in o ? o : { ...o, is_correct: optCorrect.get(o.id) ?? false })),
          matching_items: s.matching_items?.map((m: any) =>
            m.side === 'left' && !('correct_match_id' in m) ? { ...m, correct_match_id: matchTarget.get(m.id) ?? null } : m),
          correct_numeric_answer: 'correct_numeric_answer' in s ? s.correct_numeric_answer : numeric.get(s.id) ?? null,
        },
      };
    }),
  }));
}

export function hasKeyTemplate(subjectName: string): boolean {
  return keyKindOf(subjectName) !== null;
}

// Какие главы и темы вошли в билеты — для шапки ключей; при ошибке шапка остаётся как в шаблоне
export interface SelectionInfos { ru: string | null; tg: string | null; chips?: SelectionChip[] }

// Загрузчик с кэшем структуры предмета (главы и темы), чтобы не повторять запросы для партий одного предмета
export function makeSelectionInfoLoader() {
  const cache = new Map<string, Promise<{ chapters: any[]; topics: any[] } | null>>();
  const structure = (subjectId: string) => {
    if (!cache.has(subjectId)) {
      cache.set(subjectId, (async () => {
        const chapters = await supabase.from('chapters').select('id, order_index').eq('subject_id', subjectId).eq('is_deleted', false);
        if (chapters.error || !chapters.data?.length) return null;
        const topics = await supabase.from('topics').select('id, chapter_id, order_index').in('chapter_id', chapters.data.map((c: any) => c.id)).eq('is_deleted', false);
        if (topics.error) return null;
        return { chapters: chapters.data, topics: topics.data ?? [] };
      })().catch(() => null));
    }
    return cache.get(subjectId)!;
  };
  return async (subjectId: string | null | undefined, params: any): Promise<SelectionInfos> => {
    const none = { ru: null, tg: null };
    if (!subjectId) return none;
    const s = await structure(subjectId);
    if (!s) return none;
    const ch = params?.chapter_ids ?? [], tp = params?.topic_ids ?? [];
    return { ru: selectionInfo(s.chapters, s.topics, ch, tp, 'ru'), tg: selectionInfo(s.chapters, s.topics, ch, tp, 'tg'), chips: selectionChips(s.chapters, s.topics, ch, tp) };
  };
}

/** Добавляет каждому билету описание выбранных глав и тем (печатается в шапке варианта) */
export async function withSelectionInfo<T extends { ticket_number: number }>(
  tickets: T[], subjectId: string | null | undefined, params: any,
  load: (subjectId: string | null | undefined, params: any) => Promise<SelectionInfos> = makeSelectionInfoLoader(),
): Promise<Array<T & { selection_info: SelectionInfos }>> {
  const info = await load(subjectId, params);
  return tickets.map((t) => ({ ...t, selection_info: info }));
}

async function loadSelectionInfo(subjectId: string, params: any): Promise<string | null> {
  return (await makeSelectionInfoLoader()(subjectId, params)).ru;
}

export interface KeyFile { blob: Blob; fileName: string; stats: { missing: number; overflow: number } }
type KeySelection = { subjectId?: string | null; params?: any };

export async function buildAnswerKeyFile(title: string, tickets: KeyTicket[], subjectName: string, selection?: KeySelection): Promise<KeyFile> {
  const kind = keyKindOf(subjectName);
  if (!kind) throw new Error('Для этого предмета нет шаблона ключей');
  const res = await fetch(`/key-templates/${kind}.docx`);
  if (!res.ok) throw new Error('Не удалось загрузить шаблон ключей');
  const template = await res.arrayBuffer();
  const sorted = [...tickets].sort((a, b) => a.ticket_number - b.ticket_number);
  const info = selection?.subjectId ? await loadSelectionInfo(selection.subjectId, selection.params) : null;
  const { bytes, stats } = await buildAnswerKeyDocx(template, await enrich(sorted), info);
  const safe = title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || 'Билеты';
  return {
    blob: new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    fileName: `Ключи – ${safe}.docx`,
    stats,
  };
}

export async function exportAnswerKey(
  title: string, tickets: KeyTicket[], subjectName: string,
  /** Предмет и выбор глав/тем партии (subject_id + generation_params) — для шапки ключей */
  selection?: KeySelection,
): Promise<{ missing: number; overflow: number }> {
  const file = await buildAnswerKeyFile(title, tickets, subjectName, selection);
  saveAs(file.blob, file.fileName);
  return file.stats;
}

/** Ключи для архива «RU + TJ»: кладутся в тот же ZIP; для других языков и предметов без шаблона — пусто */
export async function keyArchiveExtras(
  title: string, tickets: KeyTicket[], subjectName: string, selection: KeySelection | undefined, lang: string,
): Promise<Array<{ name: string; blob: Blob }>> {
  if (lang !== 'both' || !hasKeyTemplate(subjectName)) return [];
  try {
    const f = await buildAnswerKeyFile(title, tickets, subjectName, selection);
    return [{ name: f.fileName, blob: f.blob }];
  } catch (e) {
    console.warn('Ключи не добавлены в архив', e);
    return [];
  }
}
