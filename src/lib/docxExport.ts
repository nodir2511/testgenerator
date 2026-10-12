import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  ImageRun, 
  AlignmentType, 
  Table, 
  TableRow, 
  TableCell, 
  WidthType, 
  BorderStyle,
  Math as DocxMath,
  MathFraction,
  MathRun,
  type ParagraphChild
} from 'docx';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';

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

// Внутренние отступы ячеек таблицы для чистого выравнивания
const CELL_MARGINS = {
  top: 80,
  bottom: 80,
  left: 100,
  right: 100,
};

// Стиль серой ячейки с номером вопроса
const NUMBER_CELL_MARGINS = {
  top: 80,
  bottom: 80,
  left: 60,
  right: 60,
};
const NUMBER_CELL_SHADING = {
  fill: '595959', // Серый фон ячейки нумерации
};

async function fetchImageBuffer(url: string): Promise<Uint8Array | null> {
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

// Единицы измерения, которые не должны превращаться в вертикальные дроби
const UNIT_RE = /(?:^|\s|\d)(?:км\/ч|км\/соат|м\/с[2²]?|г\/моль|Н\/м|кг\/м[3³]?|Дж\/кг|В\/м|А\/м|Ом\/м|об\/с|рад\/с)(?:$|\s|[.,;:!?])/i;

function stripOuterParens(s: string): string {
  if (!s) return '';
  s = s.trim();
  if (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0 && i < s.length - 1) return s;
      }
    }
    return s.slice(1, -1).trim();
  }
  return s;
}

function findMainSlash(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === '/' && depth === 0) {
      return i;
    }
  }
  return s.indexOf('/');
}

function buildMathRuns(text: string): MathRun[] {
  if (!text) return [];
  const runs: MathRun[] = [];
  const parts = text.split(/(<sub>.*?<\/sub>|<sup>.*?<\/sup>)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('<sub>') && part.endsWith('</sub>')) {
      runs.push(new MathRun(part.replace(/<\/?sub>/g, '')));
    } else if (part.startsWith('<sup>') && part.endsWith('</sup>')) {
      runs.push(new MathRun(part.replace(/<\/?sup>/g, '')));
    } else {
      runs.push(new MathRun(part));
    }
  }
  return runs.length > 0 ? runs : [new MathRun(text)];
}

function parseExplicitFrac(text: string): { num: string; den: string } | null {
  const tagMatch = text.match(/<frac>([\s\S]*?)<\/frac>/i);
  if (tagMatch) {
    const inner = tagMatch[1];
    const slashIdx = inner.indexOf('/');
    if (slashIdx !== -1) {
      return {
        num: inner.slice(0, slashIdx).trim(),
        den: inner.slice(slashIdx + 1).trim()
      };
    }
  }
  const latexMatch = text.match(/\\frac\{([^{}]+)\}\{([^{}]+)\}/);
  if (latexMatch) {
    return {
      num: latexMatch[1].trim(),
      den: latexMatch[2].trim()
    };
  }
  return null;
}

/**
 * Преобразует математическое выражение с дробью в объект формулы Word (DocxMath)
 */
