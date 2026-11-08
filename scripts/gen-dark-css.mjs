// Строит src/dark.css — переопределения цветов для тёмной темы (класс .dark на <html>).
// Запуск: npm run theme:dark. Перезапускайте после того, как в коде появились новые цветовые классы Tailwind.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
const SKIP_DIRS = new Set(['game', 'tg']); // у игры и Mini App своя тема
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(f)) walk(p); }
    else if (/\.tsx?$/.test(f)) files.push(p);
  }
})(SRC);

const RGB = { indigo: '99 102 241', emerald: '16 185 129', amber: '245 158 11', red: '239 68 68', purple: '168 85 247', blue: '59 130 246', rose: '244 63 94', green: '34 197 94', sky: '14 165 233', violet: '139 92 246', yellow: '234 179 8', orange: '249 115 22', teal: '20 184 166', pink: '236 72 153' };
const L300 = { indigo: '#a5b4fc', emerald: '#6ee7b7', amber: '#fcd34d', red: '#fca5a5', purple: '#d8b4fe', blue: '#93c5fd', rose: '#fda4af', green: '#86efac', sky: '#7dd3fc', violet: '#c4b5fd', yellow: '#fde047', orange: '#fdba74', teal: '#5eead4', pink: '#f9a8d4' };
const SURFACE = '#0f172a', PAGE = '#0b1324';
const slateBg = { 50: PAGE, 100: '#1e293b', 200: '#334155', 300: '#475569' };
const slateText = { 900: '#f1f5f9', 800: '#e2e8f0', 700: '#cbd5e1', 600: '#aab7c9', 500: '#94a3b8', 400: '#64748b', 300: '#475569' };
const slateBorder = { 50: '#1e293b', 100: '#1e293b', 200: '#334155', 300: '#475569', 400: '#64748b' };

const rgba = (c, a) => `rgb(${RGB[c]} / ${a})`;
const alphaOf = (a) => (a == null ? null : Number(a) / 100);
const withAlpha = (hex, a) => {
  if (a == null) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`;
};

// Возвращает значение цвета для тёмной темы или null — класс не меняем
function mapColor(kind, color, shade, alpha) {
  const a = alphaOf(alpha);
  if (kind === 'bg' || kind === 'from' || kind === 'via' || kind === 'to') {
    if (color === 'white') return withAlpha(SURFACE, a);
    if (color === 'slate' && slateBg[shade]) return withAlpha(slateBg[shade], a);
    if (RGB[color] && (shade === 50 || shade === 100 || shade === 200)) {
      const base = { 50: 0.12, 100: 0.2, 200: 0.3 }[shade];
      return rgba(color, a == null ? base : +(base * a).toFixed(3));
    }
    return null;
  }
  if (kind === 'text') {
    if (color === 'slate' && slateText[shade]) return slateText[shade];
    if (RGB[color] && shade >= 500) return L300[color];
    return null;
  }
  if (kind === 'border' || kind === 'divide' || kind === 'ring') {
    if (color === 'white') return 'rgb(255 255 255 / 0.12)';
    if (color === 'slate' && slateBorder[shade]) return withAlpha(slateBorder[shade], a);
    if (RGB[color] && shade >= 100 && shade <= 300) return rgba(color, 0.35);
    return null;
  }
  return null;
}

const TOKEN = /(?<![\w\-\[:\/.])((?:[a-z\-]+:)*)(bg|text|border|divide|ring|from|via|to)-(white|slate|indigo|emerald|amber|red|purple|blue|rose|green|sky|violet|yellow|orange|teal|pink)(?:-(\d{2,3}))?(?:\/(\d{1,3}))?(?![\w\-\[])/g;
const used = new Map();
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(TOKEN)) used.set(m[0], m);
}

const esc = (c) => c.replace(/[:\/.\[\]%()]/g, (x) => '\\' + x);
const STATE = { placeholder: '::placeholder', hover: ':hover', focus: ':focus', 'focus-visible': ':focus-visible', active: ':active', disabled: ':disabled' };
const MEDIA = { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' };
const rules = [], skipped = [], unmapped = new Set();

for (const [cls, m] of [...used.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const [, prefixStr, kind, color, shadeStr, alpha] = m;
  const prefixes = prefixStr.split(':').filter(Boolean);
  const shade = shadeStr ? Number(shadeStr) : null;
  const value = mapColor(kind, color, shade, alpha);
  if (value == null) { unmapped.add(cls); continue; }

  let pseudo = '', group = '', media = null, ok = true;
  for (const p of prefixes) {
    if (STATE[p]) pseudo += STATE[p];
    else if (p === 'group-hover') group = '.group:hover ';
    else if (MEDIA[p]) media = MEDIA[p];
    else ok = false;
  }
  if (!ok) { skipped.push(cls); continue; }

  const sel = `.dark ${group}.${esc(cls)}${pseudo}`;
  let decl;
  if (kind === 'bg') decl = `background-color:${value}`;
  else if (kind === 'text') decl = `color:${value}`;
  else if (kind === 'border') decl = `border-color:${value}`;
  else if (kind === 'ring') decl = `--tw-ring-color:${value}`;
  else if (kind === 'divide') {
    rules.push(wrap(media, `.dark .${esc(cls)}>:not([hidden])~:not([hidden]){border-color:${value}}`));
    continue;
  } else {
    const stop = kind === 'from'
      ? `--tw-gradient-from:${value} var(--tw-gradient-from-position);--tw-gradient-to:transparent var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to)`
      : kind === 'via'
        ? `--tw-gradient-stops:var(--tw-gradient-from),${value} var(--tw-gradient-via-position),var(--tw-gradient-to)`
        : `--tw-gradient-to:${value} var(--tw-gradient-to-position)`;
    decl = stop;
  }
  rules.push(wrap(media, `${sel}{${decl}}`));
}
function wrap(media, rule) { return media ? `@media (min-width:${media}){${rule}}` : rule; }


// Вручную заданная часть: токены (переменные), пользовательские классы и исключения
const EXTRA = `
.dark { color-scheme: dark;
  --background: 222 47% 7%; --foreground: 210 40% 96%;
  --card: 222 47% 11%; --card-foreground: 210 40% 96%;
  --muted: 217 33% 17%; --muted-foreground: 215 20% 70%;
  --secondary: 217 33% 17%; --accent: 217 33% 17%;
  --border: 217 33% 22%; --input: 215 25% 32%;
  --primary-soft: 243 45% 20%;
  --success-soft: 160 45% 14%; --success-line: 160 40% 30%;
  --warning-soft: 35 55% 14%; --warning-line: 35 55% 30%;
  --destructive-soft: 0 50% 16%; --destructive-line: 0 45% 32%;
  --info-soft: 220 50% 18%; --info-line: 220 45% 34%; }
