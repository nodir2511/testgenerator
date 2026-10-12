import JSZip from 'jszip';
import { uploadQuestionImage } from './imageCompression';
import { QuestionType } from '../types/database';

export interface DocxParsedQuestion {
  num: string;
  type: QuestionType;
  content: string;
  imageUrl?: string | null;
  options?: { text: string; imageUrl?: string | null }[];
  matchingItems?: { side: 'left' | 'right'; text: string; imageUrl?: string | null; orderIndex: number }[];
  correctAnswer?: string;
  section?: string;
  block?: string;
}

/**
 * Очищает и преобразует XML Word-пробежки в текст с сохранением sub, sup, b, i
 */
export function cleanXmlRunsToFormattedText(xml: string): string {
  if (!xml) return '';

  let result = '';
  // Ищем все пробежки текста <w:r> или формулы <m:oMath>
  const rRegex = /<(?:w:r|m:oMath)\b[\s\S]*?<\/(?:w:r|m:oMath)>/g;
  let match: RegExpExecArray | null;
  let hasRuns = false;

  while ((match = rRegex.exec(xml)) !== null) {
    hasRuns = true;
    const rXml = match[0];
    const isSub = rXml.includes('w:val="subscript"') || rXml.includes('<m:sub>');
    const isSup = rXml.includes('w:val="superscript"') || rXml.includes('<m:sup>');
    const isBold = /<w:b(?:\s+w:val="(?:true|1)")?\s*\/>/.test(rXml);
    const isItalic = /<w:i(?:\s+w:val="(?:true|1)")?\s*\/>/.test(rXml);

    const tMatches = [...rXml.matchAll(/<w:tab\s*\/>|<w:br\s*\/>|<[wm]:t(?:\s[^>]*)?>([\s\S]*?)<\/[wm]:t>/g)];
    let t = tMatches.map((m) => (m[1] === undefined ? ' ' : m[1])).join('');
    if (!t.trim()) continue;

    if (isSub) t = `<sub>${t}</sub>`;
    if (isSup) t = `<sup>${t}</sup>`;
    if (isBold) t = `<b>${t}</b>`;
    if (isItalic) t = `<i>${t}</i>`;
    result += t;
  }

  if (!hasRuns) {
    result = xml.replace(/<[^>]+>/g, '');
  }

  // Склеиваем соседние одинаковые теги, возникающие из-за дробления текста на пробежки
  result = result.replace(/<\/(b|i|sub|sup)><\1>/g, '');

  // Удаляем внешнее оборачивание всего текста в <b>...</b> если оно сплошное
  result = result.trim();
  if (result.startsWith('<b>') && result.endsWith('</b>') && result.indexOf('<b>', 3) === -1) {
    result = result.slice(3, -4).trim();
  }

  return result;
}

/**
 * Извлекает rId изображения из XML ячейки или параграфа
 */
