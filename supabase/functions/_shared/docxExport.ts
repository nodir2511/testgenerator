// @ts-nocheck
// АВТОГЕНЕРАЦИЯ: scripts/sync-docx-shared.mjs. Не редактируйте вручную — правьте src/lib/docxExport.ts.
import { 
  Document, 
  Packer, 
  Paragraph as DocxParagraph, 
  TextRun, 
  ImageRun, 
  AlignmentType, 
  Table, 
  TableRow, 
  TableCell, 
  WidthType, 
  BorderStyle,
  ShadingType,
  HeightRule,
  LineRuleType,
  VerticalAlign,
  Math as DocxMath,
  MathFraction,
  MathRun,
  MathSubScript,
  MathSuperScript,
  MathSubSuperScript,
  type MathComponent,
  type ParagraphChild
} from 'npm:docx@9';
import { splitFractions, type MathNode, newFmtState, tokenizeFormatted } from './fractions.ts';

// Абзацы «держатся» со следующим: вместе с cantSplit у строк это не даёт вопросу с вариантами
// разорваться между страницами (у последней строки таблицы вопроса признак снимается, см. keepTogether)
class Paragraph extends DocxParagraph {
  constructor(options: ConstructorParameters<typeof DocxParagraph>[0]) {
    super(typeof options === 'string' ? options : { keepNext: true, keepLines: true, ...options });
  }
}

// Основной шрифт — 14 pt (в половинках пункта)
const FONT_SIZE = 28;
const FONT_PT = FONT_SIZE / 2;

// Грубая оценка ширины текста Times New Roman в em (индексы уже, дроби считаются как обычный текст)
function charEm(c: string): number {
  if (c === ' ') return 0.25;
  if (/[0-9]/.test(c)) return 0.5;
  if (/[+=<>±−]/.test(c)) return 0.56;
  if (/[→←⇄⇌↑↓]/.test(c)) return 1;
  if (/[()[\]\-/]/.test(c)) return 0.34;
  if (/[.,:;'!]/.test(c)) return 0.27;
  if (/[iljtfI]/.test(c)) return 0.3;
  if (/[mwMWЖШЩЫЮжшщфюы]/.test(c)) return 0.78;
  if (/[A-ZА-ЯЁҶҚҒӢӮҲ]/.test(c)) return 0.7;
  return 0.48;
}

function textWidthEm(text: string): number {
  let w = 0;
  let scale = 1;
  for (const part of (text || '').split(/(<\/?(?:sub|sup|b|i|u)>)/)) {
    if (part === '<sub>' || part === '<sup>') { scale = 0.6; continue; }
    if (part === '</sub>' || part === '</sup>') { scale = 1; continue; }
    if (/^<\/?[biu]>$/.test(part)) continue;
    for (const c of part) w += charEm(c) * scale;
  }
  return w;
}

// Ширина варианта вместе с меткой «A) » в пунктах, с запасом на разницу шрифтов
function optionWidthPt(text: string): number {
  return (textWidthEm(text) + 1.35) * FONT_PT * 1.1;
}

// Рамки таблицы невидимы (BorderStyle.NONE)
const NO_TABLE_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
};

const NO_CELL_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
};

// Рамка сверху у первой строки вопроса: линия над текстом вопроса и номер в рамке
const FRAME_LINE = { style: BorderStyle.SINGLE, size: 8, color: '000000' };
const QUESTION_TOP_BORDERS = { ...NO_CELL_BORDERS, top: FRAME_LINE };
const NUMBER_CELL_BORDERS = { ...NO_CELL_BORDERS, top: FRAME_LINE };
const NUMBER_SHADING = { type: ShadingType.CLEAR, color: 'auto', fill: 'D9D9D9' };
const NUMBER_PLATE_LINE = { style: BorderStyle.SINGLE, size: 4, color: '7F7F7F', space: 0 };

// Внутренние отступы ячеек таблицы для чистого выравнивания
const CELL_MARGINS = {
  top: 80,
  bottom: 80,
  left: 100,
  right: 100,
};

// Свободная ширина ячейки в пунктах
const cellInnerPt = (twips: number) => (twips - CELL_MARGINS.left - CELL_MARGINS.right) / 20;

// Отступы ячейки с номером вопроса
const NUMBER_CELL_MARGINS = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};

