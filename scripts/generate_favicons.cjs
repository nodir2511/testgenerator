const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const svg = fs.readFileSync('public/favicon.svg', 'utf8');

function renderIcon(size, outFile) {
  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
  svg { width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
${svg}
</body>
</html>`;
  const tmpHtml = path.resolve(`temp_${size}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf8');

  const edge = '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"';
  const fileUrl = 'file:///' + tmpHtml.replace(/\\/g, '/');
  const outPath = path.resolve(outFile);

  execSync(
    `${edge} --headless --disable-gpu --screenshot="${outPath}" --window-size=${size},${size} --default-background-color=00000000 "${fileUrl}"`
  );
  if (fs.existsSync(tmpHtml)) fs.unlinkSync(tmpHtml);
  console.log(`Generated ${outFile} (${size}x${size}):`, fs.statSync(outPath).size, 'bytes');
}

function createIco(pngFiles, outFile) {
  const images = pngFiles.map(({ file, size }) => ({
    size,
    buffer: fs.readFileSync(file)
  }));

  const headerSize = 6;
  const entrySize = 16;
  const numImages = images.length;
  let offset = headerSize + entrySize * numImages;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(numImages, 4); // count

  const entries = [];
  for (const img of images) {
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(img.buffer.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset
    entries.push(entry);
    offset += img.buffer.length;
  }

  const icoBuffer = Buffer.concat([
    header,
    ...entries,
    ...images.map(img => img.buffer)
  ]);

  fs.writeFileSync(outFile, icoBuffer);
  console.log('Created ICO:', outFile, icoBuffer.length, 'bytes');
}

// Generate PNG sizes
renderIcon(16, 'public/favicon-16x16.png');
renderIcon(32, 'public/favicon-32x32.png');
renderIcon(48, 'public/favicon-48x48.png');
renderIcon(180, 'public/apple-touch-icon.png');
renderIcon(192, 'public/android-chrome-192x192.png');
renderIcon(512, 'public/android-chrome-512x512.png');

createIco([
  { file: 'public/favicon-16x16.png', size: 16 },
  { file: 'public/favicon-32x32.png', size: 32 },
  { file: 'public/favicon-48x48.png', size: 48 }
], 'public/favicon.ico');
