import {
  Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, Footer, PageNumber, TabStopType, SectionType, VerticalAlign,
} from 'docx';
import JSZip from 'jszip';
import { createQuestionTable } from './docxExport';
import { buildAnswerKeyFile } from './answerKeyExport';

// Кластерный экзамен: тестовая книжка из 4 предметов (таджикский язык, биология, химия, физика)
// в оформлении образца «Тестовая книжка»: обложка, инструкция, субтесты, справочные материалы.
// Статичные части (шапка, инструкция, справочные страницы) вырезаны из PDF образца и лежат в
// public/cluster-assets/{ru|tj}_*.png. Дата, номер варианта и код компонента подставляются здесь.

export type ClusterLang = 'ru' | 'tj';
export type ClusterKind = 'taj' | 'bio' | 'chem' | 'phys';

export interface ClusterSettings {
  /** Код кластера, например «А.5» */
  code: string;
  /** Название экзамена, например «Авг» */
  exam: string;
  /** Дата на обложке, например «27.09» */
  date: string;
}

/** Предметы книжки в порядке следования */
export const CLUSTER_SLOTS: Array<{ kind: ClusterKind; name: string; counts: { test: number; matching: number; open: number } }> = [
  { kind: 'taj', name: 'Таджикский язык', counts: { test: 20, matching: 4, open: 2 } },
  { kind: 'bio', name: 'Биология', counts: { test: 20, matching: 4, open: 2 } },
  { kind: 'chem', name: 'Химия', counts: { test: 18, matching: 2, open: 7 } },
  { kind: 'phys', name: 'Физика', counts: { test: 18, matching: 2, open: 7 } },
];

export interface ClusterVariant {
  number: number;
  /** Снимки вопросов по предметам, в порядке CLUSTER_SLOTS; внутри — по порядку в книжке; null — предмет не входит в экзамен */
  subjects: Array<any[] | null>;
}

const FONT = 'Times New Roman';
const CONTENT_TWIPS = 9638; // A4 минус поля по 20 мм
const MARGIN = { top: 1134, bottom: 1134, left: 1134, right: 1134 };
// У химии и физики часть каждой страницы оставляется свободной под черновик
const DRAFT_SHARE = 0.35;
const A4_HEIGHT_TWIPS = 16838;
const DRAFT_BOTTOM = MARGIN.bottom + Math.round(DRAFT_SHARE * (A4_HEIGHT_TWIPS - MARGIN.top - MARGIN.bottom));
const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const NO_CELL_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };

const L = {
  ru: {
    component: 'Компонент', variant: 'Вариант', instruction: 'Инструкция',
    subjects: { taj: 'Таджикский язык', bio: 'Биология', chem: 'Химия', phys: 'Физика' },
    bands: { taj: 'ТАДЖИКСКИЙ ЯЗЫК', bio: 'БИОЛОГИЯ', chem: 'ХИМИЯ', phys: 'ФИЗИКА' },
    aux: { chem: 'Вспомогательный материал по химии', phys: 'Вспомогательный материал по физике' },
  },
  tj: {
    component: 'Қисми', variant: 'Варианти', instruction: 'Дастур',
    subjects: { taj: 'Забони тоҷикӣ', bio: 'Биология', chem: 'Химия', phys: 'Физика' },
    bands: { taj: 'ЗАБОНИ ТОҶИКӢ', bio: 'БИОЛОГИЯ', chem: 'ХИМИЯ', phys: 'ФИЗИКА' },
    aux: { chem: 'Маводи ёрирасон аз фанни химия', phys: 'Маводи ёрирасон аз фанни физика' },
  },
} as const;

// Плашка с датой на картинке «Тестовая книжка 2026» (пиксели вырезки)
const PILL = {
  ru: { x: 1062, y: 25, w: 330, h: 93 },
  tj: { x: 1062, y: 10, w: 333, h: 92 },
};

