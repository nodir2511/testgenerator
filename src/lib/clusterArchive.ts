// Экзамен-кластер из архивов обычного генератора: по одному ZIP на предмет (папки «Русский» и «Тоҷикӣ» с вариантами
// и файл ключей). Без браузера и базы: сам ZIP разбирается здесь, экран — components/ClusterFromTickets.tsx.
import JSZip from 'jszip';
import { keyKindOf, readKeyAnswers, type KeyAnswers } from './answerKey';
import { orderByType, snapshotFromPaired, withAnswer, type Snap } from './clusterTickets';
import { CLUSTER_SUBJECTS, CLUSTER_KINDS, type ClusterKind } from './clusterSlots';

export interface ArchiveVariant {
  number: number;
  /** Задания в порядке книжки (тесты, соответствия, открытые) с ответами из ключа */
  snaps: Snap[];
  /** Задания, которые не удалось разобрать (в книжку не попали) */
  skipped: string[];
  /** Заданий без ответа в ключе (0, если ключа в архиве нет) */
  noAnswer: number;
}

export interface ParsedArchive {
  variants: ArchiveVariant[];
  /** Предупреждения по архиву целиком (нет ключа, нет перевода и т. п.) */
  warnings: string[];
  /** Готовый файл ключей из архива (Ключи – ….docx) — кладётся в книжку как есть, меняется только шапка; нет файла — null */
  keyBytes: Uint8Array | null;
  /** zip — разобран из архива (ключ берётся готовым файлом); db — билеты набора из базы (ключ собирается по ответам) */
  source: 'zip' | 'db';
  /** Предмет, определённый по архиву (строка «к субтесту по …» в ключе, имя файла); null — не определился */
  kind: ClusterKind | null;
}

type Entry = { name: string; file: JSZip.JSZipObject };

const KEY_NAME = /^(Ключи|Калид|Key)/i;

/**
 * Файл варианта в архиве. Стандартные имена — «Русский/Вариант 3.docx», «Тоҷикӣ/Варианти 3.docx», «Variant 3.docx»;
 * нестандартные («вариант_3.docx», «Вар 3 рус.docx», папка «РУС») тоже узнаются: номер — первое число в имени,
 * язык — по папке, иначе по началу имени. Книжки всё равно собираются со стандартными именами.
 */
function variantEntry(name: string): { n: number; tg: boolean; standard: boolean } | null {
  const parts = name.split('/');
  const base = parts.pop() || '';
  if (!/\.docx$/i.test(base) || base.startsWith('~$') || KEY_NAME.test(base)) return null;
  const num = base.match(/\d+/);
  if (!num) return null;
  const folder = parts.join('/');
  let tg: boolean | null = null;
  if (/(?:^|\/)\s*(?:тоҷ|точ|тадж|taj|tj|tg)/i.test(folder)) tg = true;
  else if (/(?:^|\/)\s*(?:рус|ru)/i.test(folder)) tg = false;
  else if (/^Варианти/i.test(base)) tg = true;
  else if (/^(Вариант|Variant)/i.test(base)) tg = false;
  else if (/тадж|тоҷ|точ|\b(tj|tg)\b/i.test(base)) tg = true;
  else if (/рус|\bru\b/i.test(base)) tg = false;
  if (tg === null) return null;
  const standard = new RegExp(`^${tg ? 'Варианти' : '(?:Вариант|Variant)'} ${Number(num[0])}\.docx$`).test(base);
  return { n: Number(num[0]), tg, standard };
}