const imageCache = new Map<string, Promise<Uint8Array | null>>();
function fetchImageBuffer(url: string): Promise<Uint8Array | null> {
  if (!imageCache.has(url)) imageCache.set(url, loadImageBuffer(url));
  return imageCache.get(url)!;
}

async function loadImageBuffer(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return new Uint8Array(arrayBuf);
  } catch (err) {
    console.warn('Не удалось загрузить изображение для Word:', url, err);
    return null;
  }
}

// Размеры картинки из заголовка (WebP/PNG/JPEG), чтобы не растягивать её под фиксированную рамку
function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const u16 = (o: number) => (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ascii = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  try {
    if (b.length > 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return { w: u32(16), h: u32(20) };
    if (b.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      const kind = ascii(12, 4);
      if (kind === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
      if (kind === 'VP8L') {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (kind === 'VP8X') return { w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let o = 2;
      while (o + 9 < b.length) {
        if (b[o] !== 0xff) { o++; continue; }
        const m = b[o + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: u16(o + 5), w: u16(o + 7) };
        o += 2 + u16(o + 2);
      }
    }
  } catch {
    /* неизвестный формат */
  }
  return null;
}

// Вписывает картинку в рамку maxW×maxH с сохранением пропорций (увеличение не больше maxScale)
function fitImage(data: Uint8Array, maxW: number, maxH: number, maxScale = 1): { width: number; height: number } {
  const sz = imageSize(data);
  if (!sz || !sz.w || !sz.h) return { width: maxW, height: maxH };
  const k = Math.min(maxW / sz.w, maxH / sz.h, maxScale);
  return { width: Math.max(1, Math.round(sz.w * k)), height: Math.max(1, Math.round(sz.h * k)) };
}

// Текст внутри формулы Word: индексы <sub>/<sup> превращаются в настоящие индексы формулы
function buildMathRuns(text: string): MathComponent[] {
  const out: MathComponent[] = [];
  const re = /(<sub>[\s\S]*?<\/sub>)?(<sup>[\s\S]*?<\/sup>)?/y;
  let plain = '';
  let i = 0;
  const flush = (keep = 0) => {
    const t = plain.slice(0, plain.length - keep);
    if (t) out.push(new MathRun(t));
    const base = plain.slice(plain.length - keep);
    plain = '';
    return base;
  };
  while (i < text.length) {
    re.lastIndex = i;
    const m = re.exec(text);
    if (m && m[0]) {
      // основание индекса: последнее число целиком или последний символ
      const tail = /\d+(?:\.\d+)?$/.exec(plain)?.[0] || plain.slice(-1);
      const base = flush(tail.length) || ' ';
      const sub = m[1] ? m[1].replace(/<\/?sub>/g, '') : '';
      const sup = m[2] ? m[2].replace(/<\/?sup>/g, '') : '';
      const children = [new MathRun(base)];
      if (sub && sup) out.push(new MathSubSuperScript({ children, subScript: [new MathRun(sub)], superScript: [new MathRun(sup)] }));
      else if (sub) out.push(new MathSubScript({ children, subScript: [new MathRun(sub)] }));
      else out.push(new MathSuperScript({ children, superScript: [new MathRun(sup)] }));
      i += m[0].length;
    } else {
      plain += text[i];
      i++;
    }
  }
  flush();
  return out;
}

function buildMathNodes(nodes: MathNode[]): MathComponent[] {
  return nodes.flatMap((n) => (typeof n === 'string' ? buildMathRuns(n.replace(/<\/?(b|i|u)>/g, '')) : [buildMathFraction(n)]));
}

function buildMathFraction(node: Exclude<MathNode, string>): MathFraction {
  return new MathFraction({ numerator: buildMathNodes(node.num), denominator: buildMathNodes(node.den) });
}

// Парсер форматированного текста (sub, sup, b, i, u); дроби (a/b) становятся формулами Word
export function parseFormattedTextRuns(
  text: string,
  isItalic = false,
  fontSize = FONT_SIZE,
  isBold = false
): ParagraphChild[] {
  if (!text) return [];
  const out: ParagraphChild[] = [];
  const state = newFmtState(); // оформление переносится через дроби: <i>v = s/t</i>
  for (const node of splitFractions(text)) {
    if (typeof node === 'string') {
      for (const t of tokenizeFormatted(node, state)) {
        out.push(
          new TextRun({
            text: t.text,
            font: 'Times New Roman',
            size: fontSize,
            bold: isBold || t.b,
            italics: isItalic || t.i,
            underline: t.u ? {} : undefined,
            subScript: t.sub || undefined,
            superScript: t.sup || undefined,
          })
        );
      }
    } else {
      out.push(new DocxMath({ children: [buildMathFraction(node)] }));
    }
  }
  return out;
}

// Создание ячейки номера вопроса (серая плашка в одну строку)
function createNumberCell(qNumber: number): TableCell {
  return new TableCell({
    width: { size: 500, type: WidthType.DXA },
    margins: NUMBER_CELL_MARGINS,
    borders: NUMBER_CELL_BORDERS,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        // Серая плашка задана у абзаца, а не у ячейки: она остаётся в одну строку, даже если вопрос длинный
        shading: NUMBER_SHADING,
        border: { bottom: NUMBER_PLATE_LINE, left: NUMBER_PLATE_LINE, right: NUMBER_PLATE_LINE },
        spacing: { before: 0, after: 40 },
        children: [
          new TextRun({ text: String(qNumber), bold: true, font: 'Times New Roman', size: 28 }),
        ],
      }),
    ],
  });
}

// Создание пустой ячейки под номером для выравнивания
function createEmptyNumCell(margins = CELL_MARGINS): TableCell {
  return new TableCell({
    width: { size: 500, type: WidthType.DXA },
    margins,
    borders: NO_CELL_BORDERS,
    children: [new Paragraph({ children: [] })],
  });
}

// Необязательное оформление вопроса (экзамен-кластер)
export interface QuestionOpts {
  /** Ответ открытого вопроса — ряд клеток (по одной на цифру) вместо линии */
  openBoxes?: number;
  /** Картинка таблицы для ответа на соответствие (A–D × 1–5), ставится справа от списков */
  matchingGrid?: Uint8Array;
  /** Подпись над таблицей ответа («Ответ:» / «Ҷавоб:») */
  matchingGridLabel?: string;
  /** Меньше пустого места между вопросом и вариантами ответа и между самими вариантами */
  compact?: boolean;
}

const COMPACT_MARGINS = { top: 20, bottom: 20, left: 100, right: 100 };

// «Ответ: □□□□» — подпись и ряд клеток по числу цифр
function createAnswerBoxes(label: string, n: number): Table {
  const BOX = 480;
  const GAP = 90; // зазор между клетками: каждая клетка — отдельный квадрат
  const LABEL = 1700;
  const line = { style: BorderStyle.SINGLE, size: 8, color: '000000' };
  const cells = Array.from({ length: n }, (_, i) => [
    ...(i > 0 ? [new TableCell({
      width: { size: GAP, type: WidthType.DXA },
      borders: NO_CELL_BORDERS,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [new Paragraph({ children: [] })],
    })] : []),
    new TableCell({
      width: { size: BOX, type: WidthType.DXA },
      borders: { top: line, bottom: line, left: line, right: line },
      children: [new Paragraph({ children: [] })],
    }),
  ]).flat();
  return new Table({
    width: { size: LABEL + n * BOX + (n - 1) * GAP, type: WidthType.DXA },
    columnWidths: [LABEL, ...Array.from({ length: n }, (_, i) => (i > 0 ? [GAP, BOX] : [BOX])).flat()],
    borders: NO_TABLE_BORDERS,
    rows: [new TableRow({ cantSplit: true,
      height: { value: BOX, rule: HeightRule.EXACT },
      children: [
        new TableCell({
          width: { size: LABEL, type: WidthType.DXA },
          borders: NO_CELL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, font: 'Times New Roman', size: 28 })] })],
        }),
        ...cells,
      ],
    })],
  });
}