const assetCache = new Map<string, Promise<Uint8Array>>();
function asset(lang: ClusterLang, name: string): Promise<Uint8Array> {
  const url = `/cluster-assets/${lang}_${name}.png`;
  if (!assetCache.has(url)) {
    assetCache.set(url, (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Не найдена картинка шаблона: ${url}`);
      return new Uint8Array(await res.arrayBuffer());
    })().catch((e) => { assetCache.delete(url); throw e; }));
  }
  return assetCache.get(url)!;
}

function pngSize(b: Uint8Array): { w: number; h: number } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

// Картинка по ширине (px при 96 dpi: 640 px = ширина текста страницы)
function imgPara(data: Uint8Array, widthPx: number, opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; before?: number; pageBreakBefore?: boolean; maxHeightPx?: number } = {}) {
  const { w, h } = pngSize(data);
  let width = widthPx;
  let height = Math.round((widthPx * h) / w);
  if (opts.maxHeightPx && height > opts.maxHeightPx) {
    height = opts.maxHeightPx;
    width = Math.round((height * w) / h);
  }
  return new Paragraph({
    alignment: opts.align ?? AlignmentType.CENTER,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 120 },
    pageBreakBefore: opts.pageBreakBefore,
    children: [new ImageRun({ type: 'png', data, transformation: { width, height } })],
  });
}

function imgRun(data: Uint8Array, widthPx: number) {
  const { w, h } = pngSize(data);
  return new ImageRun({ type: 'png', data, transformation: { width: widthPx, height: Math.round((widthPx * h) / w) } });
}

async function canvasToPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('canvas'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

function roundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// «Тестовая книжка 2026» с датой на серой плашке
async function titleWithDate(lang: ClusterLang, date: string): Promise<Uint8Array> {
  const base = await asset(lang, 'title');
  const bmp = await createImageBitmap(new Blob([base as BlobPart], { type: 'image/png' }));
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  const p = PILL[lang];
  g.fillStyle = '#7f807f';
  roundedRect(g, p.x, p.y, p.w, p.h, 28);
  g.fill();
  g.font = `bold 64px "${FONT}", serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#b4b4b4';
  g.shadowOffsetX = 3;
  g.shadowOffsetY = 3;
  g.fillStyle = '#ffffff';
  g.fillText(date, p.x + p.w / 2, p.y + p.h / 2 + 4, p.w - 40);
  return canvasToPng(c);
}

// Крупный номер варианта: светлая цифра с тёмным контуром и тенью
async function bigNumber(n: number): Promise<Uint8Array> {
  const text = String(n);
  const c = document.createElement('canvas');
  c.width = 190 * text.length + 40;
  c.height = 340;
  const g = c.getContext('2d')!;
  g.font = `bold 300px "${FONT}", serif`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const x = c.width / 2;
  const y = 300;
  g.fillStyle = '#b4b4b4';
  g.fillText(text, x + 9, y + 9);
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = '#6a6a6a';
  g.strokeText(text, x, y);
  g.fillStyle = '#ffffff';
  g.fillText(text, x, y);
  return canvasToPng(c);
}

const run = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
  new TextRun({ text, bold: o.bold, size: o.size ?? 28, color: o.color, font: FONT });

function pill(text: string) {
  return new TableCell({
    width: { size: 4300, type: WidthType.DXA },
    borders: NO_CELL_BORDERS,
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'D9D9D9' },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(text, { bold: true, size: 36 })] })],
  });
}

function footer(label: string) {
  return new Footer({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_TWIPS }],
      children: [
        run(label, { size: 24 }),
        new TextRun({ children: ['\t', PageNumber.CURRENT], font: FONT, size: 28 }),
      ],
    })],
  });
}

function band(text: string) {
  return new Table({
    width: { size: CONTENT_TWIPS, type: WidthType.DXA },
    columnWidths: [CONTENT_TWIPS],
    borders: NO_BORDERS,
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: CONTENT_TWIPS, type: WidthType.DXA },
        borders: NO_CELL_BORDERS,
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'D9D9D9' },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 }, children: [run(text, { bold: true, size: 28 })] })],
      })],
    })],
  });
}

// Вводный абзац инструкции: сколько субтестов и сколько в них заданий (зависит от выбранных предметов)
const NUM_WORDS = {
  ru: ['', 'одного', 'двух', 'трёх', 'четырёх'],
  tj: ['', 'як', 'ду', 'се', 'чор'],
};
const NAMES_RU: Record<ClusterKind, string> = { taj: 'таджикскому языку', bio: 'биологии', chem: 'химии', phys: 'физике' };

function tasksWord(n: number): string {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return 'задание';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'задания';
  return 'заданий';
}

function joinNames(names: string[], and: string): Array<{ text: string; bold?: boolean }> {
  const out: Array<{ text: string; bold?: boolean }> = [];
  names.forEach((n, i) => {
    if (i > 0) out.push({ text: i === names.length - 1 ? ` ${and} ` : ', ' });
    out.push({ text: n, bold: true });
  });
  return out;
}

