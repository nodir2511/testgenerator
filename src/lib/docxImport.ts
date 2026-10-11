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

    const tMatches = [...rXml.matchAll(/<[wm]:t[^>]*>([\s\S]*?)<\/[wm]:t>/g)];
    let t = tMatches.map((m) => m[1]).join('');
    if (!t) continue;

    if (isSub) t = `<sub>${t}</sub>`;
    if (isSup) t = `<sup>${t}</sup>`;
    if (isBold) t = `<b>${t}</b>`;
    if (isItalic) t = `<i>${t}</i>`;
    result += t;
  }

  if (!hasRuns) {
    result = xml.replace(/<[^>]+>/g, '');
  }

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

  const questions: DocxParsedQuestion[] = [];

  // --- Режим А: Вопросы в таблицах (экзаменационные билеты и таблицы) ---
  const tblRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
  let tMatch: RegExpExecArray | null;

  while ((tMatch = tblRegex.exec(docXml)) !== null) {
    const tblXml = tMatch[0];
    const rowMatches = [...tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)];
    if (rowMatches.length === 0) continue;

    // Преобразуем каждую строку в ячейки с текстом и ссылками на картинки
    const parsedRows = rowMatches.map((r) => {
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

    const row0 = parsedRows[0];
    if (row0.length < 2) continue;

    const qNumStr = row0[0].text.replace(/<[^>]+>/g, '').trim();
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
      /(?:^|[>\s])(Ответ|Ҷавоб|Ответ:|Ҷавоб:)/i.test(c.text.replace(/<[^>]+>/g, '').trim())
    );

    // 2. Проверяем, задание ли это на соответствие (колонки A/B/C/D и 1/2/3/4/5)
    const hasMatchingPattern = remainingRows.some((r) => {
      const nonNumCells = r.filter((c) => c.text.trim());
      if (nonNumCells.length < 2) return false;
      const leftPlain = nonNumCells[0].text.replace(/<[^>]+>/g, '').trim();
      const rightPlain = nonNumCells[1].text.replace(/<[^>]+>/g, '').trim();
      return /^[A-DА-Я]\)/i.test(leftPlain) && /^[1-9]\)/i.test(rightPlain);
    });

    if (isOpen) {
      const ansCell = contentCells.find((c) =>
        /(?:^|[>\s])(Ответ|Ҷавоб)/i.test(c.text.replace(/<[^>]+>/g, '').trim())
      );
      const rawAns = ansCell
        ? ansCell.text.replace(/<[^>]+>/g, '').replace(/^(?:Ответ|Ҷавоб)\s*:?\s*/i, '').trim()
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
          const lClean = validCells[0].text.replace(/^[A-DА-Я]\)\s*/i, '').trim();
          const rClean = validCells[1].text.replace(/^[1-9]\)\s*/i, '').trim();
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
          if (/^[1-9]\)/.test(t.replace(/<[^>]+>/g, '').trim())) {
            rightItems.push({
              side: 'right',
              text: t.replace(/^[1-9]\)\s*/i, '').trim(),
              imageUrl: validCells[0].imgUrl,
              orderIndex: rightItems.length + 1,
            });
          } else if (/^[A-DА-Я]\)/i.test(t.replace(/<[^>]+>/g, '').trim())) {
            leftItems.push({
              side: 'left',
              text: t.replace(/^[A-DА-Я]\)\s*/i, '').trim(),
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
        const plain = c.text.replace(/<[^>]+>/g, '').trim();
        if (/^[A-DА-Я]\)/i.test(plain) || plain || c.imgUrl) {
          const cleanOpt = c.text.replace(/^[A-DА-Я]\)\s*/i, '').trim();
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

  // --- Режим Б: Вопросы абзацами (если таблиц в файле не обнаружено) ---
  if (questions.length === 0) {
    const pRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
    let pMatch: RegExpExecArray | null;
    let currentQ: DocxParsedQuestion | null = null;

    while ((pMatch = pRegex.exec(docXml)) !== null) {
      const pXml = pMatch[0];
      const text = cleanXmlRunsToFormattedText(pXml);
      const rId = getEmbedIdFromXml(pXml);
      const pImgUrl = rId ? rIdToPublicUrl[rId] || null : null;

      if (!text && !pImgUrl) continue;

      const plainText = text.replace(/<[^>]+>/g, '').trim();

      // Проверяем, начинается ли абзац с номера вопроса (например: "1.", "1)", "Задание 1:")
      const numMatch = plainText.match(/^(?:Вопрос\s+|Задание\s+)?(\d+)[\.\)]\s*(.*)/i);

      if (numMatch) {
        if (currentQ) questions.push(currentQ);
        currentQ = {
          num: numMatch[1],
          type: 'test',
          content: numMatch[2] ? text.replace(/^(?:Вопрос\s+|Задание\s+)?\d+[\.\)]\s*/i, '') : '',
          imageUrl: pImgUrl,
          options: [],
        };
        continue;
      }

      if (currentQ) {
        // Картинка к вопросу
        if (pImgUrl && !currentQ.imageUrl) {
          currentQ.imageUrl = pImgUrl;
          continue;
        }

        // Вариант ответа A), B), C), D)
        const optMatch = plainText.match(/^([A-DА-Я])[\.\)]\s*(.*)/i);
        if (optMatch) {
          if (!currentQ.options) currentQ.options = [];
          currentQ.options.push({
            text: text.replace(/^[A-DА-Я][\.\)]\s*/i, '').trim(),
            imageUrl: pImgUrl,
          });
          continue;
        }

        // Ответ к открытому вопросу
        if (/^(?:Ответ|Ҷавоб)/i.test(plainText)) {
          currentQ.type = 'open';
          currentQ.correctAnswer = plainText.replace(/^(?:Ответ|Ҷавоб)\s*:?\s*/i, '').trim();
          continue;
        }

        // Если вариантов ещё не было, дописываем продолжение условия вопроса
        if (!currentQ.options || currentQ.options.length === 0) {
          currentQ.content += (currentQ.content ? '<br/>' : '') + text;
        }
      }
    }

    if (currentQ) questions.push(currentQ);
  }

  onProgress?.(`Успешно распознано вопросов: ${questions.length}`);
  return questions;
}
