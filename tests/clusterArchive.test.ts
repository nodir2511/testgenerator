import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

// Архив обычного генератора (RU + TJ с ключами) → разбор обратно → книжки кластера с ключами.
// Картинки и шаблоны читаются с диска, canvas подменён заглушкой (как в cluster.test.ts)
const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

beforeAll(() => {
  (globalThis as any).fetch = async (url: string) => {
    const file = path.join('public', url.replace(/^\//, ''));
    if (!fs.existsSync(file)) return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
    const b = fs.readFileSync(file);
    return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
  (globalThis as any).createImageBitmap = async () => ({ width: 10, height: 10 });
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  (globalThis as any).document = {
    createElement: () => ({
      width: 0, height: 0, getContext: () => ctx,
      toBlob: (cb: (b: Blob) => void) => cb(new Blob([png1], { type: 'image/png' })),
    }),
  };
});

const LET = ['A', 'B', 'C', 'D'];
const test = (n: number, v: number) => ({
  id: `t${n}`, type: 'test', content: `Вопрос ${n} в${v}`, content_ru: `Вопрос ${n} в${v}`, content_tg: `Савол ${n} в${v}`,
  options: LET.map((x, i) => ({ id: `o${n}${i}`, text: `${x}${n}`, text_ru: `${x}${n}`, text_tg: `${x}${n}`, is_correct: i === (n + v) % 4, order_index: i + 1 })),
});
const matching = (n: number, v: number) => {
  const right = [1, 2, 3, 4, 5].map((i) => ({ id: `r${n}${i}`, side: 'right', text: `R${i}`, text_ru: `R${i}`, text_tg: `R${i}`, order_index: i }));
  const left = [1, 2, 3, 4].map((i) => ({ id: `l${n}${i}`, side: 'left', text: `L${i}`, text_ru: `L${i}`, text_tg: `L${i}`, order_index: i, correct_match_id: `r${n}${((i + n + v) % 5) + 1}` }));
  return { id: `m${n}`, type: 'matching', content: `Соотнесите ${n}`, content_ru: `Соотнесите ${n}`, content_tg: `Мувофиқ ${n}`, matching_items: [...left, ...right] };
};
const open = (n: number, v: number) => ({ id: `p${n}`, type: 'open', content: `Открытый ${n}`, content_ru: `Открытый ${n}`, content_tg: `Кушода ${n}`, correct_numeric_answer: 100 * v + n });

const ticket = (v: number, c: { test: number; matching: number; open: number }) => ({
  ticket_number: v,
  questions: [
    ...Array.from({ length: c.test }, (_, i) => test(i + 1, v)),
    ...Array.from({ length: c.matching }, (_, i) => matching(i + 1, v)),
    ...Array.from({ length: c.open }, (_, i) => open(i + 1, v)),
  ].map((q) => ({ question_snapshot: q })),
});

async function archiveOf(subject: string, c: { test: number; matching: number; open: number }) {
  const { buildTicketsFile } = await import('../src/lib/docxExport');
  const { keyArchiveExtras } = await import('../src/lib/answerKeyExport');
  const tickets = [1, 2, 3, 4].map((v) => ticket(v, c));
  const extras = await keyArchiveExtras('Экзамен', tickets, subject, undefined, 'both');
  expect(extras.length).toBe(1);
  return (await buildTicketsFile('Экзамен', tickets as any, subject, 'both', extras)).blob;
}

const SUBJECTS = [
  ['Таджикский язык', { test: 20, matching: 4, open: 2 }, 'таджикскому языку'],
  ['Биология', { test: 20, matching: 4, open: 2 }, 'биологии'],
  ['Химия', { test: 18, matching: 2, open: 7 }, 'химии'],
  ['Физика', { test: 18, matching: 2, open: 7 }, 'физике'],
] as const;

async function build(which: number[]) {
  const { parseSubjectArchive } = await import('../src/lib/clusterArchive');
  const { buildClusterZip } = await import('../src/lib/clusterExport');
  const parsed: Array<Awaited<ReturnType<typeof parseSubjectArchive>> | null> = [];
  for (let i = 0; i < 4; i++) parsed.push(which.includes(i) ? await parseSubjectArchive(await archiveOf(SUBJECTS[i][0], SUBJECTS[i][1])) : null);
  const variants = [1, 2, 3, 4].map((n) => ({ number: n, subjects: parsed.map((p) => p?.variants.find((v) => v.number === n)!.snaps ?? null) }));
  const file = await buildClusterZip({ code: 'А.5', exam: 'Авг', date: '27.09' }, variants, { keys: true, readyKeys: parsed.map((p) => p?.keyBytes ?? null) });
  const zip = await JSZip.loadAsync(await file.blob.arrayBuffer());
  return { zip, parsed, names: Object.keys(zip.files).filter((n) => !zip.files[n].dir) };
}

const textOf = (xml: string) => xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');

async function checkKeys(zip: JSZip, names: string[], which: number[]) {
  const keyNames = names.filter((n) => n.startsWith('Ключи/'));
  expect(keyNames.length).toBe(which.length);
  for (const i of which) {
    const [subject, , dative] = SUBJECTS[i];
    const name = keyNames.find((n) => n.includes(subject));
    expect(name, subject).toBeTruthy();
    const kz = await JSZip.loadAsync(await zip.file(name!)!.async('uint8array'));
    const doc = textOf(await kz.file('word/document.xml')!.async('string'));
    // шапка: код кластера и предмет на каждой из 4 страниц; старая строка исчезла
    expect(doc.match(new RegExp(`к субтесту по ${dative} – А\\.5`, 'g'))?.length).toBe(4);
    expect(doc).not.toContain('Экзамен');
    const hdr = textOf(await kz.file('word/header1.xml')!.async('string') + (await kz.file('word/header2.xml')?.async('string') ?? ''));
    expect(hdr).toContain(`А.5-Авг – ${subject}`);
    // ответы остались: ключ не пустой и не красный
    expect(await kz.file('word/document.xml')!.async('string')).not.toContain('FF9999');
  }
}

describe('архив предмета → разбор', () => {
  it('читает 4 варианта на двух языках (20+4+2 и 18+2+7)', async () => {
    const { parseSubjectArchive } = await import('../src/lib/clusterArchive');
    for (const [subject, c] of [SUBJECTS[1], SUBJECTS[2]] as const) {
      const parsed = await parseSubjectArchive(await archiveOf(subject, c));
      expect(parsed.keyBytes).not.toBeNull();
      expect(parsed.variants.map((v) => v.number)).toEqual([1, 2, 3, 4]);
      for (const v of parsed.variants) {
        expect(v.skipped).toEqual([]);
        expect(v.snaps.filter((s) => s.type === 'test').length).toBe(c.test);
        expect(v.snaps.filter((s) => s.type === 'matching').length).toBe(c.matching);
        expect(v.snaps.filter((s) => s.type === 'open').length).toBe(c.open);
      }
    }
  }, 60000);

  it('4 предмета: 4 варианта → 8 книжек + готовые ключи с шапкой кластера', async () => {
    const { zip, names } = await build([0, 1, 2, 3]);
    expect(names.filter((n) => n.startsWith('Русский/')).length).toBe(4);
    expect(names.filter((n) => n.startsWith('Тоҷикӣ/')).length).toBe(4);
    await checkKeys(zip, names, [0, 1, 2, 3]);
  }, 120000);

  it('2 предмета (химия + биология): 8 книжек и 2 ключа', async () => {
    const { zip, names } = await build([1, 2]);
    expect(names.filter((n) => n.startsWith('Русский/')).length).toBe(4);
    expect(names.filter((n) => n.startsWith('Тоҷикӣ/')).length).toBe(4);
    await checkKeys(zip, names, [1, 2]);
  }, 120000);
});