export function instructionIntro(lang: ClusterLang, subjects: Array<{ kind: ClusterKind; count: number }>): Array<{ text: string; bold?: boolean }> {
  const n = subjects.length;
  // Предметы с одинаковым числом заданий объединяются в одну группу
  const groups: Array<{ count: number; kinds: ClusterKind[] }> = [];
  for (const s of subjects) {
    const g = groups.find((x) => x.count === s.count);
    if (g) g.kinds.push(s.kind); else groups.push({ count: s.count, kinds: [s.kind] });
  }
  const tj = L.tj.subjects;
  if (lang === 'ru') {
    const out: Array<{ text: string; bold?: boolean }> = [
      { text: `Тестовая книжка состоит из ${NUM_WORDS.ru[n]} субтест${n === 1 ? 'а' : 'ов'}. В субтест${n === 1 ? '' : 'ы'} включены задания закрытого типа (с выбором ответа и на соответствие) и открытого типа: ` },
    ];
    groups.forEach((g, i) => {
      if (i > 0) out.push({ text: ', по ' });
      else out.push({ text: g.kinds.length > 1 ? 'в субтестах по ' : 'в субтесте по ' });
      out.push(...joinNames(g.kinds.map((k) => NAMES_RU[k]), 'и'));
      out.push({ text: ` – ${g.count} ${tasksWord(g.count)}` });
    });
    out.push({ text: '.' });
    return out;
  }
  const out: Array<{ text: string; bold?: boolean }> = [{ text: `Саволнома аз ${NUM_WORDS.tj[n]} субтест иборат аст: ` }];
  out.push(...joinNames(subjects.map((s) => tj[s.kind].toLowerCase()), 'ва'));
  out.push({ text: '. ' });
  groups.forEach((g, i) => {
    if (i > 0) out.push({ text: ' ва ' });
    const head = g.kinds.length > 1 ? 'субтестҳои ' : 'субтести ';
    out.push({ text: i > 0 ? head : head[0].toUpperCase() + head.slice(1) });
    out.push(...joinNames(g.kinds.map((k) => tj[k].toLowerCase()), 'ва'));
    out.push({ text: ` ${g.count} саволу масъала` });
  });
  out.push({ text: n === 1 ? 'ро дар бар мегирад.' : 'ро дар бар мегиранд.' });
  return out;
}

const gap = (after = 180) => new Paragraph({ spacing: { after }, children: [] });

/** Один вариант книжки на одном языке */
export async function buildClusterVariantBlob(settings: ClusterSettings, variant: ClusterVariant, lang: ClusterLang): Promise<Blob> {
  const t = L[lang];
  const isTg = lang === 'tj';
  const comp = `${settings.code}-${variant.number}`;
  const footLabel = (part: string) => `${t.component} ${comp} – ${part}`;
  const page = { margin: MARGIN };

  const included = CLUSTER_SLOTS.map((_, s) => variant.subjects[s] != null);
  const [header, subjectImgs, attention, instr1Top, instr1Rest, instr2, plaque, auxPhys, auxChem, title, digit] = await Promise.all([
    asset(lang, 'header'), Promise.all(CLUSTER_SLOTS.map((s, i) => (included[i] ? asset(lang, `subj_${s.kind}`) : Promise.resolve(new Uint8Array())))), asset(lang, 'attention'), asset(lang, 'instr1_top'), asset(lang, 'instr1_rest'), asset(lang, 'instr2'),
    asset(lang, 'plaque'), asset(lang, 'aux_phys'), asset(lang, 'aux_chem'), titleWithDate(lang, settings.date), bigNumber(variant.number),
  ]);

  // Обложка
  const coverTable = new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [4300, 400, 4300],
    alignment: AlignmentType.CENTER,
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          pill(`${t.component} ${settings.code}-${settings.exam}`),
          new TableCell({ width: { size: 400, type: WidthType.DXA }, borders: NO_CELL_BORDERS, children: [new Paragraph({ children: [] })] }),
          pill(t.variant),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            width: { size: 4300, type: WidthType.DXA }, borders: NO_CELL_BORDERS, verticalAlign: VerticalAlign.CENTER,
            margins: { top: 200, bottom: 100, left: 300, right: 0 },
            children: CLUSTER_SLOTS.flatMap((_, s) => (included[s] ? [new Paragraph({ spacing: { after: 20 }, children: [imgRun(subjectImgs[s], 270)] })] : [])),
          }),
          new TableCell({ width: { size: 400, type: WidthType.DXA }, borders: NO_CELL_BORDERS, children: [new Paragraph({ children: [] })] }),
          new TableCell({
            width: { size: 4300, type: WidthType.DXA }, borders: NO_CELL_BORDERS, verticalAlign: VerticalAlign.CENTER,
            margins: { top: 200, bottom: 100, left: 0, right: 0 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [imgRun(digit, variant.number >= 10 ? 220 : 130)] })],
          }),
        ],
      }),
    ],
  });

  const cover = [
    imgPara(header, 600, { after: 200 }),
    imgPara(title, 560, { after: 360 }),
    coverTable,
    gap(240),
    imgPara(attention, 600, { after: 0 }),
  ];

  // Инструкция (2 страницы)
  const instruction = [
    imgPara(instr1Top, 640, { after: 60 }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      indent: { firstLine: 560 },
      spacing: { after: 0 },
      children: instructionIntro(lang, CLUSTER_SLOTS.flatMap((s, i) => (included[i] ? [{ kind: s.kind, count: variant.subjects[i]!.length }] : [])))
        .map((r) => run(r.text, { bold: r.bold, size: 26 })),
    }),
    imgPara(instr1Rest, 640, { after: 0 }),
    imgPara(instr2, 640, { after: 0, pageBreakBefore: true }),
  ];

  const sections: any[] = [
    { properties: { page }, children: cover },
    { properties: { page, type: SectionType.NEXT_PAGE }, footers: { default: footer(footLabel(t.instruction)) }, children: instruction },
  ];

  // Субтесты
  for (let s = 0; s < CLUSTER_SLOTS.length; s++) {
    const kind = CLUSTER_SLOTS[s].kind;
    const qs = variant.subjects[s];
    if (!qs) continue;
    const children: any[] = [band(t.bands[kind]), gap(160)];
    for (let i = 0; i < qs.length; i++) {
      children.push(await createQuestionTable(qs[i], i + 1, isTg));
      children.push(gap(180));
    }
    children.push(imgPara(plaque, 600, { before: 120, after: 0 }));
    const subjectPage = kind === 'chem' || kind === 'phys' ? { margin: { ...MARGIN, bottom: DRAFT_BOTTOM } } : page;
    sections.push({ properties: { page: subjectPage, type: SectionType.NEXT_PAGE }, footers: { default: footer(footLabel(t.subjects[kind])) }, children });
  }

  // Справочные материалы (как в образце: физика, затем химия) — только для включённых предметов
  const physIdx = CLUSTER_SLOTS.findIndex((s) => s.kind === 'phys');
  const chemIdx = CLUSTER_SLOTS.findIndex((s) => s.kind === 'chem');
  if (included[physIdx]) {
    sections.push({
      properties: { page, type: SectionType.NEXT_PAGE }, footers: { default: footer(footLabel(t.aux.phys)) },
      children: [imgPara(auxPhys, 640, { after: 0, maxHeightPx: 940 })],
    });
  }
  if (included[chemIdx]) {
    sections.push({
      properties: { page, type: SectionType.NEXT_PAGE }, footers: { default: footer(footLabel(t.aux.chem)) },
      children: [imgPara(auxChem, 640, { after: 0, maxHeightPx: 940 })],
    });
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 28 } } } },
    sections,
  });
  return Packer.toBlob(doc);
}

