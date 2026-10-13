import JSZip from 'jszip';
import { DocxParsedQuestion, parseDocumentXml } from './docxParse';

export type { DocxParsedQuestion } from './docxParse';
export { cleanXmlRunsToFormattedText } from './docxParse';

export interface ParsedDocx {
  questions: DocxParsedQuestion[];
  /** Картинки документа: временная ссылка blob: -> файл. В хранилище они попадают только при импорте. */
  images: Map<string, File>;
}

/**
 * Парсит файл Word (.docx), достаёт картинки (в браузере, без загрузки в хранилище)
 * и формирует список структурированных вопросов.
 */
export async function parseDocxFile(
  file: File,
  onProgress?: (msg: string) => void
): Promise<ParsedDocx> {
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

  // 2. Находим все изображения и готовим для них временные ссылки (загрузка в хранилище — при импорте)
  const rIdToPublicUrl: Record<string, string> = {};
  const images = new Map<string, File>();
  const mediaEntries = Object.keys(zip.files).filter((k) => k.startsWith('word/media/'));

  if (mediaEntries.length > 0) {
    onProgress?.(`Найдено изображений: ${mediaEntries.length}`);

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

        const publicUrl = URL.createObjectURL(imgFile);
        images.set(publicUrl, imgFile);

        const subPath = mediaPath.replace(/^word\//, '');
        const rIds = targetToRId[subPath] || [];
        for (const rId of rIds) {
          rIdToPublicUrl[rId] = publicUrl;
        }
      } catch (err) {
        console.warn(`Не удалось прочитать изображение ${mediaPath}:`, err);
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

  const questions = parseDocumentXml(docXml, rIdToPublicUrl);

  onProgress?.(`Успешно распознано вопросов: ${questions.length}`);
  return { questions, images };
}
