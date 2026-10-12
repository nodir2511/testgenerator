import JSZip from 'jszip';
import { uploadQuestionImage } from './imageCompression';
import { DocxParsedQuestion, parseDocumentXml } from './docxParse';

export type { DocxParsedQuestion } from './docxParse';
export { cleanXmlRunsToFormattedText } from './docxParse';

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

  const questions = parseDocumentXml(docXml, rIdToPublicUrl);

  onProgress?.(`Успешно распознано вопросов: ${questions.length}`);
  return questions;
}
