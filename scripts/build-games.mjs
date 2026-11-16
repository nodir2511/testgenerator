// Собирает скрипты игр: games-src/<игра>/app.js → public/games/<игра>/app.js (минифицированный).
// Запуск: npm run games:build. Править нужно исходник в games-src, а не файл в public.
import { build } from 'esbuild';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'games-src');
for (const game of readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const entry = path.join(src, game.name, 'app.js');
  if (!existsSync(entry)) continue;
  // Обычный скрипт, не модуль: class.js обращается к его верхним именам (home, cur, render…), поэтому имена не сжимаем
  await build({
    entryPoints: [entry],
    outfile: path.join(root, 'public', 'games', game.name, 'app.js'),
    minify: true,
    charset: 'utf8',
    target: 'es2017',
    legalComments: 'none',
    allowOverwrite: true,
  });
  console.log(`игра ${game.name}: собрана`);
}