function getEmbedIdFromXml(xml: string): string | null {
  if (!xml.includes('r:embed=')) return null;
  const match = xml.match(/r:embed="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Парсит файл Word (.docx), извлекает медиафайлы, загружает их в Supabase Storage
 * и формирует список структурированных вопросов.
 */
export async function parseDocxFile(
  file: File,
  onProgress?: (msg: string) => void
): Promise<DocxParsedQuestion[]> {
  onProgress?.('Чтение файла Word...');
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. Извлекаем карту отношений (Relationships)
  const relsEntry = zip.file('word/_rels/document.xml.rels');
  const relMap: Record<string, string> = {};

  if (relsEntry) {
    const relsXml = await relsEntry.async('text');
    const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g;
    let rm: RegExpExecArray | null;
    while ((rm = relRegex.exec(relsXml)) !== null) {
      relMap[rm[1]] = rm[2];
    }
  }

  // 2. Находим все изображения, загружаем их в Supabase Storage и получаем публичные ссылки
  const rIdToPublicUrl: Record<string, string> = {};
  const mediaEntries = Object.keys(zip.files).filter((k) => k.startsWith('word/media/'));

  if (mediaEntries.length > 0) {
    onProgress?.(`Найдено ${mediaEntries.length} изображений. Оптимизация и загрузка в базу...`);

    // Создаем обратное сопоставление target -> rId
    const targetToRId: Record<string, string[]> = {};
    for (const [rId, target] of Object.entries(relMap)) {
      const normalized = target.replace(/^\.\.\//, '').replace(/^word\//, '');
      if (!targetToRId[normalized]) targetToRId[normalized] = [];
      targetToRId[normalized].push(rId);
    }

    for (const mediaPath of mediaEntries) {
      try {
        const fileInZip = zip.file(mediaPath);
        if (!fileInZip) continue;

        const blob = await fileInZip.async('blob');
        const filename = mediaPath.split('/').pop() || 'image.png';
        const imgFile = new File([blob], filename, { type: blob.type || 'image/png' });

        const publicUrl = await uploadQuestionImage(imgFile);

        const subPath = mediaPath.replace(/^word\//, '');
        const rIds = targetToRId[subPath] || [];
        for (const rId of rIds) {
          rIdToPublicUrl[rId] = publicUrl;
        }
      } catch (err) {
        console.warn(`Не удалось загрузить изображение ${mediaPath} в Supabase:`, err);
      }
    }
  }

  // 3. Читаем document.xml
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) {
    throw new Error('Файл не содержит word/document.xml');
  }

  const docXml = await docEntry.async('text');
  onProgress?.('Распознавание структуры вопросов...');

  const blocks = splitBody(docXml);
  const tables = blocks
    .filter((b) => b.kind === 'tbl')
    .map((b) => parseTableRows(b.xml, rIdToPublicUrl));

  // Таблицы-вопросы (формат экспортированных билетов) — отдельный режим.
  // Все остальные таблицы (данные внутри вопроса, таблицы ключей) вопросами не считаются.
  const ticketTables = tables.filter(isTicketQuestionTable);
  const questions =
    ticketTables.length > 0
      ? parseTicketTables(ticketTables)
      : parseListFormat(blocks, rIdToPublicUrl);

  onProgress?.(`Успешно распознано вопросов: ${questions.length}`);
  return questions;
}

// ---------------------------------------------------------------------------
// Разбор тела документа
// ---------------------------------------------------------------------------

interface Cell {
  text: string;
  imgUrl: string | null;
}

interface Block {
  kind: 'p' | 'tbl';
  xml: string;
}

const plainOf = (s: string) => s.replace(/<[^>]+>/g, '').trim();

/**
 * Режет тело документа на верхнеуровневые абзацы и таблицы в порядке следования.
 * Абзацы внутри таблицы остаются частью таблицы; вложенные таблицы учитываются.
 */
function splitBody(xml: string): Block[] {
  const out: Block[] = [];
  const startRe = /<w:tbl[\s>]|<w:p[\s>/]/g;
  let i = 0;

  while (true) {
    startRe.lastIndex = i;
    const m = startRe.exec(xml);
    if (!m) break;

    if (m[0].startsWith('<w:tbl')) {
      let depth = 1;
      let end = xml.length;
      const tre = /<w:tbl[\s>]|<\/w:tbl>/g;
      tre.lastIndex = m.index + m[0].length;
      let t: RegExpExecArray | null;
      while ((t = tre.exec(xml)) !== null) {
        if (t[0] === '</w:tbl>') {
          depth--;
          if (depth === 0) {
            end = t.index + t[0].length;
            break;
          }
        } else {
          depth++;
        }
      }
      out.push({ kind: 'tbl', xml: xml.slice(m.index, end) });
      i = end;
    } else {
      const gt = xml.indexOf('>', m.index);
      if (gt === -1) break;
      if (xml[gt - 1] === '/') {
        out.push({ kind: 'p', xml: xml.slice(m.index, gt + 1) });
        i = gt + 1;
      } else {
        const close = xml.indexOf('</w:p>', gt);
        const end = close === -1 ? xml.length : close + 6;
        out.push({ kind: 'p', xml: xml.slice(m.index, end) });
        i = end;
      }
    }
  }

  return out;
}

function parseTableRows(tblXml: string, rIdToPublicUrl: Record<string, string>): Cell[][] {
  const rowMatches = [...tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)];
  return rowMatches.map((r) => {
    const cellMatches = [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)];
    return cellMatches.map((c) => {
      const cXml = c[0];
      const rId = getEmbedIdFromXml(cXml);
      return {
        text: cleanXmlRunsToFormattedText(cXml),
        imgUrl: rId ? rIdToPublicUrl[rId] || null : null,
      };
    });
  });
}

/** Убирает маркер «A) » / «1) » в начале, даже если он обёрнут в <b>. */
const stripMarker = (t: string, markers: string) =>
  t.replace(new RegExp(`^(?:<b>)?\\s*[${markers}]\\)\\s*(?:</b>)?\\s*`, 'i'), '').trim();

const OPTION_OR_ANSWER_RE = /^(?:[A-FА-Е]\)|Ответ|Ҷавоб)/i;

