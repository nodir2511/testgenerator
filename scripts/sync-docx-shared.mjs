// Копирует генератор Word из src/lib/docxExport.ts в общий модуль Edge Functions
// (Deno), заменяя браузерные импорты. Запуск: node scripts/sync-docx-shared.mjs
import fs from 'fs';

const src = fs.readFileSync('src/lib/docxExport.ts', 'utf-8');
const marker = '// Экспорт одного конкретного билета';
const cut = src.indexOf(marker);
if (cut < 0) throw new Error('marker not found in docxExport.ts');

let body = src.slice(0, cut);
body = body
  .replace("from 'docx';", "from 'npm:docx@9';")
  .replace(/import \{ saveAs \} from 'file-saver';\r?\n/, '')
  .replace(/import JSZip from 'jszip';\r?\n/, '')
  .replace("from './fractions';", "from './fractions.ts';");
if (/saveAs|JSZip/.test(body)) throw new Error('browser-only code left in shared docx module');

const out = '// @ts-nocheck\n// АВТОГЕНЕРАЦИЯ: scripts/sync-docx-shared.mjs. Не редактируйте вручную — правьте src/lib/docxExport.ts.\n' + body.trimEnd() + '\n';
fs.mkdirSync('supabase/functions/_shared', { recursive: true });
fs.writeFileSync('supabase/functions/_shared/docxExport.ts', out);
const fractions = '// АВТОГЕНЕРАЦИЯ: scripts/sync-docx-shared.mjs. Не редактируйте вручную — правьте src/lib/fractions.ts.\n' + fs.readFileSync('src/lib/fractions.ts', 'utf-8');
fs.writeFileSync('supabase/functions/_shared/fractions.ts', fractions);
console.log('synced', out.length, '+', fractions.length, 'bytes');