export function parseFormulaToDocxMath(text: string): DocxMath | null {
  if (!text || UNIT_RE.test(text)) return null;

  // 1. Явные теги дроби: <frac>num/den</frac> или \frac{num}{den}
  const expFrac = parseExplicitFrac(text);
  if (expFrac) {
    const isTag = text.includes('<frac>');
    const startIdx = text.indexOf(isTag ? '<frac>' : '\\frac');
    const endIdx = isTag 
      ? text.indexOf('</frac>') + 7 
      : text.indexOf('}', text.indexOf('}') + 1) + 1;
    const before = text.slice(0, startIdx);
    const after = text.slice(endIdx);
    const children: any[] = [];
    if (before) children.push(new MathRun(before));
    children.push(new MathFraction({
      numerator: buildMathRuns(expFrac.num),
      denominator: buildMathRuns(expFrac.den)
    }));
    if (after) children.push(new MathRun(after));
    return new DocxMath({ children });
  }

  // 2. Двойная дробь: A/B = C/D
  const doubleMatch = text.match(/^([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)$/);
  if (doubleMatch) {
    return new DocxMath({
      children: [
        new MathFraction({
          numerator: buildMathRuns(doubleMatch[1]),
          denominator: buildMathRuns(doubleMatch[2])
        }),
        new MathRun(' = '),
        new MathFraction({
          numerator: buildMathRuns(doubleMatch[3]),
          denominator: buildMathRuns(doubleMatch[4])
        })
      ]
    });
  }

  // 3. Уравнение с дробью: I = cos(φ)/(P·V), A = (B·C)/D, x = (y-b)/k, a = F/m
  if (text.includes('=')) {
    const eqSides = text.split('=');
    if (eqSides.length === 2) {
      const left = eqSides[0].trim();
      const right = eqSides[1].trim();

      if (!left.includes('/') && right.includes('/')) {
        const slashIdx = findMainSlash(right);
        const num = stripOuterParens(right.slice(0, slashIdx));
        const den = stripOuterParens(right.slice(slashIdx + 1));
        if (num && den && !/[а-яА-ЯёЁғӣӯҳҷқ]{4,}/.test(num) && !/[а-яА-ЯёЁғӣӯҳҷқ]{4,}/.test(den)) {
          return new DocxMath({
            children: [
              new MathRun(left + ' = '),
              new MathFraction({
                numerator: buildMathRuns(num),
                denominator: buildMathRuns(den)
              })
            ]
          });
        }
      }
    }
  }

  // 4. Одиночная дробь: (y-b)/k, P/(V·cos(φ)), (B·C)/D, F/m
  if (text.includes('/')) {
    const slashIdx = findMainSlash(text);
    const num = stripOuterParens(text.slice(0, slashIdx));
    const den = stripOuterParens(text.slice(slashIdx + 1));
    if (num && den && !/[а-яА-ЯёЁғӣӯҳҷқ]{4,}/.test(num) && !/[а-яА-ЯёЁғӣӯҳҷқ]{4,}/.test(den)) {
      return new DocxMath({
        children: [
          new MathFraction({
            numerator: buildMathRuns(num),
            denominator: buildMathRuns(den)
          })
        ]
      });
    }
  }

  return null;
}

// Парсер форматированного текста (sub, sup, b, i) и формул с дробями
export function parseFormattedTextRuns(
  text: string, 
  isItalic = false, 
  fontSize = 24, 
  isBold = false
): ParagraphChild[] {
  if (!text) return [];

  // 1. Если весь текст целиком является формулой с дробью (варианты ответов, уравнения)
  const fullMath = parseFormulaToDocxMath(text);
  if (fullMath) return [fullMath];

  // 2. Если внутри текста вопроса содержится встроенная формула, например "Преобразуйте формулу A/B = C/D и выразите A:"
  const formulaEmbed = text.match(/^(.*?\b(?:формулу|выражение)?\s*)([A-Za-z0-9_]+\/[A-Za-z0-9_]+\s*=\s*[A-Za-z0-9_]+\/[A-Za-z0-9_]+|[A-Za-zα-ωΑ-Ω0-9_\s]+\s*=\s*[^:;,]+?)(\s+(?:и выразите|найдите|какова|чему|согласно).*)$/i);
  if (formulaEmbed) {
    const [, before, formulaStr, after] = formulaEmbed;
    const mathPart = parseFormulaToDocxMath(formulaStr.trim());
    if (mathPart) {
      return [
        ...parseFormattedTextRuns(before, isItalic, fontSize, isBold),
        mathPart,
        ...parseFormattedTextRuns(after, isItalic, fontSize, isBold)
      ];
    }
  }

  // 3. Обычные пробежки с форматированием (sub, sup, b, i)
  const parts = text.split(/(<sub>.*?<\/sub>|<sup>.*?<\/sup>|<b>.*?<\/b>|<i>.*?<\/i>)/g);
  const runs: ParagraphChild[] = [];

  parts.forEach((part) => {
    if (!part) return;

    if (part.startsWith('<sub>') && part.endsWith('</sub>')) {
      runs.push(
        new TextRun({
          text: part.replace(/<\/?sub>/g, ''),
          subScript: true,
          font: 'Times New Roman',
          size: fontSize,
          italics: isItalic,
          bold: isBold,
        })
      );
    } else if (part.startsWith('<sup>') && part.endsWith('</sup>')) {
      runs.push(
        new TextRun({
          text: part.replace(/<\/?sup>/g, ''),
          superScript: true,
          font: 'Times New Roman',
          size: fontSize,
          italics: isItalic,
          bold: isBold,
        })
      );
    } else if (part.startsWith('<b>') && part.endsWith('</b>')) {
      runs.push(
        new TextRun({
          text: part.replace(/<\/?b>/g, ''),
          bold: true,
          font: 'Times New Roman',
          size: fontSize,
          italics: isItalic,
        })
      );
    } else if (part.startsWith('<i>') && part.endsWith('</i>')) {
      runs.push(
        new TextRun({
          text: part.replace(/<\/?i>/g, ''),
          italics: true,
          bold: isBold,
          font: 'Times New Roman',
          size: fontSize,
        })
      );
    } else {
      runs.push(
        new TextRun({
          text: part,
          font: 'Times New Roman',
          size: fontSize,
          italics: isItalic,
          bold: isBold,
        })
      );
    }
  });

  return runs;
}

function cleanTextLength(text: string): number {
  return (text || '').replace(/<[^>]+>/g, '').trim().length;
}

// Создание ячейки номера вопроса (серая плашка, белый жирный номер)
function createNumberCell(qNumber: number): TableCell {
  return new TableCell({
    width: { size: 500, type: WidthType.DXA },
    shading: NUMBER_CELL_SHADING,
    margins: NUMBER_CELL_MARGINS,
    borders: NO_CELL_BORDERS,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ 
            text: String(qNumber), 
            bold: true, 
            color: 'FFFFFF', // Белая нумерация 
            font: 'Times New Roman', 
            size: 28 
          }),
        ],
      }),
    ],
  });
}

