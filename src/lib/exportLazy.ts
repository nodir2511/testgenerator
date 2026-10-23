// Тяжёлые библиотеки Word/ZIP (docx, jszip) подгружаются при первом скачивании файла,
// а не при открытии вкладок «Генератор» и «Сохранённые билеты».
import type * as DocxExport from './docxExport';
import type * as AnswerKeyExport from './answerKeyExport';

const docx = () => import('./docxExport');
const key = () => import('./answerKeyExport');

export const exportTicketsToDocx = async (...a: Parameters<typeof DocxExport.exportTicketsToDocx>) => (await docx()).exportTicketsToDocx(...a);
export const exportSingleTicketDocx = async (...a: Parameters<typeof DocxExport.exportSingleTicketDocx>) => (await docx()).exportSingleTicketDocx(...a);
export const buildTicketsFile = async (...a: Parameters<typeof DocxExport.buildTicketsFile>) => (await docx()).buildTicketsFile(...a);

export const exportAnswerKey = async (...a: Parameters<typeof AnswerKeyExport.exportAnswerKey>) => (await key()).exportAnswerKey(...a);
export const keyArchiveExtras = async (...a: Parameters<typeof AnswerKeyExport.keyArchiveExtras>) => (await key()).keyArchiveExtras(...a);

export async function withSelectionInfo<T extends { ticket_number: number }>(
  tickets: T[], subjectId: string | null | undefined, params: any,
  load?: (subjectId: string | null | undefined, params: any) => Promise<AnswerKeyExport.SelectionInfos>,
): Promise<Array<T & { selection_info: AnswerKeyExport.SelectionInfos }>> {
  return (await key()).withSelectionInfo(tickets, subjectId, params, load);
}

/** Загрузчик описания выбора глав и тем с общим кэшем; модуль подгружается при первом вызове */
export function makeSelectionInfoLoader() {
  let loader: Promise<ReturnType<typeof AnswerKeyExport.makeSelectionInfoLoader>> | undefined;
  return async (subjectId: string | null | undefined, params: any) => {
    loader ??= key().then((m) => m.makeSelectionInfoLoader());
    return (await loader)(subjectId, params);
  };
}

/** Есть ли у предмета шаблон ключей (то же правило, что keyKindOf; сверяется тестом) */
export const hasKeyTemplate = (subjectName: string): boolean => /хим|физ|биол|тоҷик|таджик|забони/.test((subjectName || '').toLowerCase());