// Приблизительная высота вопроса в пунктах (по тем же правилам, что и вёрстка ниже; с запасом).
// Нужна, чтобы расставить страницы заранее (экзамен-кластер: надпись «Место для черновика» под последним вопросом страницы).
export async function estimateQuestionHeightPt(q: any, isTg: boolean, compact = true): Promise<number> {
  const LINE = 16.5;
  const m = compact ? 2 : 8; // поля ячейки сверху и снизу
  const lines = (text: string, widthPt: number, bold = false) =>
    Math.max(1, Math.ceil((textWidthEm(text) * FONT_PT * (bold ? 1.1 : 1.05)) / widthPt));
  const textPt = 432;
  const pick = (ru: any, tg: any, base: any) => (isTg ? (tg || base) : (ru || base)) || '';

  let h = 1 + lines(pick(q.content_ru, q.content_tg, q.content), textPt, true) * LINE + m;
  const img = q.image_url ? await fetchImageBuffer(q.image_url) : null;
  if (img) h += fitImage(img, 540, 340, 2.5).height * 0.75 + 4 + m;

  if (q.type === 'test' && q.options && q.options.length > 0) {
    const opts = [...q.options].sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));
    const texts: string[] = opts.map((o: any) => pick(o.text_ru, o.text_tg, o.text));
    const hasImg = opts.some((o: any) => o.image_url);
    const maxW = Math.max(...texts.map(optionWidthPt), 0);
    const isShort = !hasImg && opts.length <= 4 && maxW <= cellInnerPt(2212);
    const isMedium = !isShort && opts.length <= 4 && maxW <= cellInnerPt(4424);
    if (isShort) h += LINE + m;
    else if (isMedium) {
      for (let i = 0; i < texts.length; i += 2) {
        const l = Math.max(lines(texts[i], 210), lines(texts[i + 1] ?? '', 210));
        h += l * LINE + m;
      }
    } else {
      texts.forEach((t, i) => { h += lines(t, textPt) * LINE + m + (opts[i].image_url ? 72 : 0); });
    }
  } else if (q.type === 'matching' && q.matching_items && q.matching_items.length > 0) {
    const left = q.matching_items.filter((x: any) => x.side === 'left');
    const right = q.matching_items.filter((x: any) => x.side === 'right');
    let rows = 0;
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const lt = left[i] ? pick(left[i].text_ru, left[i].text_tg, left[i].text) : '';
      const rt = right[i] ? pick(right[i].text_ru, right[i].text_tg, right[i].text) : '';
      rows += Math.max(lines(lt, 140), lines(rt, 140)) * LINE + m + (left[i]?.image_url || right[i]?.image_url ? 64 : 0);
    }
    h += Math.max(rows, 105); // не ниже таблицы для ответа
  } else {
    h += 28 + m; // ряд клеток для ответа
  }
  return h + 25; // промежуток между вопросами
}