async function parseVariantFile(
  bytes: Uint8Array, name: string,
  parse: (f: File) => Promise<{ questions: any[] }>,
): Promise<any[]> {
  const f = new File([bytes as BlobPart], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  return (await parse(f)).questions;
}

/** Ответы из ключа ставятся заданиям: по виду и порядку среди заданий своего вида */
function applyKey(snaps: Snap[], key: KeyAnswers | undefined): { snaps: Snap[]; noAnswer: number } {
  if (!key) return { snaps, noAnswer: 0 };
  const idx = { test: 0, matching: 0, open: 0 };
  let noAnswer = 0;
  const out = snaps.map((s) => {
    const kind = s.type as keyof typeof idx;
    const raw = key[kind]?.[idx[kind]++];
    if (!raw || (kind === 'matching' && /^·+$/.test(raw))) { noAnswer++; return s; }
    return withAnswer(s, raw);
  });
  return { snaps: out, noAnswer };
}

/** Предмет архива: по строке «к субтесту по …» в ключе, иначе по имени архива или файла ключей */
export function detectArchiveKind(names: string[], keyDocXml?: string | null): ClusterKind | null {
  const text = (keyDocXml || '').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
  const m = text.match(/к субтесту по ([^–\-\n]+?)\s*(?:[–-]|\n|$)/);
  if (m) {
    const word = m[1].trim().toLowerCase();
    const kind = CLUSTER_KINDS.find((k) => CLUSTER_SUBJECTS[k].dative === word);
    if (kind) return kind;
  }
  for (const n of names) {
    const k = keyKindOf(n);
    if (k && (CLUSTER_KINDS as string[]).includes(k)) return k as ClusterKind;
  }
  return null;
}

/** Разбор архива одного предмета. Ошибка — если нет вариантов или русские и таджикские не совпадают по номерам */
export async function parseSubjectArchive(file: File | Blob): Promise<ParsedArchive> {
  // Разбор Word грузится только когда нужен
  const [{ parseDocxFile }, { pairBilingual }] = await Promise.all([import('./docxImport'), import('./docxPair')]);
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const files: Entry[] = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith('__MACOSX/')).map((name) => ({ name, file: zip.files[name] }));

  const ru = new Map<number, Entry>();
  const tg = new Map<number, Entry>();
  let renamed = 0;
  for (const e of files) {
    const v = variantEntry(e.name);
    if (!v) continue;
    if (!v.standard) renamed++;
    (v.tg ? tg : ru).set(v.n, e);
  }
  if (!ru.size && !tg.size) throw new Error('В архиве нет файлов «Вариант N.docx» и «Варианти N.docx»');
  // Предмет на одном языке: таджикский сайт выгружает только «Варианти N», английский — только «Variant N».
  // Единственный язык берётся для обеих книжек (русская получает тот же текст)
  const warnings: string[] = [];
  if (renamed) warnings.push(`Имена файлов в архиве не по стандарту (${renamed}): узнаны по номеру и папке, в книжках имена будут стандартными (Вариант N / Варианти N)`);
  if (!ru.size) {
    tg.forEach((e, n) => ru.set(n, e));
    warnings.push('В архиве только таджикские варианты (предмет на одном языке): русская книжка получит тот же таджикский текст');
  } else if (!tg.size) {
    if (![...ru.values()].every((e) => /^Variant/i.test(e.name.split('/').pop() || ''))) throw new Error('В архиве нет таджикских вариантов (папка «Тоҷикӣ»)');
    ru.forEach((e, n) => tg.set(n, e));
    warnings.push('В архиве только английские варианты (предмет на одном языке): таджикская книжка получит тот же английский текст');
  }
  const onlyRu = [...ru.keys()].filter((n) => !tg.has(n));
  const onlyTg = [...tg.keys()].filter((n) => !ru.has(n));
  if (onlyRu.length || onlyTg.length) {
    throw new Error(`Варианты русского и таджикского не совпадают: ${onlyRu.length ? `нет таджикского для ${onlyRu.join(', ')}` : ''}${onlyRu.length && onlyTg.length ? '; ' : ''}${onlyTg.length ? `нет русского для ${onlyTg.join(', ')}` : ''}`);
  }

  // Ключи: Word с именем на «Ключи» (в корне или в любой папке; ближайший к корню)
  const keyEntry = files
    .filter((e) => { const b = e.name.split('/').pop() || ''; return KEY_NAME.test(b) && /\.docx$/i.test(b) && !b.startsWith('~$'); })
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
  const keyBytes = keyEntry ? await keyEntry.file.async('uint8array') : null;
  let keys: KeyAnswers[] = [];
  let keyDoc: string | null = null;
  if (keyBytes) {
    const kz = await JSZip.loadAsync(keyBytes);
    keyDoc = (await kz.file('word/document.xml')?.async('string')) ?? null;
    keys = keyDoc ? readKeyAnswers(keyDoc) : [];
    if (!keys.length) warnings.push(`Не удалось прочитать ответы из файла «${keyEntry!.name}»: ключ в итоговом архиве будет, но ответов в сохранённой книжке не будет`);
  } else {
    warnings.push('В архиве нет файла ключей (Ключи – ….docx): ключей по этому предмету в итоговом архиве не будет');
  }
  const names = [('name' in file ? (file as File).name : '') || '', keyEntry?.name ?? ''];

  const numbers = [...ru.keys()].sort((a, b) => a - b);
  const parse = (f: File) => parseDocxFile(f);
  const variants: ArchiveVariant[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const n = numbers[i];
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
    // Ключ варианта: по номеру в шапке таблицы, иначе по порядку таблиц
    const key = keys.find((k) => k.variant === n) ?? (keys.every((k) => k.variant === null) ? keys[i] : undefined);
    if (keys.length && !key) warnings.push(`Вариант ${n}: в ключах нет таблицы этого варианта`);
    const withKey = applyKey(orderByType(snaps), key);
    variants.push({ number: n, snaps: withKey.snaps, skipped, noAnswer: key ? withKey.noAnswer : 0 });
  }
  return { variants, warnings, keyBytes, source: 'zip', kind: detectArchiveKind(names, keyDoc) };
}
