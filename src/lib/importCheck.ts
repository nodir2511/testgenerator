import { buildIndex, findSimilar, type DupDoc } from './duplicates';
import { contentChecks, type CheckCode } from './questionChecks';
import { bankDupDoc, loadBankQuestions, snippet } from './bankScan';

// Проверка строк предпросмотра импорта (только главный админ): ошибки оформления, повторы внутри файла
// и совпадения с вопросами, которые уже есть в банке.

export interface ImportRowLike {
  rowNum: number;
  type: string;
  content: string;
  contentTg?: string;
  imageUrl?: string | null;
  subjectName: string;
  correctAnswer?: string;
  rawOptions?: { text: string; textTg?: string; imageUrl?: string | null }[];
  rawMatchingItems?: { side: 'left' | 'right'; text: string; text_tg?: string; image_url?: string | null }[];
}

export interface RowCheck {
  codes: CheckCode[];
  /** Похожие вопросы, которые уже есть в банке */
  bank: Array<{ id: string; score: number; exact: boolean; answerDiffers: boolean; text: string; where: string }>;
  /** Более ранние строки этого же файла */
  inFile: Array<{ rowNum: number; score: number; exact: boolean; answerDiffers: boolean }>;
}

const numeric = (raw?: string) => {
  const n = Number(String(raw ?? '').replace(',', '.').trim());
  return raw && Number.isFinite(n) ? String(n) : null;
};

// Буква ответа (A–E или 1–5) → номер варианта; непонятный ответ — неизвестен
const optionIndex = (raw?: string) => {
  const t = String(raw ?? '').trim().toUpperCase();
  if (t.length !== 1) return -1;
  const i = 'ABCDE'.indexOf(t);
  return i >= 0 ? i : '12345'.indexOf(t);
};

function rowDoc(r: ImportRowLike): DupDoc {
  const items = r.rawMatchingItems ?? [];
  const main = r.type === 'matching' ? items.map((i) => i.text) : (r.rawOptions ?? []).map((o) => o.text);
  const idx = r.type === 'test' ? optionIndex(r.correctAnswer) : -1;
  const answerOf = (list: string[]) => (idx >= 0 && list[idx] ? [list[idx]] : null);
  const variants: Array<{ content: string; options: string[]; answer: string[] | null }> = [{ content: r.content, options: main, answer: answerOf(main) }];
  if (r.contentTg) {
    const tg = r.type === 'matching' ? items.map((i) => i.text_tg || i.text) : (r.rawOptions ?? []).map((o) => o.textTg || o.text);
    variants.push({ content: r.contentTg, options: tg, answer: answerOf(tg) });
  }
  return { id: `row${r.rowNum}`, variants, answer: r.type === 'open' ? numeric(r.correctAnswer) : null };
}

export async function checkImportRows(
  rows: ImportRowLike[],
  subjects: Array<{ id: string; name: string }>,
  defaultSubjectId: string,
): Promise<Record<number, RowCheck>> {
  const key = (s: string) => s.trim().toLowerCase();
  const subjectOf = (r: ImportRowLike) =>
    (r.subjectName ? subjects.find((s) => key(s.name) === key(r.subjectName))?.id : undefined) ?? (r.subjectName ? undefined : defaultSubjectId);

  const out: Record<number, RowCheck> = {};
  for (const r of rows) {
    const items = r.rawMatchingItems ?? [];
    out[r.rowNum] = {
      codes: contentChecks({
        type: r.type,
        content: r.content,
        image: r.imageUrl,
        options: (r.rawOptions ?? []).map((o) => ({ text: o.text, image: o.imageUrl })),
        left: items.filter((i) => i.side === 'left').map((i) => ({ text: i.text, image: i.image_url })),
        right: items.filter((i) => i.side === 'right').map((i) => ({ text: i.text, image: i.image_url })),
      }),
      bank: [],
      inFile: [],
    };
  }

  // Повторы внутри файла
  const docs = rows.map(rowDoc);
  const fileIndex = buildIndex(docs);
  docs.forEach((d, i) => {
    for (const m of findSimilar(fileIndex, d, { threshold: 0.85, max: 2, onlyBefore: i })) {
      out[rows[i].rowNum].inFile.push({ rowNum: Number(m.id.slice(3)), score: m.score, exact: m.exact, answerDiffers: m.answerDiffers });
    }
  });

  // Совпадения с банком: по одному предмету за раз
  const bySubject = new Map<string, ImportRowLike[]>();
  for (const r of rows) {
    const sid = subjectOf(r);
    if (sid) bySubject.set(sid, [...(bySubject.get(sid) ?? []), r]);
  }
  for (const [sid, list] of bySubject) {
    const bank = await loadBankQuestions(sid);
    if (bank.length === 0) continue;
    const byId = new Map(bank.map((q) => [q.id, q]));
    const index = buildIndex(bank.map(bankDupDoc));
    for (const r of list) {
      for (const m of findSimilar(index, rowDoc(r), { threshold: 0.85, max: 2 })) {
        const q = byId.get(m.id);
        if (q) out[r.rowNum].bank.push({ id: m.id, score: m.score, exact: m.exact, answerDiffers: m.answerDiffers, text: snippet(q.content, 110), where: `${q.chapter?.name ?? ''} · ${q.topic?.name ?? ''}${q.num ? ` · №${q.num}` : ''}` });
      }
    }
  }
  return out;
}
