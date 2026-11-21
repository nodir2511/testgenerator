import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

// Архив обычного генератора (RU + TJ с ключами) → разбор обратно → книжки кластера с ключами.
// Картинки и шаблоны читаются с диска, canvas подменён заглушкой (как в cluster.test.ts)
const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const realFetch = globalThis.fetch;
beforeAll(() => {
  (globalThis as any).fetch = async (url: string, init?: any) => {
    // blob: — картинки, вынутые из Word при разборе архива (как в браузере)
    if (String(url).startsWith('blob:')) return realFetch(url, init);
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
  const file = await buildClusterZip({ code: 'А.5', exam: 'Авг', date: '27.09' }, variants, { keys: true, readyKeys: parsed.map((p) => (p ? p.keyBytes : null)) });
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
        // ответы прочитаны из ключа архива и совпадают с исходными
        expect(v.noAnswer).toBe(0);
        const { testAnswer, matchingAnswer, openAnswer } = await import('../src/lib/answerKey');
        const src = ticket(v.number, c).questions.map((q) => q.question_snapshot);
        v.snaps.forEach((s, i) => {
          if (s.type === 'test') expect(testAnswer(s)).toBe(testAnswer(src[i]));
          if (s.type === 'matching') expect(matchingAnswer(s)).toEqual(matchingAnswer(src[i]));
          if (s.type === 'open') expect(openAnswer(s)).toBe(openAnswer(src[i]));
        });
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

  it('предмет архива определяется сам; ключ собирается и по ответам из архива (для истории)', async () => {
    const { parseSubjectArchive } = await import('../src/lib/clusterArchive');
    const { buildClusterZip } = await import('../src/lib/clusterExport');
    const kinds = ['taj', 'bio', 'chem', 'phys'];
    const parsed = [];
    for (let i = 0; i < 4; i++) {
      const p = await parseSubjectArchive(await archiveOf(SUBJECTS[i][0], SUBJECTS[i][1]));
      expect(p.kind).toBe(kinds[i]);
      parsed.push(p);
    }
    // без готовых ключей (readyKeys не заданы) ключи строятся по ответам, прочитанным из архивов
    const variants = [1, 2, 3, 4].map((n) => ({ number: n, subjects: parsed.map((p) => p.variants.find((v) => v.number === n)!.snaps) }));
    const file = await buildClusterZip({ code: 'А.5', exam: 'Авг', date: '27.09' }, variants);
    expect(file.missingAnswers).toBe(0);
    expect(file.keyOverflow).toBe(0);
  }, 120000);

  it('формулы (индексы, дробь) и рисунки доходят до книжки', async () => {
    const { buildTicketsFile } = await import('../src/lib/docxExport');
    const { parseSubjectArchive } = await import('../src/lib/clusterArchive');
    const { buildClusterZip } = await import('../src/lib/clusterExport');
    const rich = (t: any) => ({
      ...t,
      content: 'Формула H<sub>2</sub>O, x<sup>2</sup> и a/b', content_ru: 'Формула H<sub>2</sub>O, x<sup>2</sup> и a/b', content_tg: 'Формула H<sub>2</sub>O, x<sup>2</sup> и a/b',
      image_url: '/cluster-assets/grid.png',
      options: t.options.map((o: any, i: number) => (i === 0 ? { ...o, image_url: '/cluster-assets/grid.png' } : o)),
    });
    const tickets = [1, 2].map((v) => {
      const t = ticket(v, { test: 20, matching: 4, open: 2 });
      t.questions[0] = { question_snapshot: rich(t.questions[0].question_snapshot) };
      return t;
    });
    const blob = (await buildTicketsFile('Экзамен', tickets as any, 'Биология', 'both', [])).blob;
    const parsed = await parseSubjectArchive(blob);
    expect(parsed.keyBytes).toBeNull();
    const q = parsed.variants[0].snaps[0];
    expect(q.content_ru).toContain('H<sub>2</sub>O');
    expect(q.content_ru).toContain('x<sup>2</sup>');
    // дробь возвращается со скобками «(a)/(b)» и снова рисуется как дробь
    expect(q.content_ru).toMatch(/\(?a\)?\/\(?b\)?/);
    expect(q.image_url).toBeTruthy();
    expect(q.options[0].image_url).toBeTruthy();
    expect(q.options[1].image_url ?? null).toBeNull();

    const variants = parsed.variants.map((v) => ({ number: v.number, subjects: [null, v.snaps, null, null] }));
    const file = await buildClusterZip({ code: 'А.5', exam: 'Авг', date: '27.09' }, variants, { keys: false });
    const zip = await JSZip.loadAsync(await file.blob.arrayBuffer());
    for (const name of ['Русский/Вариант 1.docx', 'Тоҷикӣ/Варианти 1.docx']) {
      const dz = await JSZip.loadAsync(await zip.file(name)!.async('uint8array'));
      const xml = await dz.file('word/document.xml')!.async('string');
      expect(xml).toContain('w:val="subscript"'); // нижний индекс (H₂O)
      expect(xml).toContain('w:val="superscript"'); // верхний (x²)
      expect(xml).toContain('<m:f>'); // дробь
      // рисунок вопроса и рисунок варианта ответа: два изображения сверх обложки
      const media = Object.keys(dz.files).filter((n) => n.startsWith('word/media/'));
      expect(media.length).toBeGreaterThan(0);
      expect((xml.match(/<w:drawing>/g) || []).length).toBeGreaterThanOrEqual(2);
    }
  }, 120000);
});

describe('нестандартные имена файлов в архиве', () => {
  it('узнаёт варианты и ключ по номеру и папке; книжки получают стандартные имена', async () => {
    const { parseSubjectArchive } = await import('../src/lib/clusterArchive');
    const { buildClusterZip } = await import('../src/lib/clusterExport');
    const std = await JSZip.loadAsync(await (await archiveOf('Биология', { test: 20, matching: 4, open: 2 })).arrayBuffer());
    // те же файлы под другими именами и папками
    const odd = new JSZip();
    for (const v of [1, 2, 3, 4]) {
      odd.file(`РУС/вариант_${v}.docx`, await std.file(`Русский/Вариант ${v}.docx`)!.async('uint8array'));
      odd.file(`TJ/Вар ${v} тадж.docx`, await std.file(`Тоҷикӣ/Варианти ${v}.docx`)!.async('uint8array'));
    }
    const keyName = Object.keys(std.files).find((n) => n.startsWith('Ключи'))!;
    odd.file(`ключи/${keyName}`, await std.file(keyName)!.async('uint8array'));
    const parsed = await parseSubjectArchive(new File([await odd.generateAsync({ type: 'uint8array' })], 'моё.zip'));
    expect(parsed.variants.map((v) => v.number)).toEqual([1, 2, 3, 4]);
    expect(parsed.keyBytes).not.toBeNull();
    expect(parsed.kind).toBe('bio');
    expect(parsed.warnings.some((w) => w.includes('не по стандарту'))).toBe(true);
    const variants = parsed.variants.map((v) => ({ number: v.number, subjects: [null, v.snaps, null, null] }));
    const file = await buildClusterZip({ code: 'А.5', exam: 'Авг', date: '27.09' }, variants, { keys: true, readyKeys: [null, parsed.keyBytes, null, null] });
    const names = Object.keys((await JSZip.loadAsync(await file.blob.arrayBuffer())).files).filter((n) => /\.docx$/.test(n));
    expect(names).toContain('Русский/Вариант 3.docx');
    expect(names).toContain('Тоҷикӣ/Варианти 3.docx');
  }, 120000);
});

describe('таджикский архив без папки «Русский»', () => {
  it('читается: русская книжка получает тот же таджикский текст', async () => {
    const { parseSubjectArchive } = await import('../src/lib/clusterArchive');
    const std = await JSZip.loadAsync(await (await archiveOf('Таджикский язык', { test: 20, matching: 4, open: 2 })).arrayBuffer());
    const only = new JSZip();
    for (const n of Object.keys(std.files)) if (!std.files[n].dir && !n.startsWith('Русский/')) only.file(n, await std.files[n].async('uint8array'));
    const parsed = await parseSubjectArchive(new File([await only.generateAsync({ type: 'uint8array' })], 'Имтиҳон №1..zip'));
    expect(parsed.variants.map((v) => v.number)).toEqual([1, 2, 3, 4]);
    expect(parsed.kind).toBe('taj');
    expect(parsed.keyBytes).not.toBeNull();
    expect(parsed.warnings.some((w) => w.includes('только таджикские'))).toBe(true);
  }, 120000);
});
