// Бланки ответов для печати (A4) и раскладки для распознавания по фото.
// Запуск: node scripts/omr-blanks.mjs
//   → scratch/blanks/out/<id>.html (печать в PDF: Edge/Chrome, масштаб 100 %) и <id>.layout.json
//   → src/lib/omr/layouts.generated.ts (раскладки, их читает распознавание; руками не править)
// Все размеры в миллиметрах. Начало координат бланка — его левый верхний угол.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'scratch', 'blanks', 'out');
fs.mkdirSync(OUT, { recursive: true });

const PAGE = { w: 210, h: 297 };
const LETTERS = ['A', 'B', 'C', 'D'];
const VARIANTS = 4; // на бланке четыре варианта (кружки 1–4)

// Виды бланков: высота, сколько на листе, отступ сверху, вертикали шапки и меток.
// pitch — шаг бланков на листе, если он больше высоты: бланк стоит посередине своей доли листа,
// линии разреза идут между долями. Координаты внутри бланка от pitch не зависят.
const KINDS = {
  // 18 тестов, 2 соответствия, 7 открытых
  k18: { h: 99, perPage: 3, top: 0, total: 27, markY: [6, 88], headY: 15.5, ruleY: 17.2, titleY: 24.2, varNumY: 10.9, varY: 14.3, varX: 175, varStep: 5.4, varD: 4.2, codeY: 88.5, footY: 91 },
  // 20 тестов, 4 соответствия, 2 открытых
  k20: { h: 99, perPage: 3, top: 0, total: 26, markY: [6, 88], headY: 15.5, ruleY: 17.2, titleY: 24.2, varNumY: 10.9, varY: 14.3, varX: 175, varStep: 5.4, varD: 4.2, codeY: 88.5, footY: 91 },
  // 8 тестов, 2 соответствия, 2 открытых — расположение как в прежнем бланке, пять на листе:
  // лист режется на пять равных частей (по 59,4 мм), от линии разреза до угловых меток по 7,45 мм
  // «Биология ежедневный»: 20 + 4 + 2, сжатая полоска под «Тестом № 1» (рисунок бланка — как прислал заказчик), два на листе
  k20c: { h: 65.5, perPage: 2, pitch: PAGE.h / 2, top: 0, total: 26, markY: [1, 60.5], headY: 10.9, varNumY: 6.6, varY: 9.8, varX: 175, varStep: 5, varD: 4, codeY: 61, footY: 63.5 },
  k12: { h: 47.5, perPage: 5, pitch: PAGE.h / 5, top: 0, total: 12, markY: [1.5, 42], headY: 8.3, ruleY: 9.8, titleY: 14, varNumY: 3.9, varY: 7.2, varX: 175, varStep: 5, varD: 4, codeY: 43.2, footY: 45.7 },
};