// Снимает «держать со следующим» у абзацев последней строки таблицы: иначе все вопросы склеятся в цепочку
function stripKeepNext(node: any) {
  if (!node || typeof node !== 'object' || !Array.isArray(node.root)) return;
  node.root = node.root.filter((c: any) => c?.rootKey !== 'w:keepNext');
  node.root.forEach(stripKeepNext);
}
function keepTogether(table: Table): Table {
  const rows = ((table as any).root as any[]).filter((c) => c instanceof TableRow);
  if (rows.length) stripKeepNext(rows[rows.length - 1]);
  return table;
}

// Генерация таблицы для одного вопроса: вопрос целиком переносится на новую страницу, а не рвётся
export async function createQuestionTable(q: any, qNumber: number, isTg: boolean, opts: QuestionOpts = {}): Promise<Table> {
  return keepTogether(await buildQuestionTable(q, qNumber, isTg, opts));
}

async function buildQuestionTable(q: any, qNumber: number, isTg: boolean, opts: QuestionOpts = {}): Promise<Table> {
  const cm = opts.compact ? COMPACT_MARGINS : CELL_MARGINS;
  const qText = isTg ? (q.content_tg || q.content) : (q.content_ru || q.content) || '';
  const imgBuffer = q.image_url ? await fetchImageBuffer(q.image_url) : null;

  // ТЕСТОВЫЙ ВОПРОС С ВАРИАНТАМИ ОТВЕТА
  if (q.type === 'test' && q.options && q.options.length > 0) {
    const opts = [...q.options].sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));
    const optImgBuffers = await Promise.all(
      opts.map((o: any) => o.image_url ? fetchImageBuffer(o.image_url) : Promise.resolve(null))
    );
    const hasOptImages = optImgBuffers.some(b => b !== null);

    const optTexts: string[] = opts.map((o: any) => (isTg ? (o.text_tg || o.text) : (o.text_ru || o.text)) || '');
    const maxW = Math.max(...optTexts.map(optionWidthPt), 0);

    // Четыре в ряд — только если каждый вариант влезает в одну строку узкой колонки;
    // два в ряд — если влезает в половину ширины; иначе столбиком
    const isShort = !hasOptImages && opts.length <= 4 && maxW <= cellInnerPt(2212);
    const isMedium = !isShort && opts.length <= 4 && maxW <= cellInnerPt(4424);

    if (isShort) {
      const rows: TableRow[] = [
        new TableRow({ cantSplit: true,
          children: [
            createNumberCell(qNumber),
            new TableCell({
              columnSpan: 4,
              width: { size: 8848, type: WidthType.DXA },
              margins: cm,
              borders: QUESTION_TOP_BORDERS,
              children: [
                new Paragraph({
                  children: parseFormattedTextRuns(qText, false, FONT_SIZE, true), // Текст вопроса жирный
                }),
              ],
            }),
          ],
        }),
      ];

      if (imgBuffer) {
        rows.push(
          new TableRow({ cantSplit: true,
            children: [
              createEmptyNumCell(cm),
              new TableCell({
                columnSpan: 4,
                width: { size: 8848, type: WidthType.DXA },
                margins: cm,
                borders: NO_CELL_BORDERS,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: imgBuffer, transformation: fitImage(imgBuffer, 540, 340, 2.5), type: 'png' })],
                  }),
                ],
              }),
            ],
          })
        );
      }

      const letters = ['A', 'B', 'C', 'D'];
      const optCells = [createEmptyNumCell(cm)];

      for (let i = 0; i < 4; i++) {
        const o = opts[i];
        const oText = o ? (isTg ? (o.text_tg || o.text) : (o.text_ru || o.text)) : '';
        optCells.push(
          new TableCell({
            width: { size: 2212, type: WidthType.DXA },
            margins: cm,
            borders: NO_CELL_BORDERS,
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `${letters[i]}) `, bold: true, font: 'Times New Roman', size: 28 }),
                  ...parseFormattedTextRuns(oText || '', false, FONT_SIZE, false),
                ],
              }),
            ],
          })
        );
      }

      rows.push(new TableRow({ cantSplit: true, children: optCells }));

      return new Table({
        width: { size: 9348, type: WidthType.DXA },
        columnWidths: [500, 2212, 2212, 2212, 2212],
        borders: NO_TABLE_BORDERS,
        rows,
      });
    } else if (isMedium) {
      const rows: TableRow[] = [
        new TableRow({ cantSplit: true,
          children: [
            createNumberCell(qNumber),
            new TableCell({
              columnSpan: 2,
              width: { size: 8848, type: WidthType.DXA },
              margins: cm,
              borders: QUESTION_TOP_BORDERS,
              children: [
                new Paragraph({
                  children: parseFormattedTextRuns(qText, false, FONT_SIZE, true),
                }),
              ],
            }),
          ],
        }),
      ];

      if (imgBuffer) {
        rows.push(
          new TableRow({ cantSplit: true,
            children: [
              createEmptyNumCell(cm),
              new TableCell({
                columnSpan: 2,
                width: { size: 8848, type: WidthType.DXA },
                margins: cm,
                borders: NO_CELL_BORDERS,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: imgBuffer, transformation: fitImage(imgBuffer, 540, 340, 2.5), type: 'png' })],
                  }),
                ],
              }),
            ],
          })
        );
      }

      const oA = opts[0];
      const oB = opts[1];
      const oAText = oA ? (isTg ? (oA.text_tg || oA.text) : (oA.text_ru || oA.text)) : '';
      const oBText = oB ? (isTg ? (oB.text_tg || oB.text) : (oB.text_ru || oB.text)) : '';

      rows.push(
        new TableRow({ cantSplit: true,
          children: [
            createEmptyNumCell(cm),
            new TableCell({
              width: { size: 4424, type: WidthType.DXA },
              margins: cm,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: 'A) ', bold: true, font: 'Times New Roman', size: 28 }),
                    ...parseFormattedTextRuns(oAText || '', false, FONT_SIZE, false),
                  ],
                }),
                ...(optImgBuffers[0] ? [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: optImgBuffers[0]!, transformation: fitImage(optImgBuffers[0]!, 140, 95), type: 'png' })],
                  }),
                ] : []),
              ],
            }),
            new TableCell({
              width: { size: 4424, type: WidthType.DXA },
              margins: cm,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: 'B) ', bold: true, font: 'Times New Roman', size: 28 }),
                    ...parseFormattedTextRuns(oBText || '', false, FONT_SIZE, false),
                  ],
                }),
                ...(optImgBuffers[1] ? [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: optImgBuffers[1]!, transformation: fitImage(optImgBuffers[1]!, 140, 95), type: 'png' })],
                  }),
                ] : []),
              ],
            }),
          ],
        })
      );

      const oC = opts[2];
      const oD = opts[3];
      const oCText = oC ? (isTg ? (oC.text_tg || oC.text) : (oC.text_ru || oC.text)) : '';
      const oDText = oD ? (isTg ? (oD.text_tg || oD.text) : (oD.text_ru || oD.text)) : '';

      rows.push(
        new TableRow({ cantSplit: true,
          children: [
            createEmptyNumCell(cm),
            new TableCell({
              width: { size: 4424, type: WidthType.DXA },
              margins: cm,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: 'C) ', bold: true, font: 'Times New Roman', size: 28 }),
                    ...parseFormattedTextRuns(oCText || '', false, FONT_SIZE, false),
                  ],
                }),
                ...(optImgBuffers[2] ? [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: optImgBuffers[2]!, transformation: fitImage(optImgBuffers[2]!, 140, 95), type: 'png' })],
                  }),
                ] : []),
              ],
            }),
            new TableCell({
              width: { size: 4424, type: WidthType.DXA },
              margins: cm,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: 'D) ', bold: true, font: 'Times New Roman', size: 28 }),
                    ...parseFormattedTextRuns(oDText || '', false, FONT_SIZE, false),
                  ],
                }),
                ...(optImgBuffers[3] ? [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: optImgBuffers[3]!, transformation: fitImage(optImgBuffers[3]!, 140, 95), type: 'png' })],
                  }),
                ] : []),
              ],
            }),
          ],
        })
      );

      return new Table({
        width: { size: 9348, type: WidthType.DXA },
        columnWidths: [500, 4424, 4424],
        borders: NO_TABLE_BORDERS,
        rows,
      });
    } else {
      const rows: TableRow[] = [
        new TableRow({ cantSplit: true,
          children: [
            createNumberCell(qNumber),
            new TableCell({
              width: { size: 8848, type: WidthType.DXA },
              margins: cm,
              borders: QUESTION_TOP_BORDERS,
              children: [
                new Paragraph({
                  children: parseFormattedTextRuns(qText, false, FONT_SIZE, true),
                }),
              ],
            }),
          ],
        }),
      ];

      if (imgBuffer) {
        rows.push(
          new TableRow({ cantSplit: true,
            children: [
              createEmptyNumCell(cm),
              new TableCell({
                width: { size: 8848, type: WidthType.DXA },
                margins: cm,
                borders: NO_CELL_BORDERS,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: imgBuffer, transformation: fitImage(imgBuffer, 540, 340, 2.5), type: 'png' })],
                  }),
                ],
              }),
            ],
          })
        );
      }

      const letters = ['A', 'B', 'C', 'D'];
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i];
        const oText = o ? (isTg ? (o.text_tg || o.text) : (o.text_ru || o.text)) : '';
        rows.push(
          new TableRow({ cantSplit: true,
            children: [
              createEmptyNumCell(cm),
              new TableCell({
                width: { size: 8848, type: WidthType.DXA },
                margins: cm,
                borders: NO_CELL_BORDERS,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: `${letters[i] || String(i + 1)}) `, bold: true, font: 'Times New Roman', size: 28 }),
                      ...parseFormattedTextRuns(oText || '', false, FONT_SIZE, false),
                    ],
                  }),
                  ...(optImgBuffers[i] ? [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new ImageRun({ data: optImgBuffers[i]!, transformation: fitImage(optImgBuffers[i]!, 180, 110), type: 'png' })],
                    }),
                  ] : []),
                ],
              }),
            ],
          })
        );
      }

      return new Table({
        width: { size: 9348, type: WidthType.DXA },
        columnWidths: [500, 8848],
        borders: NO_TABLE_BORDERS,
        rows,
      });
    }
  }

  // ЗАДАНИЕ НА СООТВЕТСТВИЕ: две колонки (ABCD и 12345)
  if (q.type === 'matching' && q.matching_items && q.matching_items.length > 0) {
    const leftItems = q.matching_items
      .filter((m: any) => m.side === 'left')
      .sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));
    const rightItems = q.matching_items
      .filter((m: any) => m.side === 'right')
      .sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));

    const maxLen = Math.max(leftItems.length, rightItems.length);
    const grid = opts.matchingGrid;
    const gridSize = grid ? imageSize(grid) : null;
    const colW = grid ? 3100 : 4424;
    const spanCols = grid ? 3 : 2;
    const leftImgBuffers = await Promise.all(
      leftItems.map((m: any) => m.image_url ? fetchImageBuffer(m.image_url) : Promise.resolve(null))
    );
    const rightImgBuffers = await Promise.all(
      rightItems.map((m: any) => m.image_url ? fetchImageBuffer(m.image_url) : Promise.resolve(null))
    );

    const rows: TableRow[] = [
      new TableRow({ cantSplit: true,
        children: [
          createNumberCell(qNumber),
          new TableCell({
            columnSpan: spanCols,
            width: { size: 8848, type: WidthType.DXA },
            margins: cm,
            borders: QUESTION_TOP_BORDERS,
            children: [
              new Paragraph({
                children: parseFormattedTextRuns(qText, false, FONT_SIZE, true),
              }),
            ],
          }),
        ],
      }),
    ];

    if (imgBuffer) {
      rows.push(
        new TableRow({ cantSplit: true,
          children: [
            createEmptyNumCell(cm),
            new TableCell({
              columnSpan: spanCols,
              width: { size: 8848, type: WidthType.DXA },
              margins: cm,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new ImageRun({ data: imgBuffer, transformation: fitImage(imgBuffer, 540, 340, 2.5), type: 'png' })],
                }),
              ],
            }),
          ],
        })
      );
    }

    const letters = ['A', 'B', 'C', 'D', 'E'];
    for (let rowIdx = 0; rowIdx < maxLen; rowIdx++) {
      const left = leftItems[rowIdx];
      const right = rightItems[rowIdx];

      const leftParas: Paragraph[] = [];
      if (left) {
        const lText = isTg ? (left.text_tg || left.text) : (left.text_ru || left.text);
        const letter = letters[rowIdx] || String.fromCharCode(65 + rowIdx);
        leftParas.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${letter}) `, bold: true, font: 'Times New Roman', size: 28 }),
              ...parseFormattedTextRuns(lText || '', false, FONT_SIZE, false),
            ],
          })
        );
        if (leftImgBuffers[rowIdx]) {
          leftParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ImageRun({ data: leftImgBuffers[rowIdx]!, transformation: fitImage(leftImgBuffers[rowIdx]!, 130, 85), type: 'png' })],
            })
          );
        }
      } else {
        leftParas.push(new Paragraph({ children: [] }));
      }

      const rightParas: Paragraph[] = [];
      if (right) {
        const rText = isTg ? (right.text_tg || right.text) : (right.text_ru || right.text);
        const num = right.order_index || (rowIdx + 1);
        rightParas.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${num}) `, bold: true, font: 'Times New Roman', size: 28 }),
              ...parseFormattedTextRuns(rText || '', false, FONT_SIZE, false),
            ],
          })
        );
        if (rightImgBuffers[rowIdx]) {
          rightParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ImageRun({ data: rightImgBuffers[rowIdx]!, transformation: fitImage(rightImgBuffers[rowIdx]!, 130, 85), type: 'png' })],
            })
          );
        }
      } else {
        rightParas.push(new Paragraph({ children: [] }));
      }

      rows.push(
        new TableRow({ cantSplit: true,
          children: [
            createEmptyNumCell(cm),
            new TableCell({
              width: { size: colW, type: WidthType.DXA },
              margins: cm,
              borders: NO_CELL_BORDERS,
              children: leftParas,
            }),
            new TableCell({
              width: { size: colW, type: WidthType.DXA },
              margins: cm,
              borders: NO_CELL_BORDERS,
              children: rightParas,
            }),
            ...(grid && gridSize && rowIdx === 0 ? [new TableCell({
              rowSpan: maxLen,
              width: { size: 2648, type: WidthType.DXA },
              margins: cm,
              borders: NO_CELL_BORDERS,
              verticalAlign: VerticalAlign.TOP,
              children: [
                ...(opts.matchingGridLabel ? [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 40 },
                  children: [new TextRun({ text: opts.matchingGridLabel, bold: true, font: 'Times New Roman', size: 28 })],
                })] : []),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new ImageRun({ data: grid, transformation: { width: 140, height: Math.round((140 * gridSize.h) / gridSize.w) }, type: 'png' })],
                }),
              ],
            })] : []),
          ],
        })
      );
    }

    return new Table({
      width: { size: 9348, type: WidthType.DXA },
      columnWidths: grid ? [500, 3100, 3100, 2648] : [500, 4424, 4424],
      borders: NO_TABLE_BORDERS,
      rows,
    });
  }

  // ОТКРЫТЫЙ ВОПРОС С ПОЛЕМ ДЛЯ ОТВЕТА
  const rows: TableRow[] = [
    new TableRow({ cantSplit: true,
      children: [
        createNumberCell(qNumber),
        new TableCell({
          width: { size: 8848, type: WidthType.DXA },
          margins: cm,
          borders: QUESTION_TOP_BORDERS,
          children: [
            new Paragraph({
              children: parseFormattedTextRuns(qText, false, FONT_SIZE, true),
            }),
          ],
        }),
      ],
    }),
  ];

  if (imgBuffer) {
    rows.push(
      new TableRow({ cantSplit: true,
        children: [
          createEmptyNumCell(cm),
          new TableCell({
            width: { size: 8848, type: WidthType.DXA },
            margins: cm,
            borders: NO_CELL_BORDERS,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({ data: imgBuffer, transformation: fitImage(imgBuffer, 540, 340, 2.5), type: 'png' })],
              }),
            ],
          }),
        ],
      })
    );
  }

  const ansLabel = isTg ? 'Ҷавоб: ' : 'Ответ: ';
  rows.push(
    new TableRow({ cantSplit: true,
      children: [
        createEmptyNumCell(cm),
        new TableCell({
          width: { size: 8848, type: WidthType.DXA },
          margins: cm,
          borders: NO_CELL_BORDERS,
          children: opts.openBoxes
            ? [createAnswerBoxes(ansLabel.trim(), opts.openBoxes), new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })]
            : [
              new Paragraph({
                children: [
                  new TextRun({ text: ansLabel, bold: true, font: 'Times New Roman', size: 28 }),
                  new TextRun({ text: '________________________', font: 'Times New Roman', size: 28 }),
                ],
              }),
            ],
        }),
      ],
    })
  );

  return new Table({
    width: { size: 9348, type: WidthType.DXA },
    columnWidths: [500, 8848],
    borders: NO_TABLE_BORDERS,
    rows,
  });
}