/** Таблица-вопрос: в первой ячейке номер, во второй текст вопроса, ниже варианты/ответ. */
function isTicketQuestionTable(rows: Cell[][]): boolean {
  if (rows.length < 2 || rows[0].length < 2) return false;
  if (!/^\d+$/.test(plainOf(rows[0][0].text))) return false;
  if (!plainOf(rows[0][1].text) && !rows[0][1].imgUrl) return false;
  return rows
    .slice(1)
    .some((r) => r.some((c) => OPTION_OR_ANSWER_RE.test(plainOf(c.text)) || c.imgUrl));
}

/** Таблица ключей: «№ | Ответ | № | Ответ ...», ниже пары номер/ответ. */
function isKeyTable(rows: Cell[][]): boolean {
  if (rows.length < 2 || rows[0].length < 2) return false;
  if (plainOf(rows[0][0].text) !== '№') return false;
  if (/^\d+$/.test(plainOf(rows[0][1].text))) return false;
  return /^\d+$/.test(plainOf(rows[1][0]?.text || ''));
}

function parseKeyTable(rows: Cell[][]): Map<number, string> {
  const keys = new Map<number, string>();
  rows.slice(1).forEach((row) => {
    for (let j = 0; j + 1 < row.length; j += 2) {
      const num = plainOf(row[j].text);
      const ans = plainOf(row[j + 1].text);
      if (/^\d+$/.test(num) && ans) keys.set(Number(num), ans);
    }
  });
  return keys;
}

/** Таблица с данными внутри условия вопроса -> одна строка текста. */
function flattenDataTable(rows: Cell[][]): string {
  return rows
    .map((r) => {
      const cells = r.map((c) => c.text.trim());
      if (cells.length >= 2 && cells[0]) {
        return `${cells[0]}: ${cells.slice(1).join(' | ')}`;
      }
      return cells.filter(Boolean).join(' | ');
    })
    .filter(Boolean)
    .join('; ');
}

const withDot = (s: string) => (/[.!?:;]$/.test(plainOf(s)) ? s : s + '.');

// ---------------------------------------------------------------------------
// Режим А: таблицы-вопросы (экзаменационные билеты)
// ---------------------------------------------------------------------------