const SUBJECTS = [
  { id: 'chem', code: 1, title: 'ХИМИЯ', kind: 'k18', file: 'Бланк химия 27' },
  { id: 'bio', code: 2, title: 'БИОЛОГИЯ', kind: 'k20', file: 'Бланк биология 26' },
  { id: 'phys', code: 3, title: 'ФИЗИКА', kind: 'k18', file: 'Бланк физика 27' },
  // open: 5 — пять клеток под открытый ответ (ответ из пяти цифр); у остальных бланков клеток четыре
  { id: 'taj', code: 4, open: 5, title: 'ЗАБОНИ ТОҶИКӢ (ТАДЖИКСКИЙ ЯЗЫК)', kind: 'k20', file: 'Бланк таджикский язык 26' },
  { id: 'chemphys', code: 5, title: 'ХИМИЯ/ФИЗИКА', kind: 'k12', file: 'Бланк химия-физика 12' },
  // Только для печати: раскладка и код те же, что у `like`, меняется лишь название предмета.
  // Бланк читается как `like` (состав билета тот же), в layouts.generated.ts такие не попадают.
  { id: 'hist', like: 'bio', code: 2, title: 'ИСТОРИЯ', kind: 'k20', file: 'Бланк история 26' },
  { id: 'law', like: 'bio', code: 2, title: 'ПРАВО', kind: 'k20', file: 'Бланк право 26' },
  { id: 'eng', like: 'taj', code: 4, open: 5, title: 'АНГЛИЙСКИЙ ЯЗЫК', kind: 'k20', file: 'Бланк английский язык 26' },
  { id: 'math', like: 'chem', code: 1, title: 'МАТЕМАТИКА', kind: 'k18', file: 'Бланк математика 27' },
  // «Биология ежедневный»: два на листе; сверху шапка и «Тест № 1» (20 ответов от руки, бот их не читает),
  // снизу «Тест № 2» (20 + 4 + 2) в своих метках, свой код 6 — бот читает его наравне с `bio` и `taj`.
  { id: 'bioday', code: 6, daily: true, title: 'БИОЛОГИЯ', kind: 'k20c', file: 'Бланк биология ежедневный' },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const n = (v) => Number(v.toFixed(2));

function buildStrip(subject) {
  const K = KINDS[subject.kind];
  const svg = [];
  const layout = { markers: [], code: [], variant: [], tests: [], matching: [], open: [] };
  const text = (x, y, s, o = {}) =>
    svg.push(`<text x="${n(x)}" y="${n(y)}" font-size="${o.size ?? 3.5}" font-weight="${o.bold ? 700 : 400}" text-anchor="${o.anchor ?? 'start'}">${esc(s)}</text>`);
  const circle = (x, y, d) => svg.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(d / 2)}" fill="#fff" stroke="#000" stroke-width="0.3"/>`);
  const rect = (x, y, w, h, o = {}) =>
    svg.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${o.fill ?? 'none'}" stroke="${o.fill ? 'none' : '#000'}" stroke-width="${o.sw ?? 0.4}"/>`);

  // Угловые метки
  const M = 4;
  for (const y of K.markY) for (const x of [7, 199]) {
    rect(x, y, M, M, { fill: '#000' });
    layout.markers.push({ x: x + M / 2, y: y + M / 2, size: M });
  }
  // Код бланка: первая клетка всегда чёрная (по ней видно, где низ), затем три бита
  const bits = [1, (subject.code >> 2) & 1, (subject.code >> 1) & 1, subject.code & 1];
  bits.forEach((b, i) => {
    const x = 178 + i * 5;
    if (b) rect(x, K.codeY, 3, 3, { fill: '#000' });
    layout.code.push({ x: x + 1.5, y: K.codeY + 1.5, size: 3, bit: b });
  });
  text(175, K.footY, `${subject.id}-${K.total} · v1`, { size: 2.2, anchor: 'end' });

  if (subject.daily) {
    // Шапка общая на половину листа (buildDailyPage), здесь — только заголовок второго теста
    text(98, K.headY, `${subject.title} · ТЕСТ № 2`, { size: 3.8, bold: true, anchor: 'middle' });
    text(K.varX - 4, K.headY, 'Вариант:', { anchor: 'end' });
  } else {
    // Шапка, как в прежнем бланке
    text(14, K.headY, 'Ному насаб (ФИО)');
    text(86, K.headY, 'Филиал');
    text(114, K.headY, 'Гурӯҳи (Группа)');
    text(152, K.headY, 'Вариант(и)');
    svg.push(`<line x1="14" y1="${K.ruleY}" x2="198" y2="${K.ruleY}" stroke="#000" stroke-width="0.3"/>`);
    text(78, K.titleY, subject.title, { bold: true, anchor: 'middle' });
  }
  for (let i = 0; i < VARIANTS; i++) {
    const x = K.varX + i * K.varStep;
    text(x, K.varNumY, String(i + 1), { size: 2.6, bold: true, anchor: 'middle' });
    circle(x, K.varY, K.varD);
    layout.variant.push({ value: i + 1, x, y: K.varY, d: K.varD });
  }

  // Тест: номер и четыре кружка A–D
  const testCol = (x0, first, rows, y0 = 36, step = 6.2, o = {}) => {
    const off = o.off ?? 10, sp = o.sp ?? 5.6, d = o.d ?? 4.4, num = o.num ?? 6.5;
    LETTERS.forEach((l, k) => text(x0 + off + k * sp, y0 - 3.6, l, { size: 2.9, bold: true, anchor: 'middle' }));
    for (let r = 0; r < rows; r++) {
      const y = y0 + r * step, q = first + r;
      text(x0 + num, y + 1.25, String(q), { bold: true, anchor: 'end' });
      const options = LETTERS.map((l, k) => {
        const x = x0 + off + k * sp;
        circle(x, y, d);
        return { value: l, x, y, d };
      });
      layout.tests.push({ q, options });
    }
  };
  // Соответствие: рамка, строки A–D, столбцы 1–5
  const frame = (fx, fy, q, o = {}) => {
    const d = o.d ?? 4.2, step = o.step ?? 5.9, first = o.first ?? 8.6, h = o.h ?? 29.5;
    rect(fx, fy, 30.5, h);
    text(fx - 1.2, fy + 4, String(q), { bold: true, anchor: 'end' });
    for (let k = 0; k < 5; k++) text(fx + 7.5 + k * 5, fy + first - 4.4, String(k + 1), { size: 2.8, bold: true, anchor: 'middle' });
    const rows = LETTERS.map((l, r) => {
      const y = fy + first + r * step;
      text(fx + 2.6, y + 1.1, l, { size: 3.2, bold: true, anchor: 'middle' });
      const options = [];
      for (let k = 0; k < 5; k++) {
        const x = fx + 7.5 + k * 5;
        circle(x, y, d);
        options.push({ value: k + 1, x, y, d });
      }
      return { row: l, options };
    });
    layout.matching.push({ q, frame: { x: fx, y: fy, w: 30.5, h }, rows });
  };
  // Открытый вопрос: номер и клетки для цифр (четыре по 6 мм; пять — по 5,5 мм, чтобы уместиться до угловой метки)
  const open = (x0, yc, q, cells = 4, w = 6) => {
    text(x0 + 6, yc + 1.25, String(q), { bold: true, anchor: 'end' });
    const boxes = [];
    for (let i = 0; i < cells; i++) {
      const x = x0 + 7.5 + i * w;
      rect(x, yc - 3.5, w, 7);
      boxes.push({ x, y: yc - 3.5, w, h: 7 });
    }
    layout.open.push({ q, boxes });
  };

  if (subject.kind === 'k18') {
    [14, 49, 84].forEach((x0, c) => testCol(x0, c * 6 + 1, 6));
    frame(123, 29.5, 19);
    frame(164, 29.5, 20);
    open(118.5, 66.5, 21);
    open(159.5, 66.5, 22);
    for (let i = 0; i < 5; i++) open(14 + i * 37, 79.5, 23 + i);
  } else if (subject.kind === 'k20') {
    for (let c = 0; c < 5; c++) testCol(14 + c * 37, c * 4 + 1, 4);
    [20.5, 58, 95.5, 133].forEach((fx, i) => frame(fx, 60, 21 + i));
    const five = subject.open === 5;
    for (const [yc, q] of [[68, 25], [80, 26]]) five ? open(163.5, yc, q, 5, 5.5) : open(166, yc, q);
  } else if (subject.kind === 'k20c') {
    // Как в бланке заказчика: семь столбцов тестов по три (19–20 в последнем), под пунктиром рамки 21–24 и клетки 25, 26
    for (let c = 0; c < 7; c++) testCol(13 + c * 26, c * 3 + 1, c < 6 ? 3 : 2, 19, 5, { off: 8, sp: 4.8, d: 4, num: 5.6 });
    svg.push('<line x1="12" y1="32.5" x2="198" y2="32.5" stroke="#000" stroke-width="0.25" stroke-dasharray="1 0.8"/>');
    const small = { d: 4, step: 5, first: 7.2, h: 25.3 };
    [20, 56, 92, 128].forEach((fx, i) => frame(fx, 34, 21 + i, small));
    open(162, 41.5, 25);
    open(162, 53.5, 26);
  } else {
    // Как в прежнем бланке: 1–4 и 5–8 слева, рамки 9 и 10 в середине, 11 и 12 справа
    [14, 44].forEach((x0, c) => testCol(x0, c * 4 + 1, 4, 22.2, 6));
    const small = { d: 4, step: 5.1, first: 7.6, h: 25.4 };
    frame(80, 19.3, 9, small);
    frame(118.5, 19.3, 10, small);
    open(166.5, 25.5, 11);
    open(166.5, 35.5, 12);
  }
  return { svg: svg.join('\n'), layout, K };
}

