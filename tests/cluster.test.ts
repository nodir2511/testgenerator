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

describe('меньше 4 предметов', () => {
  it('собирает книжку и ключи только по выбранным предметам', async () => {
    const { buildClusterZip, CLUSTER_SLOTS } = await import('../src/lib/clusterExport');
    const pick = [1, 3]; // биология и физика
    const variants = [{
      number: 1,
      subjects: CLUSTER_SLOTS.map((s, i) => pick.includes(i)
        ? [...Array.from({ length: s.counts.test }, (_, k) => test(k)), ...Array.from({ length: s.counts.matching }, (_, k) => matching(k)), ...Array.from({ length: s.counts.open }, (_, k) => open(k))]
        : null),
    }];
    const file = await buildClusterZip({ code: 'А.5', exam: 'Авг', date: '27.09' }, variants);
    const zip = await JSZip.loadAsync(await file.blob.arrayBuffer());
    const keys = Object.keys(zip.files).filter((n) => n.startsWith('Ключи/') && !zip.files[n].dir);
    expect(keys.length).toBe(2);
    expect(file.keyOverflow).toBe(0);
  });
});

describe('вводный абзац инструкции', () => {
  const text = (r: Array<{ text: string }>) => r.map((x) => x.text).join('');
  const all = [{ kind: 'taj', count: 26 }, { kind: 'bio', count: 26 }, { kind: 'chem', count: 27 }, { kind: 'phys', count: 27 }] as const;
  it('совпадает с образцом при 4 предметах', async () => {
    const { instructionIntro } = await import('../src/lib/clusterExport');
    expect(text(instructionIntro('ru', [...all]))).toBe('Тестовая книжка состоит из четырёх субтестов. В субтесты включены задания закрытого типа (с выбором ответа и на соответствие) и открытого типа: в субтестах по таджикскому языку и биологии – 26 заданий, по химии и физике – 27 заданий.');
    expect(text(instructionIntro('tj', [...all]))).toBe('Саволнома аз чор субтест иборат аст: забони тоҷикӣ, биология, химия ва физика. Субтестҳои забони тоҷикӣ ва биология 26 саволу масъала ва субтестҳои химия ва физика 27 саволу масъаларо дар бар мегиранд.');
  });
  it('подстраивается под меньшее число предметов', async () => {
    const { instructionIntro } = await import('../src/lib/clusterExport');
    expect(text(instructionIntro('ru', [all[2]]))).toBe('Тестовая книжка состоит из одного субтеста. В субтест включены задания закрытого типа (с выбором ответа и на соответствие) и открытого типа: в субтесте по химии – 27 заданий.');
    expect(text(instructionIntro('ru', [all[1], all[3]]))).toContain('двух субтестов');
    expect(text(instructionIntro('ru', [all[1], all[3]]))).toContain('в субтесте по биологии – 26 заданий, по физике – 27 заданий');
    expect(text(instructionIntro('tj', [all[2]]))).toBe('Саволнома аз як субтест иборат аст: химия. Субтести химия 27 саволу масъаларо дар бар мегирад.');
  });
});

describe('оформление книжки кластера', () => {
  it('вопросы не разрываются, у открытых клетки (5 у таджикского, 4 у остальных), у соответствия таблица ответа', async () => {
    const { buildClusterVariantBlob, CLUSTER_SLOTS } = await import('../src/lib/clusterExport');
    const variant = {
      number: 1,
      subjects: CLUSTER_SLOTS.map(() => [test(1), matching(1), open(1)]),
    };
    const blob = await buildClusterVariantBlob({ code: 'А.5', exam: 'Авг', date: '27.09' }, variant, 'ru');
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:cantSplit');
    expect(xml).toContain('<w:vMerge'); // таблица ответа на соответствие растянута на строки списка
    // клетки ответа: строка высотой 480 с (1 + N) ячейками — считаем строки с точной высотой
    expect((xml.match(/w:hRule="exact"/g) || []).length).toBe(4);
    const rows = xml.match(/<w:tr>(?:(?!<\/w:tr>)[\s\S])*?w:hRule="exact"[\s\S]*?<\/w:tr>/g) || [];
    const counts = rows.map((r) => (r.match(/<w:tc>/g) || []).length);
    // таджикский на одну клетку длиннее остальных (вложенность добавляет одинаковое смещение)
    expect(counts[0] - counts[1]).toBe(1);
    expect(new Set(counts.slice(1)).size).toBe(1);
  });
});

describe('хранение кластера', () => {
  it('варианты восстанавливаются из сохранённой партии в том же порядке', async () => {
    const { clusterVariantsFromBatch } = await import('../src/lib/clusterStore');
    const snap = (id: string, slot: number) => ({ id, type: 'test', cluster_slot: slot });
    // Порядок строк в базе произвольный, порядок книжки задаёт order_index
    const tickets = [{
      ticket_number: 2,
      questions: [
        { order_index: 3, question_snapshot: snap('c', 3) },
        { order_index: 1, question_snapshot: snap('a', 1) },
        { order_index: 2, question_snapshot: snap('b', 1) },
      ],
    }, { ticket_number: 1, questions: [{ order_index: 1, question_snapshot: snap('x', 0) }] }];
    const v = clusterVariantsFromBatch(tickets);
    expect(v.map((x) => x.number)).toEqual([1, 2]);
    expect(v[1].subjects.map((s) => s && s.map((q) => q.id))).toEqual([null, ['a', 'b'], null, ['c']]);
    expect(v[0].subjects[0]!.length).toBe(1);
  });
});

describe('химия и физика: надпись под последним вопросом страницы', () => {
  it('страницы расставлены, надпись стоит после каждой группы вопросов', async () => {
    const { buildClusterVariantBlob, CLUSTER_SLOTS } = await import('../src/lib/clusterExport');
    const variant = {
      number: 1,
      subjects: CLUSTER_SLOTS.map((s) => s.kind === 'chem'
        ? [
          ...Array.from({ length: 18 }, (_, i) => test(i)),
          ...Array.from({ length: 2 }, (_, i) => matching(i)),
          ...Array.from({ length: 7 }, (_, i) => open(i)),
        ]
        : [test(1)]),
    };
    const blob = await buildClusterVariantBlob({ code: 'А.5', exam: 'Авг', date: '27.09' }, variant, 'ru');
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    const labels = (xml.match(/Место для черновика/g) || []).length;
    const breaks = (xml.match(/<w:pageBreakBefore/g) || []).length;
    // у физики один вопрос = одна страница с надписью; у химии 27 вопросов не помещаются на одной
    expect(labels).toBeGreaterThanOrEqual(3);
    expect(breaks).toBeGreaterThanOrEqual(2);
    // надпись на каждой странице: разрывов на 2 меньше (первые страницы химии и физики без разрыва), плюс один разрыв страницы инструкции
    expect(labels).toBe(breaks - 1 + 2);
  });
});
