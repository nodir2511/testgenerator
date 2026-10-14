import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

// Сборка кластерной книжки без браузера: картинки читаются с диска, canvas подменён заглушкой
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

const test = (n: number) => ({
  id: `t${n}`, type: 'test', content: `Вопрос ${n}`, content_ru: `Вопрос ${n}`, content_tg: `Савол ${n}`,
  options: ['A', 'B', 'C', 'D'].map((x, i) => ({ id: `o${n}${i}`, text: x, text_ru: x, text_tg: x, is_correct: i === 1, order_index: i + 1 })),
});
const matching = (n: number) => {
  const right = [1, 2, 3, 4, 5].map((i) => ({ id: `r${n}${i}`, side: 'right', text: `R${i}`, order_index: i }));
  const left = [1, 2, 3, 4].map((i) => ({ id: `l${n}${i}`, side: 'left', text: `L${i}`, order_index: i, correct_match_id: `r${n}${i}` }));
  return { id: `m${n}`, type: 'matching', content: `Соотнесите ${n}`, content_ru: `Соотнесите ${n}`, content_tg: `Мувофиқ ${n}`, matching_items: [...left, ...right] };
};
const open = (n: number) => ({ id: `p${n}`, type: 'open', content: `Открытый ${n}`, content_ru: `Открытый ${n}`, content_tg: `Кушода ${n}`, correct_numeric_answer: 268 });

describe('кластер', () => {
  it('собирает zip: 2 языка + 4 ключа, ключи заполняются без переполнения шаблонов', async () => {
    const { buildClusterZip, CLUSTER_SLOTS } = await import('../src/lib/clusterExport');
    const variants = [1, 2].map((v) => ({
      number: v,
      subjects: CLUSTER_SLOTS.map((s) => [
        ...Array.from({ length: s.counts.test }, (_, i) => test(i)),
        ...Array.from({ length: s.counts.matching }, (_, i) => matching(i)),
        ...Array.from({ length: s.counts.open }, (_, i) => open(i)),
      ]),
    }));
    const file = await buildClusterZip({ code: 'А.5', exam: 'Авг', date: '27.09' }, variants);
    const zip = await JSZip.loadAsync(await file.blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    console.log(names);
    expect(names).toContain('Русский/Вариант 1.docx');
    expect(names).toContain('Тоҷикӣ/Варианти 2.docx');
    expect(names.filter((n) => n.startsWith('Ключи/')).length).toBe(4);
    expect(file.missingAnswers).toBe(0);
    expect(file.keyOverflow).toBe(0);
  });
});

describe('шаблоны ключей и рамка', () => {
  it('в шаблонах ключей хватает мест под состав кластера', async () => {
    const { buildAnswerKeyFile } = await import('../src/lib/answerKeyExport');
    const { CLUSTER_SLOTS } = await import('../src/lib/clusterExport');
    for (const s of CLUSTER_SLOTS) {
      const qs = [
        ...Array.from({ length: s.counts.test }, (_, i) => test(i)),
        ...Array.from({ length: s.counts.matching }, (_, i) => matching(i)),
        ...Array.from({ length: s.counts.open }, (_, i) => open(i)),
      ].map((q) => ({ question_snapshot: q }));
      const f = await buildAnswerKeyFile('x', [{ ticket_number: 1, questions: qs }], s.name, undefined, s.kind === 'taj' ? 'taj-cluster' : undefined);
      console.log(s.name, f.stats);
      expect(f.stats.overflow, s.name).toBe(0);
    }
  });

  it('у вопроса есть рамка сверху и номер в рамке', async () => {
    const { createQuestionTable } = await import('../src/lib/docxExport');
    const { Packer, Document } = await import('docx');
    const t = await createQuestionTable(test(1), 7, false);
    const buf = await Packer.toBuffer(new Document({ sections: [{ children: [t] }] }));
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
    expect((xml.match(/<w:top w:val="single"/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(xml).toContain('<w:left w:val="single"');
  });
});