// Шапка и «Тест № 1» (ответы от руки) над полоской бланка `bioday`; y — от верха половины листа
const DAILY = { half: PAGE.h / 2, stripTop: 76 };
function dailyHead(subject) {
  const svg = [];
  const text = (x, y, s, o = {}) =>
    svg.push(`<text x="${n(x)}" y="${n(y)}" font-size="${o.size ?? 3.5}" font-weight="${o.bold ? 700 : 400}" text-anchor="${o.anchor ?? 'start'}">${esc(s)}</text>`);
  const line = (x1, y1, x2, sw = 0.25) => svg.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y1)}" stroke="#000" stroke-width="${sw}"/>`);
  text(105, 6.6, 'ВАРАҚАИ ҶАВОБҲО (ЛИСТ ОТВЕТОВ)', { size: 3.6, bold: true, anchor: 'middle' });
  line(14, 8.4, 198, 0.4);
  const fields = [['ФИО:', 20, 90], ['Поток:', 104, 120], ['Группа:', 136, 154], ['Вариант:', 170, 190]];
  for (const [label, x, x2] of fields) {
    text(x - 1, 12.9, label, { anchor: 'end' });
    line(x, 13.3, x2);
  }
  line(14, 15, 198, 0.4);
  text(105, 20.6, `${subject.title} · ТЕСТ № 1`, { size: 3.8, bold: true, anchor: 'middle' });
  // 20 ответов от руки: два столбца по десять строк (1–10, 11–20)
  for (let c = 0; c < 2; c++) for (let r = 0; r < 10; r++) {
    const x0 = 14 + c * 92, y = 26.5 + r * 5.2;
    text(x0 + 7, y, `${c * 10 + r + 1}.`, { bold: true, anchor: 'end' });
    line(x0 + 9, y + 0.3, x0 + 88);
  }
  return svg.join('\n');
}