export interface ClusterFile { blob: Blob; fileName: string; missingAnswers: number; keyOverflow: number }

/** ZIP: Русский/Вариант N.docx, Тоҷикӣ/Варианти N.docx и Ключи/Ключи – <предмет>.docx (все варианты) */
export async function buildClusterZip(settings: ClusterSettings, variants: ClusterVariant[]): Promise<ClusterFile> {
  const zip = new JSZip();
  for (const v of variants) {
    zip.file(`Русский/Вариант ${v.number}.docx`, await buildClusterVariantBlob(settings, v, 'ru'));
    zip.file(`Тоҷикӣ/Варианти ${v.number}.docx`, await buildClusterVariantBlob(settings, v, 'tj'));
  }

  // Ключи по каждому предмету: все варианты на отдельных страницах (шаблоны ключей)
  let missingAnswers = 0;
  let overflow = 0;
  for (let s = 0; s < CLUSTER_SLOTS.length; s++) {
    if (variants.some((v) => v.subjects[s] == null)) continue;
    const tickets = variants.map((v) => ({
      ticket_number: v.number,
      questions: (v.subjects[s] || []).map((q) => ({ question_snapshot: q })),
    }));
    const slot = CLUSTER_SLOTS[s];
    // У таджикского в кластере 20 + 4 + 2: обычный шаблон ключей рассчитан на 5 соответствий, поэтому свой
    const key = await buildAnswerKeyFile(`${settings.code}-${settings.exam} – ${slot.name}`, tickets, slot.name, undefined, slot.kind === 'taj' ? 'taj-cluster' : undefined);
    missingAnswers += key.stats.missing;
    overflow += key.stats.overflow;
    zip.file(`Ключи/${key.fileName}`, key.blob);
  }

  const safe = `${settings.code}-${settings.exam}`.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim() || 'Кластер';
  return { blob: await zip.generateAsync({ type: 'blob' }), fileName: `Кластер ${safe}.zip`, missingAnswers, keyOverflow: overflow };
}
