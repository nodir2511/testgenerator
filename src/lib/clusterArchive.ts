// Экзамен-кластер из архивов обычного генератора: по одному ZIP на предмет (папки «Русский» и «Тоҷикӣ» с вариантами
// и файл ключей). Без браузера и базы: сам ZIP разбирается здесь, экран — components/ClusterFromTickets.tsx.
import JSZip from 'jszip';
import { orderByType, snapshotFromPaired, type Snap } from './clusterTickets';

export interface ArchiveVariant {
  number: number;
  /** Задания в порядке книжки (тесты, соответствия, открытые). Ответов в них нет: ключи берутся готовыми файлами */
  snaps: Snap[];
  /** Задания, которые не удалось разобрать (в книжку не попали) */
  skipped: string[];
}

export interface ParsedArchive {
  variants: ArchiveVariant[];
  /** Предупреждения по архиву целиком (нет ключа, нет перевода и т. п.) */
  warnings: string[];
  /** Готовый файл ключей из архива (Ключи – ….docx) — кладётся в книжку как есть, меняется только шапка; нет файла — null */
  keyBytes: Uint8Array | null;
}

type Entry = { name: string; file: JSZip.JSZipObject };

/** «Вариант 3.docx» → русский, «Варианти 3.docx» → таджикский; Variant — английский (читается как русский) */
function variantEntry(name: string): { n: number; tg: boolean } | null {
  const base = name.split('/').pop() || '';
  const m = base.match(/^(Вариант(?:и)?|Variant)\s*(\d+)\.docx$/i);
  if (!m) return null;
  return { n: Number(m[2]), tg: /и$/i.test(m[1]) };
}

async function parseVariantFile(
  bytes: Uint8Array, name: string,
  parse: (f: File) => Promise<{ questions: any[] }>,
): Promise<any[]> {
  const f = new File([bytes as BlobPart], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  return (await parse(f)).questions;
}

/** Разбор архива одного предмета. Ошибка — если нет вариантов или русские и таджикские не совпадают по номерам */
export async function parseSubjectArchive(file: File | Blob): Promise<ParsedArchive> {
  // Разбор Word грузится только когда нужен
  const [{ parseDocxFile }, { pairBilingual }] = await Promise.all([import('./docxImport'), import('./docxPair')]);
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const files: Entry[] = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith('__MACOSX/')).map((name) => ({ name, file: zip.files[name] }));

  const ru = new Map<number, Entry>();
  const tg = new Map<number, Entry>();
  for (const e of files) {
    const v = variantEntry(e.name);
    if (!v) continue;
    (v.tg ? tg : ru).set(v.n, e);
  }
  if (!ru.size && !tg.size) throw new Error('В архиве нет файлов «Вариант N.docx» и «Варианти N.docx»');
  if (!ru.size) throw new Error('В архиве нет русских вариантов (папка «Русский»)');
  if (!tg.size) throw new Error('В архиве нет таджикских вариантов (папка «Тоҷикӣ»)');
  const onlyRu = [...ru.keys()].filter((n) => !tg.has(n));
  const onlyTg = [...tg.keys()].filter((n) => !ru.has(n));
  if (onlyRu.length || onlyTg.length) {
    throw new Error(`Варианты русского и таджикского не совпадают: ${onlyRu.length ? `нет таджикского для ${onlyRu.join(', ')}` : ''}${onlyRu.length && onlyTg.length ? '; ' : ''}${onlyTg.length ? `нет русского для ${onlyTg.join(', ')}` : ''}`);
  }

  // Ключи: Word в корне архива, имя начинается с «Ключи»
  const warnings: string[] = [];
  const keyEntry = files.find((e) => !e.name.includes('/') && /^Ключи/i.test(e.name) && /\.docx$/i.test(e.name));
  const keyBytes = keyEntry ? await keyEntry.file.async('uint8array') : null;
  if (!keyBytes) warnings.push('В архиве нет файла ключей (Ключи – ….docx): ключей по этому предмету в итоговом архиве не будет');

  const numbers = [...ru.keys()].sort((a, b) => a - b);
  const parse = (f: File) => parseDocxFile(f);
  const variants: ArchiveVariant[] = [];
  for (const n of numbers) {
    const [rq, tq] = await Promise.all([
      ru.get(n)!.file.async('uint8array').then((b) => parseVariantFile(b, ru.get(n)!.name, parse)),
      tg.get(n)!.file.async('uint8array').then((b) => parseVariantFile(b, tg.get(n)!.name, parse)),
    ]);
    if (!rq.length) throw new Error(`Вариант ${n}: в русском файле не найдено заданий`);
    const pairs = pairBilingual(rq, tq);
    const skipped: string[] = [];
    const snaps: Snap[] = [];
    pairs.forEach((p, j) => {
      if (p.errors.length) { skipped.push(`№${p.num}: ${p.errors[0]}`); return; }
      if (p.type === 'test' && (!p.options || p.options.length < 2)) { skipped.push(`№${p.num}: меньше двух вариантов ответа`); return; }
      snaps.push(snapshotFromPaired(p, `a${n}-${j + 1}`));
    });
    variants.push({ number: n, snaps: orderByType(snaps), skipped });
  }
  return { variants, warnings, keyBytes };
}