function parseTicketTables(tables: Cell[][][]): DocxParsedQuestion[] {
  const questions: DocxParsedQuestion[] = [];

  for (const parsedRows of tables) {
    const row0 = parsedRows[0];

    const qNumStr = plainOf(row0[0].text);
    const qContent = row0[1].text;
    let questionImg = row0[1].imgUrl || null;

    let remainingRows = parsedRows.slice(1);

    // Если следующая строка — пустой ряд с рисунком вопроса
    if (
      remainingRows.length > 0 &&
      remainingRows[0].some((c) => c.imgUrl) &&
      remainingRows[0].every((c) => !c.text.trim())
    ) {
      const imgCell = remainingRows[0].find((c) => c.imgUrl);
      if (imgCell) questionImg = imgCell.imgUrl;
      remainingRows = remainingRows.slice(1);
    }

    // Собираем все ячейки вариантов/ответов (исключая первую колонку нумерации)
    const contentCells = remainingRows.flatMap((r) =>
      r.filter((_, idx) => idx > 0 || r.length === 1)
    );

    // 1. Проверяем, является ли вопрос открытым (содержит "Ответ:" или "Ҷавоб:")
    const isOpen = contentCells.some((c) =>
      /(?:^|[>\s])(Ответ|Ҷавоб|Ответ:|Ҷавоб:)/i.test(plainOf(c.text))
    );

    // 2. Проверяем, задание ли это на соответствие (колонки A/B/C/D и 1/2/3/4/5)
    const hasMatchingPattern = remainingRows.some((r) => {
      const nonNumCells = r.filter((c) => c.text.trim());
      if (nonNumCells.length < 2) return false;
      const leftPlain = plainOf(nonNumCells[0].text);
      const rightPlain = plainOf(nonNumCells[1].text);
      return /^[A-DА-Я]\)/i.test(leftPlain) && /^[1-9]\)/i.test(rightPlain);
    });

    if (isOpen) {
      const ansCell = contentCells.find((c) =>
        /(?:^|[>\s])(Ответ|Ҷавоб)/i.test(plainOf(c.text))
      );
      const rawAns = ansCell
        ? plainOf(ansCell.text).replace(/^(?:Ответ|Ҷавоб)\s*:?\s*/i, '').trim()
        : '';

      questions.push({
        num: qNumStr,
        type: 'open',
        content: qContent,
        imageUrl: questionImg,
        correctAnswer: rawAns,
      });
    } else if (hasMatchingPattern) {
      const leftItems: { side: 'left'; text: string; imageUrl?: string | null; orderIndex: number }[] = [];
      const rightItems: { side: 'right'; text: string; imageUrl?: string | null; orderIndex: number }[] = [];

      remainingRows.forEach((r) => {
        const validCells = r.filter((c) => c.text.trim() || c.imgUrl);
        if (validCells.length >= 2) {
          const lClean = stripMarker(validCells[0].text, 'A-DА-Я');
          const rClean = stripMarker(validCells[1].text, '1-9');
          if (lClean || validCells[0].imgUrl) {
            leftItems.push({
              side: 'left',
              text: lClean,
              imageUrl: validCells[0].imgUrl,
              orderIndex: leftItems.length + 1,
            });
          }
          if (rClean || validCells[1].imgUrl) {
            rightItems.push({
              side: 'right',
              text: rClean,
              imageUrl: validCells[1].imgUrl,
              orderIndex: rightItems.length + 1,
            });
          }
        } else if (validCells.length === 1) {
          const t = validCells[0].text;
          if (/^[1-9]\)/.test(plainOf(t))) {
            rightItems.push({
              side: 'right',
              text: stripMarker(t, '1-9'),
              imageUrl: validCells[0].imgUrl,
              orderIndex: rightItems.length + 1,
            });
          } else if (/^[A-DА-Я]\)/i.test(plainOf(t))) {
            leftItems.push({
              side: 'left',
              text: stripMarker(t, 'A-DА-Я'),
              imageUrl: validCells[0].imgUrl,
              orderIndex: leftItems.length + 1,
            });
          }
        }
      });

      questions.push({
        num: qNumStr,
        type: 'matching',
        content: qContent,
        imageUrl: questionImg,
        matchingItems: [...leftItems, ...rightItems],
      });
    } else {
      // 3. Тестовый вопрос с вариантами ответа
      const options: { text: string; imageUrl?: string | null }[] = [];
      contentCells.forEach((c) => {
        const plain = plainOf(c.text);
        if (/^[A-DА-Я]\)/i.test(plain) || plain || c.imgUrl) {
          const cleanOpt = stripMarker(c.text, 'A-DА-Я');
          options.push({
            text: cleanOpt,
            imageUrl: c.imgUrl,
          });
        }
      });

      questions.push({
        num: qNumStr,
        type: 'test',
        content: qContent,
        imageUrl: questionImg,
        options,
      });
    }
  }

  return questions;
}

// ---------------------------------------------------------------------------
// Режим Б: вопросы абзацами (нумерованный список), варианты в строке или ниже,
// таблицы данных внутри вопроса, ключи ответов в таблицах «№ | Ответ»
// ---------------------------------------------------------------------------

const OPTION_LETTERS: string[][] = [
  ['A', 'А'],
  ['B', 'В'],
  ['C', 'С'],
  ['D'],
  ['E', 'Е'],
  ['F'],
];

const markerRe = (idx: number) => new RegExp(`[${OPTION_LETTERS[idx].join('')}]\\)`, 'g');

