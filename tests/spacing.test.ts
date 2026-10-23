import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildSingleTicketBlob } from '../src/lib/docxExport';

describe('отступ между вопросами', () => {
  it('пустой абзац между вопросами фиксированной высоты 10 pt', async () => {
    const q = { type: 'open', content: 'Вопрос', content_ru: 'Вопрос' };
    const blob = await buildSingleTicketBlob('Э', { ticket_number: 1, questions: [{ question_snapshot: q }, { question_snapshot: q }] }, 'Химия', false);
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    expect(xml).toContain('w:line="200"');
    expect(xml).toContain('w:lineRule="exact"');
    expect(xml.match(/w:lineRule="exact"/g)).toHaveLength(2); // по одному после каждого вопроса
  });
});

describe('плашка с номером вопроса', () => {
  it('растянута на высоту строки: верхняя рамка того же цвета и отступы рамок равны отступу ячейки', async () => {
    const q = { type: 'open', content: 'Вопрос', content_ru: 'Вопрос' };
    const blob = await buildSingleTicketBlob('Э', { ticket_number: 1, questions: [{ question_snapshot: q }] }, 'Химия', false);
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    const plate = xml.split('<w:pBdr>').map((p) => p.split('</w:pBdr>')[0]).find((p) => p.includes('D9D9D9'))!;
    expect(plate).toMatch(/<w:top [^>]*w:color="D9D9D9"[^>]*w:space="4"/);
    expect(plate).toMatch(/<w:bottom [^>]*w:space="4"/);
    expect(xml).not.toContain('w:after="40"');
  });
});