.dark body { background-color: ${PAGE}; color: #e2e8f0; }
.dark .bento-card { background: rgb(15 23 42 / 0.95); border-color: #334155; box-shadow: 0 1px 3px rgb(0 0 0 / 0.4); }
.dark .bento-card-interactive:hover { border-color: rgb(129 140 248 / 0.45); box-shadow: 0 8px 24px -4px rgb(0 0 0 / 0.5); }
.dark .text-primary-ink, .dark .text-primary { color: #a5b4fc; }
.dark .text-success { color: #6ee7b7; }
.dark .text-warning { color: #fcd34d; }
.dark .text-info { color: #93c5fd; }
.dark .text-destructive, .dark .text-destructive-hover { color: #fca5a5; }
.dark img.bg-white, .dark img[class*="bg-white"] { background-color: #fff; }
:where(.dark) :where(input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]), textarea, select) { background-color: ${PAGE}; border-color: #334155; color: #e2e8f0; }
.dark ::placeholder { color: #64748b; opacity: 1; }
.dark ::selection { background: rgb(99 102 241 / 0.4); }
`;

const header = `/* АВТОМАТИЧЕСКИ СОЗДАНО scripts/gen-dark-css.mjs — не правьте вручную (npm run theme:dark).
   Тёмная тема включается классом .dark на <html>; светлая остаётся как есть. */\n`;
const out = header + rules.join('\n') + '\n' + EXTRA;
writeFileSync('src/dark.css', out);
console.log(`правил: ${rules.length}, классов без замены: ${unmapped.size}, пропущено (неизвестные префиксы): ${skipped.length}`);
if (process.argv.includes('--report')) {
  console.log('\nБез замены (остаются как в светлой теме — должны быть насыщенные заливки и т.п.):');
  console.log([...unmapped].sort().join('  '));
  if (skipped.length) console.log('\nПропущено:', skipped.join('  '));
}