/**
 * Делит «Вопрос? A) x B) y C) z D) w» на условие и варианты. Маркеры могут идти
 * вплотную к тексту («183B) 122») и в любом порядке (двухколоночная вёрстка даёт
 * A, C, B, D), поэтому берём последнее вхождение каждой буквы A, B, C... подряд
 * и режем текст по позициям маркеров.
 */
function splitInlineOptions(text: string): { stem: string; options: string[] } {
  const pos: number[] = [];
  for (let k = 0; k < OPTION_LETTERS.length; k++) {
    const re = markerRe(k);
    let last = -1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) last = m.index;
    if (last === -1) break;
    pos.push(last);
  }

  if (pos.length < 2) return { stem: text.trim(), options: [] };

  const sorted = pos.map((p, letter) => ({ p, letter })).sort((x, y) => x.p - y.p);
  const options: string[] = new Array(pos.length).fill('');
  sorted.forEach((m, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1].p : text.length;
    options[m.letter] = text.slice(m.p + 2, end).trim();
  });

  return { stem: balanceTags(text.slice(0, sorted[0].p).trim()), options: options.map(balanceTags) };
}

/** После разрезания по маркерам форматирующий тег может остаться открытым/закрытым только с одной стороны. */
function balanceTags(t: string): string {
  let out = t;
  for (const tag of ['b', 'i', 'sub', 'sup']) {
    const open = (out.match(new RegExp(`<${tag}>`, 'g')) || []).length;
    const close = (out.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open > close) out += `</${tag}>`.repeat(open - close);
    else if (close > open) out = `<${tag}>`.repeat(close - open) + out;
  }
  return out;
}

const SECTION_RE = /^§\s*(\d+)\.?\s*(.*)$/;
const HEADING_HINT_RE = /^(?:Контрольные|Тесты|Тестҳо|Вопросы|Задания|Задачи|Саволҳо|Масъалаҳо)/i;
const SINGLE_OPTION_RE = /^([A-FА-Е])[.)]\s*([\s\S]*)$/i;
const ANSWER_LINE_RE = /^(?:Ответ|Ҷавоб)\s*:?\s*/i;
const EXPLICIT_NUM_RE = /^(?:Вопрос\s+|Задание\s+)?(\d+)[.)]\s*/i;

interface QBlock {
  title: string;
  questions: DocxParsedQuestion[];
}

interface Section {
  title: string;
  pendingTitle: string;
  blocks: QBlock[];
  keys: Map<number, string>[];
}

function normalizeAnswer(raw: string, hasOptions: boolean): string {
  const a = raw.trim();
  if (hasOptions) {
    const letter = a.charAt(0).toUpperCase();
    const idx = OPTION_LETTERS.findIndex((v) => v.includes(letter));
    return idx >= 0 ? OPTION_LETTERS[idx][0] : a;
  }
  return a.replace(/\*+$/, '').replace(/\s+/g, '').replace(',', '.');
}

