// @ts-nocheck
// АВТОГЕНЕРАЦИЯ: scripts/sync-docx-shared.mjs. Не редактируйте вручную — правьте src/lib/answerKey.ts.
import JSZip from 'npm:jszip@3';

// Ключи ответов: заполняет Word-шаблон ключей (templates/key/*.docx) ответами билетов.
// Каждый вариант — своя страница: тесты (буква), соответствия (цифры 1–5 напротив A–D),
// открытые (число по одной цифре в клетку).
// Модуль общий для сайта и Edge Functions: scripts/sync-docx-shared.mjs копирует его в supabase/functions/_shared.

export type KeyKind = 'chem' | 'phys' | 'bio' | 'taj';

export function keyKindOf(subjectName: string): KeyKind | null {
  const n = (subjectName || '').toLowerCase();
  if (/хим/.test(n)) return 'chem';
  if (/физ/.test(n)) return 'phys';
  if (/биол/.test(n)) return 'bio';
  if (/тоҷик|таджик|забони/.test(n)) return 'taj';
  return null;
}

export interface KeyTicket {
  ticket_number: number;
  questions: Array<{ question_snapshot: any }>;
}

export interface KeyStats {
  /** Вопросы, для которых в базе нет верного ответа (в ключе клетки остались пустыми) */
  missing: number;
  /** Вопросы, которым не нашлось места в шаблоне */
  overflow: number;
}

