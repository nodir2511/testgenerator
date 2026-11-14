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
const VARIANTS = 10;

// Виды бланков: высота, сколько на листе, отступ сверху, вертикали шапки и меток
const KINDS = {
  // 18 тестов, 2 соответствия, 7 открытых
  k18: { h: 99, perPage: 3, top: 0, total: 27, markY: [6, 88], headY: 15.5, ruleY: 17.2, titleY: 24.2, varNumY: 21.2, varY: 24.6, varX: 147.5, varStep: 5.4, varD: 4.2, codeY: 88.5, footY: 91 },
  // 20 тестов, 4 соответствия, 2 открытых
  k20: { h: 99, perPage: 3, top: 0, total: 26, markY: [6, 88], headY: 15.5, ruleY: 17.2, titleY: 24.2, varNumY: 21.2, varY: 24.6, varX: 147.5, varStep: 5.4, varD: 4.2, codeY: 88.5, footY: 91 },
  // 8 тестов, 2 соответствия, 2 открытых — расположение как в прежнем бланке, шесть на листе
  k12: { h: 47.5, perPage: 6, top: 6, total: 12, markY: [1.5, 42], headY: 8.3, ruleY: 9.8, titleY: 14, varNumY: 13, varY: 16.1, varX: 151.5, varStep: 5, varD: 4, codeY: 43.2, footY: 45.7 },
};

const SUBJECTS = [
  { id: 'chem', code: 1, title: 'ХИМИЯ', kind: 'k18', file: 'Бланк химия 27' },
  { id: 'bio', code: 2, title: 'БИОЛОГИЯ', kind: 'k20', file: 'Бланк биология 26' },
  { id: 'phys', code: 3, title: 'ФИЗИКА', kind: 'k18', file: 'Бланк физика 27' },
  { id: 'taj', code: 4, title: 'ЗАБОНИ ТОҶИКӢ (ТАДЖИКСКИЙ ЯЗЫК)', kind: 'k20', file: 'Бланк таджикский язык 26' },
  { id: 'chemphys', code: 5, title: 'ХИМИЯ/ФИЗИКА', kind: 'k12', file: 'Бланк химия-физика 12' },
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

  // Шапка, как в прежнем бланке
  text(14, K.headY, 'Ному насаб (ФИО)');
  text(86, K.headY, 'Филиал');
  text(114, K.headY, 'Гурӯҳи (Группа)');
  text(152, K.headY, 'Вариант(и)');
  svg.push(`<line x1="14" y1="${K.ruleY}" x2="198" y2="${K.ruleY}" stroke="#000" stroke-width="0.3"/>`);
  text(78, K.titleY, subject.title, { bold: true, anchor: 'middle' });
  for (let i = 0; i < VARIANTS; i++) {
    const x = K.varX + i * K.varStep;
    text(x, K.varNumY, String(i + 1), { size: 2.6, bold: true, anchor: 'middle' });
    circle(x, K.varY, K.varD);
    layout.variant.push({ value: i + 1, x, y: K.varY, d: K.varD });
  }

  // Тест: номер и четыре кружка A–D
  const testCol = (x0, first, rows, y0 = 36, step = 6.2) => {
    LETTERS.forEach((l, k) => text(x0 + 10 + k * 5.6, y0 - 3.6, l, { size: 2.9, bold: true, anchor: 'middle' }));
    for (let r = 0; r < rows; r++) {
      const y = y0 + r * step, q = first + r;
      text(x0 + 6.5, y + 1.25, String(q), { bold: true, anchor: 'end' });
      const options = LETTERS.map((l, k) => {
        const x = x0 + 10 + k * 5.6;
        circle(x, y, 4.4);
        return { value: l, x, y, d: 4.4 };
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
  // Открытый вопрос: номер и четыре клетки для цифр
  const open = (x0, yc, q) => {
    text(x0 + 6, yc + 1.25, String(q), { bold: true, anchor: 'end' });
    const boxes = [];
    for (let i = 0; i < 4; i++) {
      const x = x0 + 7.5 + i * 6;
      rect(x, yc - 3.5, 6, 7);
      boxes.push({ x, y: yc - 3.5, w: 6, h: 7 });
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
    open(166, 68, 25);
    open(166, 80, 26);
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

function buildPage(subject) {
  const { svg, layout, K } = buildStrip(subject);
  const parts = [];
  const cut = (y) => parts.push(`<line x1="0" y1="${n(y)}" x2="${PAGE.w}" y2="${n(y)}" stroke="#000" stroke-width="0.25" stroke-dasharray="1 1.2"/>`);
  for (let i = 0; i < K.perPage; i++) {
    const y = K.top + i * K.h;
    parts.push(`<g transform="translate(0 ${n(y)})">\n${svg}\n</g>`);
    if (i || K.top) cut(y);
  }
  if (K.top) cut(K.top + K.perPage * K.h);
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
    JSON.stringify({ id: s.id, code: s.code, title: s.title, kind: s.kind, strip: { w: PAGE.w, h: K.h }, perPage: K.perPage, pageTop: K.top, ...layout }, null, 1),
  );
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
