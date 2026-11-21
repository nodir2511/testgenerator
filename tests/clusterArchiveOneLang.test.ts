import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

// Предмет на одном языке: таджикский выгружается только как «Варианти N», английский — только как «Variant N».
// Такой архив должен разбираться (единственный язык берётся для обеих книжек), а русский без таджикского — нет.
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
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx, toBlob: (cb: (b: Blob) => void) => cb(new Blob([png1], { type: 'image/png' })) }),
  };
});

const LET = ['A', 'B', 'C', 'D'];
const test = (n: number) => ({
  id: `t${n}`, type: 'test', content: `Савол ${n}`, content_ru: '', content_tg: `Савол ${n}`,
  options: LET.map((x, i) => ({ id: `o${n}${i}`, text: `${x}${n}`, text_ru: '', text_tg: `${x}${n}`, is_correct: i === n % 4, order_index: i + 1 })),
});
const matching = (n: number) => {
  const right = [1, 2, 3, 4, 5].map((i) => ({ id: `r${n}${i}`, side: 'right', text: `R${i}`, text_ru: '', text_tg: `R${i}`, order_index: i }));
  const left = [1, 2, 3, 4].map((i) => ({ id: `l${n}${i}`, side: 'left', text: `L${i}`, text_ru: '', text_tg: `L${i}`, order_index: i, correct_match_id: `r${n}${((i + n) % 5) + 1}` }));
  return { id: `m${n}`, type: 'matching', content: `Мувофиқ ${n}`, content_ru: '', content_tg: `Мувофиқ ${n}`, matching_items: [...left, ...right] };
};
const open = (n: number) => ({ id: `p${n}`, type: 'open', content: `Кушода ${n}`, content_ru: '', content_tg: `Кушода ${n}`, correct_numeric_answer: 100 + n });
const tickets = [1, 2].map((v) => ({
  ticket_number: v,
  questions: [...Array.from({ length: 20 }, (_, i) => test(i + 1)), ...[1, 2, 3, 4].map(matching), ...[1, 2].map(open)].map((q) => ({ question_snapshot: q })),
}));

describe('архив предмета на одном языке', () => {
  it('таджикский: только «Варианти N» — разбирается, русская книжка получает тот же текст', async () => {
    const { buildTicketsFile } = await import('../src/lib/docxExport');
    const { keyArchiveExtras } = await import('../src/lib/answerKeyExport');
    const { parseSubjectArchive } = await import('../src/lib/clusterArchive');
    const extras = await keyArchiveExtras('Экзамен', tickets as any, 'Таджикский язык', undefined, 'tg');
    const blob = (await buildTicketsFile('Экзамен', tickets as any, 'Таджикский язык', 'tg', extras))!.blob;
    const names = Object.keys((await JSZip.loadAsync(await blob.arrayBuffer())).files);
    expect(names.some((n) => n.startsWith('Русский/'))).toBe(false); // как на сайте: одна папка-язык

    const p = await parseSubjectArchive(blob);
    expect(p.variants.map((v) => v.number)).toEqual([1, 2]);
    for (const v of p.variants) {
      expect(v.skipped).toEqual([]);
      expect(v.snaps.filter((s) => s.type === 'test').length).toBe(20);
      expect(v.snaps.filter((s) => s.type === 'matching').length).toBe(4);
      expect(v.snaps.filter((s) => s.type === 'open').length).toBe(2);
    }
    const q = p.variants[0].snaps[0];
    expect(q.content_ru).toBe(q.content_tg);
    expect(q.content_tg).toContain('Савол 1');
    expect(p.warnings.join(' ')).toContain('только таджикские');
  }, 120000);

  it('английский: только «Variant N» — разбирается', async () => {
    const { buildTicketsFile } = await import('../src/lib/docxExport');
    const { parseSubjectArchive } = await import('../src/lib/clusterArchive');
    const blob = (await buildTicketsFile('Exam', tickets as any, 'Английский язык', 'ru', []))!.blob;
    const p = await parseSubjectArchive(blob);
    expect(p.variants.length).toBe(2);
    expect(p.warnings.join(' ')).toContain('только английские');
  }, 120000);

  it('русский без таджикского по-прежнему ошибка (для химии и др. таджикская книжка нужна)', async () => {
    const { buildTicketsFile } = await import('../src/lib/docxExport');
    const { parseSubjectArchive } = await import('../src/lib/clusterArchive');
    const blob = (await buildTicketsFile('Экзамен', tickets as any, 'Химия', 'ru', []))!.blob;
    await expect(parseSubjectArchive(blob)).rejects.toThrow('нет таджикских вариантов');
  }, 120000);
});
