// Шаблоны ключей (templates/key/*.docx) -> модуль Edge Functions (base64) и файлы для сайта (public/key-templates).
// Запуск: node scripts/build-key-templates.mjs
import fs from 'fs';
import JSZip from 'jszip';

/** Word и скрипты иногда сохраняют docx без сжатия (в 20 раз больше): такой файл сжимается, содержимое не меняется */
async function compress(buf) {
  const zip = await JSZip.loadAsync(buf);
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return out.length < buf.length / 2 ? out : buf;
}

const kinds = ['chem', 'phys', 'bio', 'taj', 'taj-cluster', 'law', 'hist', 'math'];
fs.mkdirSync('public/key-templates', { recursive: true });
let out = '// АВТОГЕНЕРАЦИЯ: scripts/build-key-templates.mjs. Шаблоны лежат в templates/key/*.docx.\nexport const KEY_TEMPLATES: Record<string, string> = {\n';
for (const k of kinds) {
  const src = fs.readFileSync(`templates/key/${k}.docx`);
  const buf = await compress(src);
  if (buf !== src) fs.writeFileSync(`templates/key/${k}.docx`, buf); // исходник, копия сайта и копия бота совпадают (tests/answerKey.test.ts)
  fs.writeFileSync(`public/key-templates/${k}.docx`, buf);
  out += `  '${k}': '${buf.toString('base64')}',\n`;
}
out += '};\n';
fs.writeFileSync('supabase/functions/_shared/keyTemplates.ts', out);
console.log('ok', out.length);