// Создание пустой ячейки под номером для выравнивания
function createEmptyNumCell(): TableCell {
  return new TableCell({
    width: { size: 500, type: WidthType.DXA },
    margins: CELL_MARGINS,
    borders: NO_CELL_BORDERS,
    children: [new Paragraph({ children: [] })],
  });
}

// Генерация таблицы для одного вопроса
async function createQuestionTable(q: any, qNumber: number, isTg: boolean): Promise<Table> {
  const qText = isTg ? (q.content_tg || q.content) : (q.content_ru || q.content) || '';
  const imgBuffer = q.image_url ? await fetchImageBuffer(q.image_url) : null;

  // ТЕСТОВЫЙ ВОПРОС С ВАРИАНТАМИ ОТВЕТА
  if (q.type === 'test' && q.options && q.options.length > 0) {
    const opts = [...q.options].sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0));
    const optImgBuffers = await Promise.all(
      opts.map((o: any) => o.image_url ? fetchImageBuffer(o.image_url) : Promise.resolve(null))
    );
    const hasOptImages = optImgBuffers.some(b => b !== null);

    const cleanLengths = opts.map((o: any) => cleanTextLength(isTg ? (o.text_tg || o.text) : (o.text_ru || o.text)));
    const maxLen = Math.max(...cleanLengths, 0);
    const sumLen = cleanLengths.reduce((a, b) => a + b, 0);

    const isShort = !hasOptImages && maxLen <= 18 && sumLen <= 65;
    const isMedium = !isShort && (!hasOptImages ? (maxLen <= 42 && sumLen <= 150) : maxLen <= 35);

    if (isShort) {
      const rows: TableRow[] = [
        new TableRow({
          children: [
            createNumberCell(qNumber),
            new TableCell({
              columnSpan: 4,
              width: { size: 8848, type: WidthType.DXA },
              margins: CELL_MARGINS,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  children: parseFormattedTextRuns(qText, false, 24, true), // Текст вопроса жирный
                }),
              ],
            }),
          ],
        }),
      ];

      if (imgBuffer) {
        rows.push(
          new TableRow({
            children: [
              createEmptyNumCell(),
              new TableCell({
                columnSpan: 4,
                width: { size: 8848, type: WidthType.DXA },
                margins: CELL_MARGINS,
                borders: NO_CELL_BORDERS,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: imgBuffer, transformation: { width: 300, height: 160 }, type: 'png' })],
                  }),
                ],
              }),
            ],
          })
        );
      }

      const letters = ['A', 'B', 'C', 'D'];
      const optCells = [createEmptyNumCell()];

      for (let i = 0; i < 4; i++) {
        const o = opts[i];
        const oText = o ? (isTg ? (o.text_tg || o.text) : (o.text_ru || o.text)) : '';
        optCells.push(
          new TableCell({
            width: { size: 2212, type: WidthType.DXA },
            margins: CELL_MARGINS,
            borders: NO_CELL_BORDERS,
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `${letters[i]}) `, bold: true, font: 'Times New Roman', size: 24 }),
                  ...parseFormattedTextRuns(oText || '', false, 24, false),
                ],
              }),
            ],
          })
        );
      }

      rows.push(new TableRow({ children: optCells }));

      return new Table({
        width: { size: 9348, type: WidthType.DXA },
        columnWidths: [500, 2212, 2212, 2212, 2212],
        borders: NO_TABLE_BORDERS,
        rows,
      });
    } else if (isMedium) {
      const rows: TableRow[] = [
        new TableRow({
          children: [
            createNumberCell(qNumber),
            new TableCell({
              columnSpan: 2,
              width: { size: 8848, type: WidthType.DXA },
              margins: CELL_MARGINS,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  children: parseFormattedTextRuns(qText, false, 24, true),
                }),
              ],
            }),
          ],
        }),
      ];

      if (imgBuffer) {
        rows.push(
          new TableRow({
            children: [
              createEmptyNumCell(),
              new TableCell({
                columnSpan: 2,
                width: { size: 8848, type: WidthType.DXA },
                margins: CELL_MARGINS,
                borders: NO_CELL_BORDERS,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: imgBuffer, transformation: { width: 300, height: 160 }, type: 'png' })],
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
        new TableRow({
          children: [
            createEmptyNumCell(),
            new TableCell({
              width: { size: 4424, type: WidthType.DXA },
              margins: CELL_MARGINS,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: 'A) ', bold: true, font: 'Times New Roman', size: 24 }),
                    ...parseFormattedTextRuns(oAText || '', false, 24, false),
                  ],
                }),
                ...(optImgBuffers[0] ? [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: optImgBuffers[0]!, transformation: { width: 140, height: 95 }, type: 'png' })],
                  }),
                ] : []),
              ],
            }),
            new TableCell({
              width: { size: 4424, type: WidthType.DXA },
              margins: CELL_MARGINS,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: 'B) ', bold: true, font: 'Times New Roman', size: 24 }),
                    ...parseFormattedTextRuns(oBText || '', false, 24, false),
                  ],
                }),
                ...(optImgBuffers[1] ? [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: optImgBuffers[1]!, transformation: { width: 140, height: 95 }, type: 'png' })],
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
        new TableRow({
          children: [
            createEmptyNumCell(),
            new TableCell({
              width: { size: 4424, type: WidthType.DXA },
              margins: CELL_MARGINS,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: 'C) ', bold: true, font: 'Times New Roman', size: 24 }),
                    ...parseFormattedTextRuns(oCText || '', false, 24, false),
                  ],
                }),
                ...(optImgBuffers[2] ? [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: optImgBuffers[2]!, transformation: { width: 140, height: 95 }, type: 'png' })],
                  }),
                ] : []),
              ],
            }),
            new TableCell({
              width: { size: 4424, type: WidthType.DXA },
              margins: CELL_MARGINS,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: 'D) ', bold: true, font: 'Times New Roman', size: 24 }),
                    ...parseFormattedTextRuns(oDText || '', false, 24, false),
                  ],
                }),
                ...(optImgBuffers[3] ? [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: optImgBuffers[3]!, transformation: { width: 140, height: 95 }, type: 'png' })],
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
        new TableRow({
          children: [
            createNumberCell(qNumber),
            new TableCell({
              width: { size: 8848, type: WidthType.DXA },
              margins: CELL_MARGINS,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  children: parseFormattedTextRuns(qText, false, 24, true),
                }),
              ],
            }),
          ],
        }),
      ];

      if (imgBuffer) {
        rows.push(
          new TableRow({
            children: [
              createEmptyNumCell(),
              new TableCell({
                width: { size: 8848, type: WidthType.DXA },
                margins: CELL_MARGINS,
                borders: NO_CELL_BORDERS,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({ data: imgBuffer, transformation: { width: 300, height: 160 }, type: 'png' })],
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
          new TableRow({
            children: [
              createEmptyNumCell(),
              new TableCell({
                width: { size: 8848, type: WidthType.DXA },
                margins: CELL_MARGINS,
                borders: NO_CELL_BORDERS,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: `${letters[i] || String(i + 1)}) `, bold: true, font: 'Times New Roman', size: 24 }),
                      ...parseFormattedTextRuns(oText || '', false, 24, false),
                    ],
                  }),
                  ...(optImgBuffers[i] ? [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new ImageRun({ data: optImgBuffers[i]!, transformation: { width: 180, height: 110 }, type: 'png' })],
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
    const leftImgBuffers = await Promise.all(
      leftItems.map((m: any) => m.image_url ? fetchImageBuffer(m.image_url) : Promise.resolve(null))
    );
    const rightImgBuffers = await Promise.all(
      rightItems.map((m: any) => m.image_url ? fetchImageBuffer(m.image_url) : Promise.resolve(null))
    );

    const rows: TableRow[] = [
      new TableRow({
        children: [
          createNumberCell(qNumber),
          new TableCell({
            columnSpan: 2,
            width: { size: 8848, type: WidthType.DXA },
            margins: CELL_MARGINS,
            borders: NO_CELL_BORDERS,
            children: [
              new Paragraph({
                children: parseFormattedTextRuns(qText, false, 24, true),
              }),
            ],
          }),
        ],
      }),
    ];

    if (imgBuffer) {
      rows.push(
        new TableRow({
          children: [
            createEmptyNumCell(),
            new TableCell({
              columnSpan: 2,
              width: { size: 8848, type: WidthType.DXA },
              margins: CELL_MARGINS,
              borders: NO_CELL_BORDERS,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new ImageRun({ data: imgBuffer, transformation: { width: 300, height: 160 }, type: 'png' })],
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
              new TextRun({ text: `${letter}) `, bold: true, font: 'Times New Roman', size: 24 }),
              ...parseFormattedTextRuns(lText || '', false, 24, false),
            ],
          })
        );
        if (leftImgBuffers[rowIdx]) {
          leftParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ImageRun({ data: leftImgBuffers[rowIdx]!, transformation: { width: 130, height: 85 }, type: 'png' })],
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
              new TextRun({ text: `${num}) `, bold: true, font: 'Times New Roman', size: 24 }),
              ...parseFormattedTextRuns(rText || '', false, 24, false),
            ],
          })
        );
        if (rightImgBuffers[rowIdx]) {
          rightParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ImageRun({ data: rightImgBuffers[rowIdx]!, transformation: { width: 130, height: 85 }, type: 'png' })],
            })
          );
        }
      } else {
        rightParas.push(new Paragraph({ children: [] }));
      }

      rows.push(
        new TableRow({
          children: [
            createEmptyNumCell(),
            new TableCell({
              width: { size: 4424, type: WidthType.DXA },
              margins: CELL_MARGINS,
              borders: NO_CELL_BORDERS,
              children: leftParas,
            }),
            new TableCell({
              width: { size: 4424, type: WidthType.DXA },
              margins: CELL_MARGINS,
              borders: NO_CELL_BORDERS,
              children: rightParas,
            }),
          ],
        })
      );
    }

    return new Table({
      width: { size: 9348, type: WidthType.DXA },
      columnWidths: [500, 4424, 4424],
      borders: NO_TABLE_BORDERS,
      rows,
    });
  }

  // ОТКРЫТЫЙ ВОПРОС С ПОЛЕМ ДЛЯ ОТВЕТА
  const rows: TableRow[] = [
    new TableRow({
      children: [
        createNumberCell(qNumber),
        new TableCell({
          width: { size: 8848, type: WidthType.DXA },
          margins: CELL_MARGINS,
          borders: NO_CELL_BORDERS,
          children: [
            new Paragraph({
              children: parseFormattedTextRuns(qText, false, 24, true),
            }),
          ],
        }),
      ],
    }),
  ];

  if (imgBuffer) {
    rows.push(
      new TableRow({
        children: [
          createEmptyNumCell(),
          new TableCell({
            width: { size: 8848, type: WidthType.DXA },
            margins: CELL_MARGINS,
            borders: NO_CELL_BORDERS,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({ data: imgBuffer, transformation: { width: 300, height: 160 }, type: 'png' })],
              }),
            ],
          }),
        ],
      })
    );
  }

  const ansLabel = isTg ? 'Ҷавоб: ' : 'Ответ: ';
  rows.push(
    new TableRow({
      children: [
        createEmptyNumCell(),
        new TableCell({
          width: { size: 8848, type: WidthType.DXA },
          margins: CELL_MARGINS,
          borders: NO_CELL_BORDERS,
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: ansLabel, bold: true, font: 'Times New Roman', size: 24 }),
                new TextRun({ text: '________________________', font: 'Times New Roman', size: 24 }),
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
  ticket: { ticket_number: number; questions: Array<{ question_snapshot: any }> },
  subjectName: string = 'Химия',
  isTg: boolean
): Promise<Blob> {
  const docChildren: any[] = [];
  const headerVariant = isTg ? `Варианти ${ticket.ticket_number}` : `Вариант ${ticket.ticket_number}`;
  const headerSubject = isTg ? `Фан: ${subjectName}` : `Предмет: ${subjectName}`;

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
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
      children: [
        new TextRun({
          text: `${headerSubject}${examTitle ? `  •  ${examTitle}` : ''}`,
          font: 'Times New Roman',
          size: 22,
          color: '555555',
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
    // Отступ между таблицами
    docChildren.push(
      new Paragraph({
        spacing: { after: 180 },
        children: [],
      })
    );
  }

  const doc = new Document({
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

// Экспорт одного конкретного билета
export async function exportSingleTicketDocx(
  examTitle: string,
  ticket: { ticket_number: number; questions: Array<{ question_snapshot: any }> },
  subjectName: string = 'Химия',
  lang: 'ru' | 'tg' = 'ru'
) {
  const isTg = lang === 'tg';
  const blob = await buildSingleTicketBlob(examTitle, ticket, subjectName, isTg);
  const fileName = isTg ? `Варианти ${ticket.ticket_number}.docx` : `Вариант ${ticket.ticket_number}.docx`;
  saveAs(blob, fileName);
}

export type ExportLanguage = 'ru' | 'tg' | 'both';

// Экспорт партии билетов (каждый вариант — отдельный файл .docx)
export async function exportTicketsToDocx(
  examTitle: string,
  tickets: Array<{
    ticket_number: number;
    questions: Array<{ question_snapshot: any }>;
  }>,
  subjectName: string = 'Химия',
  lang: ExportLanguage = 'ru'
) {
  if (!tickets || tickets.length === 0) return;

  // Если в партии ровно 1 вариант и выбран 1 язык — сохраняем прямо отдельный .docx файл
  if (tickets.length === 1 && lang !== 'both') {
    await exportSingleTicketDocx(examTitle, tickets[0], subjectName, lang);
    return;
  }

  const zip = new JSZip();

  if (lang === 'ru') {
    for (const t of tickets) {
      const blob = await buildSingleTicketBlob(examTitle, t, subjectName, false);
      zip.file(`Вариант ${t.ticket_number}.docx`, blob);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, `${examTitle}_RU.zip`);
  } else if (lang === 'tg') {
    for (const t of tickets) {
      const blob = await buildSingleTicketBlob(examTitle, t, subjectName, true);
      zip.file(`Варианти ${t.ticket_number}.docx`, blob);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, `${examTitle}_TG.zip`);
  } else {
    // RU + TG: формируются две раздельные папки с отдельными файлами
    for (const t of tickets) {
      const ruBlob = await buildSingleTicketBlob(examTitle, t, subjectName, false);
      zip.file(`Русский/Вариант ${t.ticket_number}.docx`, ruBlob);

      const tgBlob = await buildSingleTicketBlob(examTitle, t, subjectName, true);
      zip.file(`Тоҷикӣ/Варианти ${t.ticket_number}.docx`, tgBlob);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, `${examTitle}_RU_TG.zip`);
  }
}