function parseListFormat(
  blocks: Block[],
  rIdToPublicUrl: Record<string, string>
): DocxParsedQuestion[] {
  const sections = new Map<string, Section>();
  let secId = '0';
  const getSection = (id: string): Section => {
    let sec = sections.get(id);
    if (!sec) {
      sec = { title: '', pendingTitle: '', blocks: [], keys: [] };
      sections.set(id, sec);
    }
    return sec;
  };

  let blockTitle = '';
  let curBlock: QBlock | null = null;
  let cur: DocxParsedQuestion | null = null;
  let contOk = false;

  for (const b of blocks) {
    if (b.kind === 'tbl') {
      const rows = parseTableRows(b.xml, rIdToPublicUrl);
      if (isKeyTable(rows)) {
        getSection(secId).keys.push(parseKeyTable(rows));
        cur = null;
        contOk = false;
      } else if (cur && contOk) {
        const flat = flattenDataTable(rows);
        if (flat) cur.content += (cur.content ? ' ' : '') + withDot(flat);
      }
      continue;
    }

    const text = cleanXmlRunsToFormattedText(b.xml);
    const plain = plainOf(text);
    const rId = getEmbedIdFromXml(b.xml);
    const pImgUrl = rId ? rIdToPublicUrl[rId] || null : null;

    if (!plain && !pImgUrl) {
      contOk = false;
      continue;
    }

    const secMatch = plain.match(SECTION_RE);
    if (secMatch) {
      secId = secMatch[1];
      getSection(secId).pendingTitle = secMatch[2].trim();
      blockTitle = '';
      curBlock = null;
      cur = null;
      contOk = false;
      continue;
    }

    const numbered = /<w:numPr>[\s\S]*?<w:numId w:val="(?!0")\d+"/.test(b.xml);
    const explicit = plain.match(EXPLICIT_NUM_RE);
    const startsOption = SINGLE_OPTION_RE.test(plain);

    // Новый вопрос
    if ((numbered || (explicit && !startsOption)) && plain) {
      const body = numbered ? text : text.replace(EXPLICIT_NUM_RE, '');
      const { stem, options } = splitInlineOptions(body);

      if (!curBlock) {
        curBlock = { title: blockTitle, questions: [] };
        const sec = getSection(secId);
        if (!sec.title) sec.title = sec.pendingTitle;
        sec.blocks.push(curBlock);
      }

      cur = {
        num: numbered || !explicit ? String(curBlock.questions.length + 1) : explicit[1],
        type: 'test',
        content: stem,
        imageUrl: pImgUrl,
        options: options.map((t) => ({ text: t })),
      };
      curBlock.questions.push(cur);
      contOk = true;
      continue;
    }

    const looksLikeHeading = !startsOption && plain.length <= 40 && HEADING_HINT_RE.test(plain);

    // Продолжение текущего вопроса: варианты, условие, ответ, картинка
    if (cur && !looksLikeHeading && (contOk || startsOption)) {
      if (!plain && pImgUrl) {
        const last = cur.options && cur.options[cur.options.length - 1];
        if (last && !last.imageUrl && cur.options!.length > 0) last.imageUrl = pImgUrl;
        else if (!cur.imageUrl) cur.imageUrl = pImgUrl;
        continue;
      }

      if (ANSWER_LINE_RE.test(plain)) {
        cur.correctAnswer = plain.replace(ANSWER_LINE_RE, '').trim();
        continue;
      }

      const { stem, options } = splitInlineOptions(text);
      if (options.length >= 2) {
        if (stem) cur.content += (cur.content ? ' ' : '') + stem;
        cur.options = options.map((t) => ({ text: t, imageUrl: null }));
        contOk = true;
        continue;
      }

      const single = plain.match(SINGLE_OPTION_RE);
      if (single) {
        cur.options = cur.options || [];
        cur.options.push({
          text: text.replace(/^[A-FА-Е][.)]\s*/i, '').trim(),
          imageUrl: pImgUrl,
        });
        contOk = true;
        continue;
      }

      if (cur.options && cur.options.length > 0) {
        cur.options[cur.options.length - 1].text += ' ' + text;
      } else {
        cur.content += (cur.content ? ' ' : '') + text;
      }
      contOk = true;
      continue;
    }

    // Иначе это заголовок («Контрольные тесты», «Тесты НЦТ» и т.п.)
    if (HEADING_HINT_RE.test(plain) || plain.length <= 60) {
      blockTitle = plain;
      curBlock = null;
    }
    cur = null;
    contOk = false;
  }

  // Применяем ключи: k-я таблица ключей раздела относится к k-му блоку вопросов раздела
  const result: DocxParsedQuestion[] = [];
  sections.forEach((sec) => {
    const qBlocks = sec.blocks.filter((qb) => qb.questions.length > 0);
    qBlocks.forEach((qb, k) => {
      const keys = sec.keys[k];
      qb.questions.forEach((q) => {
        const raw = keys?.get(Number(q.num)) ?? q.correctAnswer;
        const hasOptions = (q.options?.length || 0) >= 2;
        // В ключе буква, а вариантов в документе нет: это тест с потерянными вариантами, не открытый вопрос
        const isTest = hasOptions || (raw !== undefined && /^[A-FА-Е]$/i.test(raw.trim()));
        q.type = isTest ? 'test' : 'open';
        if (raw !== undefined) q.correctAnswer = normalizeAnswer(raw, isTest);
        if (!isTest) delete q.options;
        q.section = sec.title;
        q.block = qb.title;
        result.push(q);
      });
    });
  });

  return result;
}
