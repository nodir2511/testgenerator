import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

// Архив, скачанный из «Архива билетов» и положенный в папку («Экзамен 1/…»): ключи лежат не в корне, но находятся.
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
  id: `t${n}`, type: 'test', content: `Вопрос ${n}`, content_ru: `Вопрос ${n}`, content_tg: `Савол ${n}`,
  options: LET.map((x, i) => ({ id: `o${n}${i}`, text: `${x}${n}`, text_ru: `${x}${n}`, text_tg: `${x}${n}`, is_correct: i === n % 4, order_index: i + 1 })),
});
const tickets = [1, 2].map((v) => ({ ticket_number: v, questions: Array.from({ length: 20 }, (_, i) => ({ question_snapshot: test(i + 1) })) }));

describe('архив внутри папки', () => {
  it('ключи находятся в папке архива, предупреждения «нет ключей» нет', async () => {
    const { buildTicketsFile } = await import('../src/lib/docxExport');
    const { keyArchiveExtras } = await import('../src/lib/answerKeyExport');
    const { parseSubjectArchive } = await import('../src/lib/clusterArchive');
    const extras = await keyArchiveExtras('Экзамен', tickets as any, 'Биология', undefined, 'both');
    const flat = await JSZip.loadAsync(await (await buildTicketsFile('Экзамен', tickets as any, 'Биология', 'both', extras))!.blob.arrayBuffer());
    const nested = new JSZip();
    for (const n of Object.keys(flat.files)) {
      if (flat.files[n].dir) continue;
      nested.file(`Экзамен 1/${n}`, await flat.files[n].async('uint8array'));
    }
    nested.file('Экзамен 1/desktop.ini', 'x');
    nested.file('Экзамен 1/Русский/desktop.ini', 'x');
    const p = await parseSubjectArchive(await nested.generateAsync({ type: 'blob' }));
    expect(p.variants.length).toBe(2);
    expect(p.keyBytes).not.toBeNull();
    expect(p.warnings.join(' ')).not.toContain('нет файла ключей');
  }, 120000);
});