const LETTERS = 'ABCDE';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const cellText = (cell: string) =>
  unesc((cell.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')).trim();

// Пишет text в первый абзац пустой клетки, оформляя как отметка абзаца в шаблоне
function putText(cell: string, text: string): string {
  const pPr = cell.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  const rPr = pPr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
  const run = `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  const end = cell.indexOf('</w:p>');
  if (end < 0) return cell;
  return cell.slice(0, end) + run + cell.slice(end);
}

type Slot = { r: number; c: number };
interface Layout {
  tests: Slot[];
  matching: Array<{ rows: number[]; col: number }>;
  open: Array<{ r: number; cols: number[] }>;
}

function layoutOf(texts: string[][]): Layout {
  const tests: Slot[] = [];
  const matching: Array<{ n: number; rows: number[]; col: number }> = [];
  const open: Array<{ n: number; r: number; cols: number[] }> = [];
  texts.forEach((row, r) => {
    if (/^\d+$/.test(row[0] ?? '')) tests.push({ r, c: 1 });
    for (let c = 2; c < row.length - 1; c++) {
      if (!/^\d+$/.test(row[c] ?? '')) continue;
      if (row[c + 1] === 'A') {
        const rows: number[] = [];
        for (let i = 0; texts[r + i] && LETTERS.includes(texts[r + i][c + 1] ?? '#') && texts[r + i][c + 1] === LETTERS[i]; i++) rows.push(r + i);
        matching.push({ n: +row[c], rows, col: c + 2 });
      } else {
        const cols: number[] = [];
        for (let k = c + 1; k < row.length && k <= c + 4; k++) cols.push(k);
        open.push({ n: +row[c], r, cols });
      }
    }
  });
  matching.sort((a, b) => a.n - b.n);
  open.sort((a, b) => a.n - b.n);
  return { tests, matching, open };
}

const sortedByOrder = (items: any[]) => [...items].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

// Ответ на тест: буква верного варианта среди показанных (после перемешивания)
export function testAnswer(snap: any): string | null {
  const opts = sortedByOrder(snap.options || []);
  const i = opts.findIndex((o) => o.is_correct);
  return i >= 0 ? LETTERS[i] ?? String(i + 1) : null;
}

// Ответы на соответствие: для каждой левой строки (A, B, …) — номер подходящего правого элемента
export function matchingAnswer(snap: any): Array<string | null> {
  const items = snap.matching_items || [];
  const left = sortedByOrder(items.filter((m: any) => m.side === 'left'));
  const right = sortedByOrder(items.filter((m: any) => m.side === 'right'));
  return left.map((l: any) => {
    const i = right.findIndex((r: any) => l.correct_match_id && r.id === l.correct_match_id);
    return i >= 0 ? String(i + 1) : null;
  });
}

export function openAnswer(snap: any): string | null {
  const v = snap.correct_numeric_answer;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return (Number.isFinite(n) ? String(n) : String(v)).replace('.', ',');
}

function fillTable(tbl: string, tests: any[], matching: any[], open: any[], stats: KeyStats): string {
  const rowRe = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
  const cellRe = /<w:tc>[\s\S]*?<\/w:tc>/g;
  const rows = (tbl.match(rowRe) || []).map((r) => r.match(cellRe) || []);
  const texts = rows.map((cells) => cells.map(cellText));
  const lay = layoutOf(texts);
  const put = new Map<string, string>();
  const set = (r: number, c: number, v: string) => put.set(`${r}:${c}`, v);

  tests.forEach((q, i) => {
    const slot = lay.tests[i];
    const a = testAnswer(q);
    if (!a) stats.missing++;
    if (!slot) { stats.overflow++; return; }
    if (a) set(slot.r, slot.c, a);
  });
  matching.forEach((q, i) => {
    const blk = lay.matching[i];
    const ans = matchingAnswer(q);
    if (ans.length === 0 || ans.some((x) => x === null)) stats.missing++;
    if (!blk) { stats.overflow++; return; }
    ans.forEach((a, k) => { if (a && blk.rows[k] !== undefined) set(blk.rows[k], blk.col, a); });
  });
  open.forEach((q, i) => {
    const blk = lay.open[i];
    const a = openAnswer(q);
    if (a === null) stats.missing++;
    if (!blk) { stats.overflow++; return; }
    if (a === null) return;
    const chars = [...a];
    const n = blk.cols.length;
    const parts = chars.length <= n ? chars : [...chars.slice(0, n - 1), chars.slice(n - 1).join('')];
    parts.forEach((ch, k) => set(blk.r, blk.cols[k], ch));
  });

  let ri = -1;
  return tbl.replace(rowRe, (row) => {
    ri++;
    let ci = -1;
    return row.replace(cellRe, (cell) => {
      ci++;
      const v = put.get(`${ri}:${ci}`);
      return v === undefined ? cell : putText(cell, v);
    });
  });
}

// Последний «<w:p» (а не «<w:pPr») перед позицией
function paragraphStart(xml: string, pos: number): number {
  let i = pos;
  while (i >= 0) {
    i = xml.lastIndexOf('<w:p', i);
    if (i < 0) return -1;
    const ch = xml[i + 4];
    if (ch === ' ' || ch === '>') return i;
    i--;
  }
  return -1;
}

// Номера через запятую; три и более подряд — диапазоном («1–4», «1, 3, 5–7»)
export function numberList(nums: number[], collapse: boolean): string {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  if (!collapse) return s.join(', ');
  const parts: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    if (j - i >= 2) parts.push(`${s[i]}–${s[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(s[k]));
    i = j + 1;
  }
  return parts.join(', ');
}

export interface SelectionChip { chapter: number; full: boolean; picked: number; total: number; topics: string }

/** То же, что selectionInfo, но по главам — для карточек (чипы с долей выбранных тем) */
export function selectionChips(
  chapters: Array<{ id: string; order_index: number }>,
  topics: Array<{ id: string; chapter_id: string; order_index: number }>,
  chapterIds: string[],
  topicIds: string[],
): SelectionChip[] {
  const picked = new Set(topicIds);
  const out: SelectionChip[] = [];
  for (const ch of [...chapters].sort((a, b) => a.order_index - b.order_index)) {
    const all = topics.filter((t) => t.chapter_id === ch.id);
    if (topicIds.length) {
      const sel = all.filter((t) => picked.has(t.id));
      if (!sel.length) continue;
      out.push({ chapter: ch.order_index, full: sel.length === all.length, picked: sel.length, total: all.length, topics: numberList(sel.map((t) => t.order_index), true) });
    } else if (!chapterIds.length || chapterIds.includes(ch.id)) {
      out.push({ chapter: ch.order_index, full: true, picked: all.length, total: all.length, topics: '' });
    }
  }
  return out;
}

/**
 * Какие главы и темы вошли в билеты: «Главы 1, 2, 3 — полностью; глава 4 — темы 1–4».
 * Выбор: темы (если заданы), иначе главы, иначе весь предмет.
 */
export function selectionInfo(
  chapters: Array<{ id: string; order_index: number }>,
  topics: Array<{ id: string; chapter_id: string; order_index: number }>,
  chapterIds: string[],
  topicIds: string[],
  lang: 'ru' | 'tg' = 'ru',
): string | null {
  const picked = new Set(topicIds);
  const full: number[] = [];
  const partial: Array<{ n: number; nums: number[] }> = [];
  for (const ch of [...chapters].sort((a, b) => a.order_index - b.order_index)) {
    const all = topics.filter((t) => t.chapter_id === ch.id);
    if (topicIds.length) {
      const sel = all.filter((t) => picked.has(t.id));
      if (!sel.length) continue;
      if (sel.length === all.length) full.push(ch.order_index);
      else partial.push({ n: ch.order_index, nums: sel.map((t) => t.order_index) });
    } else if (!chapterIds.length || chapterIds.includes(ch.id)) {
      full.push(ch.order_index);
    }
  }
  const tg = lang === 'tg';
  const parts: string[] = [];
  if (full.length) {
    const n = numberList(full, false);
    parts.push(tg ? `${full.length > 1 ? 'бобҳои' : 'боби'} ${n} — пурра` : `${full.length > 1 ? 'главы' : 'глава'} ${n} — полностью`);
  }
  for (const p of partial) {
    const n = numberList(p.nums, true);
    const many = p.nums.length > 1;
    parts.push(tg ? `боби ${p.n} — ${many ? 'мавзӯъҳои' : 'мавзӯи'} ${n}` : `глава ${p.n} — ${many ? 'темы' : 'тема'} ${n}`);
  }
  if (!parts.length) return null;
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Шапка шаблона («ҶАВОБИ ДУРУСТИ / саволу … – А.5») заменяется на два свои текста
function setParagraphText(xml: string, marker: string, text: string, size?: number): string {
  const at = xml.indexOf(marker);
  if (at < 0) return xml;
  const ps = paragraphStart(xml, at);
  const pe = xml.indexOf('</w:p>', at) + 6;
  let para = xml.slice(ps, pe);
  const runs = para.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || [];
  const run0 = runs[0];
  if (!run0) return xml;
  let first = run0.replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/, () => `<w:t xml:space="preserve">${esc(text)}</w:t>`);
  if (size) first = first.replace(/<w:sz w:val="\d+"\/>/, `<w:sz w:val="${size}"/>`).replace(/<w:szCs w:val="\d+"\/>/, `<w:szCs w:val="${size}"/>`);
  para = para.replace(run0, () => first);
  for (const r of runs.slice(1)) para = para.replace(r, () => '');
  return xml.slice(0, ps) + para + xml.slice(pe);
}

export async function buildAnswerKeyDocx(
  templateBytes: Uint8Array | ArrayBuffer,
  tickets: KeyTicket[],
  /** Что вошло в билеты (selectionInfo); если задано, заменяет заголовок в шапке шаблона */
  info?: string | null,
): Promise<{ bytes: Uint8Array; stats: KeyStats }> {
  const zip = await JSZip.loadAsync(templateBytes);
  if (info) {
    for (const name of Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n))) {
      let h = await zip.file(name)!.async('string');
      if (!h.includes('ДУРУСТИ')) continue;
      h = setParagraphText(h, 'ДУРУСТИ', 'ВКЛЮЧЕНО В БИЛЕТЫ');
      h = setParagraphText(h, 'саволу', info, 24);
      zip.file(name, h);
    }
  }
  const xml = await zip.file('word/document.xml')!.async('string');
  const bodyAt = xml.indexOf('<w:body>') + '<w:body>'.length;
  const sectAt = xml.lastIndexOf('<w:sectPr');
  const head = xml.slice(0, bodyAt);
  const tail = xml.slice(sectAt);

  // Прототип варианта: всё до разрыва страницы после первой таблицы
  const tblEnd = xml.indexOf('</w:tbl>');
  const brAt = xml.indexOf('<w:br w:type="page"/>', tblEnd);
  let protoEnd = sectAt;
  let breakPara = '';
  if (brAt >= 0 && brAt < sectAt) {
    const ps = paragraphStart(xml, brAt);
    protoEnd = xml.indexOf('</w:p>', brAt) + '</w:p>'.length;
    breakPara = xml.slice(ps, protoEnd);
  }
  const proto = xml.slice(bodyAt, protoEnd);

  const stats: KeyStats = { missing: 0, overflow: 0 };
  const blocks = tickets.map((t, idx) => {
    let b = proto;
    // «Вариант(и) N»
    const vAt = b.indexOf('Вариант(и)');
    if (vAt >= 0) {
      const ps = paragraphStart(b, vAt);
      const pe = b.indexOf('</w:p>', vAt) + 6;
      const para = b.slice(ps, pe);
      const m = [...para.matchAll(/<w:t(?:\s[^>]*)?>\s*\d+\s*<\/w:t>/g)].pop();
      if (m) {
        const fixed = para.slice(0, m.index!) + `<w:t>${t.ticket_number}</w:t>` + para.slice(m.index! + m[0].length);
        b = b.slice(0, ps) + fixed + b.slice(pe);
      }
    }
    const qs = t.questions.map((q) => q.question_snapshot);
    const tests = qs.filter((q) => q.type === 'test');
    const matching = qs.filter((q) => q.type === 'matching');
    const open = qs.filter((q) => q.type === 'open');
    b = b.replace(/<w:tbl>[\s\S]*<\/w:tbl>/, (tbl) => fillTable(tbl, tests, matching, open, stats));
    if (idx === tickets.length - 1 && breakPara) b = b.replace(breakPara, '');
    return b;
  });

  zip.file('word/document.xml', head + blocks.join('') + tail);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes, stats };
}