// Построение Blob для одного отдельного варианта (билета)
export async function buildSingleTicketBlob(
  examTitle: string,
  ticket: { ticket_number: number; questions: Array<{ question_snapshot: any }>; selection_info?: { ru?: string | null; tg?: string | null } },
  subjectName: string = 'Химия',
  isTg: boolean
): Promise<Blob> {
  // В шапке только номер варианта; предмет и темы указываются только в ключах
  const docChildren: any[] = [];
  const headerVariant = isTg ? `Варианти ${ticket.ticket_number}` : `Вариант ${ticket.ticket_number}`;

  // Шапка отдельного билета (по требованию: «рус "Вариант 1", тадж "Варианти 1"»)
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: headerVariant,
          bold: true,
          font: 'Times New Roman',
          size: 32, // 16 pt
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 180 },
      border: {
        bottom: { color: '999999', space: 1, style: BorderStyle.SINGLE, size: 4 },
      },
    })
  );

  // Таблицы каждого вопроса
  for (let qIdx = 0; qIdx < ticket.questions.length; qIdx++) {
    const q = ticket.questions[qIdx].question_snapshot;
    const table = await createQuestionTable(q, qIdx + 1, isTg);
    docChildren.push(table);
    // Отступ между вопросами: пустой абзац фиксированной высоты 10 pt (раньше строка 14 pt + 9 pt — слишком много)
    docChildren.push(
      new Paragraph({
        spacing: { before: 0, after: 0, line: 200, lineRule: LineRuleType.EXACT },
        children: [],
      })
    );
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Times New Roman', size: FONT_SIZE } } },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1134,    // 20 мм
              bottom: 1134, // 20 мм
              left: 1701,   // 30 мм
              right: 850,   // 15 мм
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  return await Packer.toBlob(doc);
}
