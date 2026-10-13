// Шаблоны ключей (templates/key/*.docx) -> модуль Edge Functions (base64) и файлы для сайта (public/key-templates).
// Запуск: node scripts/build-key-templates.mjs
import fs from 'fs';

const kinds = ['chem', 'phys', 'bio', 'taj'];
fs.mkdirSync('public/key-templates', { recursive: true });
let out = '// АВТОГЕНЕРАЦИЯ: scripts/build-key-templates.mjs. Шаблоны лежат в templates/key/*.docx.\nexport const KEY_TEMPLATES: Record<string, string> = {\n';
for (const k of kinds) {
  const buf = fs.readFileSync(`templates/key/${k}.docx`);
  fs.copyFileSync(`templates/key/${k}.docx`, `public/key-templates/${k}.docx`);
  out += `  ${k}: '${buf.toString('base64')}',\n`;
}
out += '};\n';
fs.writeFileSync('supabase/functions/_shared/keyTemplates.ts', out);
console.log('ok', out.length);