function buildPage(subject) {
  const { svg, layout, K } = buildStrip(subject);
  if (subject.daily) {
    const parts = [];
    for (let i = 0; i < 2; i++) {
      const y = i * DAILY.half;
      parts.push(`<g transform="translate(0 ${n(y)})">\n${dailyHead(subject)}\n<g transform="translate(0 ${DAILY.stripTop})">\n${svg}\n</g>\n</g>`);
      if (i) parts.push(`<line x1="0" y1="${n(y)}" x2="${PAGE.w}" y2="${n(y)}" stroke="#000" stroke-width="0.25" stroke-dasharray="1 1.2"/>`);
    }
    const page = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.w}mm" height="${PAGE.h}mm" viewBox="0 0 ${PAGE.w} ${PAGE.h}" font-family="'Times New Roman', Times, serif">\n${parts.join('\n')}\n</svg>`;
    return { page, layout, K: { ...K, perPage: 2, top: DAILY.stripTop, pitch: DAILY.half } };
  }
  const parts = [];
  const cut = (y) => parts.push(`<line x1="0" y1="${n(y)}" x2="${PAGE.w}" y2="${n(y)}" stroke="#000" stroke-width="0.25" stroke-dasharray="1 1.2"/>`);
  const pitch = K.pitch ?? K.h, pad = (pitch - K.h) / 2;
  for (let i = 0; i < K.perPage; i++) {
    const y = K.top + i * pitch;
    parts.push(`<g transform="translate(0 ${n(y + pad)})">\n${svg}\n</g>`);
    if (i || K.top) cut(y);
  }
  if (K.top) cut(K.top + K.perPage * pitch);
  const page = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.w}mm" height="${PAGE.h}mm" viewBox="0 0 ${PAGE.w} ${PAGE.h}" font-family="'Times New Roman', Times, serif">\n${parts.join('\n')}\n</svg>`;
  return { page, layout, K };
}

const all = {};
for (const s of SUBJECTS) {
  const { page, layout, K } = buildPage(s);
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(s.file)}</title>
<style>@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}svg{display:block}</style></head><body>${page}</body></html>`;
  fs.writeFileSync(path.join(OUT, `${s.id}.html`), html);
  fs.writeFileSync(
    path.join(OUT, `${s.id}.layout.json`),
    JSON.stringify({ id: s.id, code: s.code, title: s.title, kind: s.kind, strip: { w: PAGE.w, h: K.h }, perPage: K.perPage, pageTop: K.top, pagePitch: n(K.pitch ?? K.h), ...layout }, null, 1),
  );
  if (s.like) continue;
  all[s.id] = { id: s.id, code: s.code, kind: s.kind, strip: { w: PAGE.w, h: K.h }, markers: layout.markers, codeCells: layout.code, variant: layout.variant, tests: layout.tests, matching: layout.matching, open: layout.open };
  console.log(s.id, 'tests', layout.tests.length, 'matching', layout.matching.length, 'open', layout.open.length);
}

const ts = [
  '// АВТОГЕНЕРАЦИЯ: node scripts/omr-blanks.mjs. Не редактируйте вручную.',
  '// Координаты в миллиметрах от левого верхнего угла полоски бланка.',
  "import type { OmrLayout } from './types';",
  '',
  'export const OMR_LAYOUTS: Record<string, OmrLayout> = ' + JSON.stringify(all) + ';',
  '',
].join(String.fromCharCode(10));
fs.mkdirSync(path.join(ROOT, 'src', 'lib', 'omr'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src', 'lib', 'omr', 'layouts.generated.ts'), ts);
console.log('layouts.generated.ts', ts.length, 'bytes');
