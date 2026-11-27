// Нарисованные эталоны цифр 14×14 для обучения сети (scripts/train-digit-nn.py берёт их как добавку к реальным
// цифрам с бланков: реальных девяток и нулей мало). Печатает JSON [{ d, x: [196 значений 0…255] }].
// node scripts/digit-synth.mjs <начальное число> <примеров на цифру>
const GLYPHS = {
  0: [[0.5, 0], [0.1, 0.2], [0, 0.5], [0.1, 0.8], [0.5, 1], [0.9, 0.8], [1, 0.5], [0.9, 0.2], [0.5, 0]],
  1: [[0.3, 0.25], [0.55, 0], [0.55, 1]],
  '1_stick': [[0.5, 0], [0.5, 1]],
  2: [[0, 0.2], [0.2, 0], [0.8, 0], [1, 0.25], [0, 1], [1, 1]],
  3: [[0, 0], [1, 0], [0.4, 0.45], [1, 0.65], [0.8, 1], [0.1, 1]],
  4: [[0.7, 1], [0.7, 0], [0, 0.7], [1, 0.7]],
  5: [[1, 0], [0.1, 0], [0, 0.45], [0.7, 0.4], [1, 0.7], [0.8, 1], [0, 1]],
  6: [[0.9, 0], [0.2, 0.3], [0, 0.7], [0.3, 1], [0.9, 0.9], [0.9, 0.55], [0.2, 0.55]],
  7: [[0, 0], [1, 0], [0.4, 1]],
  '7_bar': [[0, 0], [1, 0], [0.4, 1]],
  8: [[0.5, 0.5], [0.1, 0.25], [0.5, 0], [0.9, 0.25], [0.5, 0.5], [0.05, 0.75], [0.5, 1], [0.95, 0.75], [0.5, 0.5]],
  9: [[1, 0.45], [0.2, 0.5], [0.1, 0.1], [0.7, 0], [1, 0.2], [1, 0.6], [0.5, 1]],
};

const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function drawSample(digit, rnd, cols = 28, rows = 34) {
  const step = 0.15, W = cols * step, Hh = rows * step;
  let glyphKey = String(digit);
  if (digit === 1 && rnd() < 0.4) glyphKey = '1_stick';
  if (digit === 7 && rnd() < 0.5) glyphKey = '7_bar';

  const gw = 3 + rnd() * 1.0, gh = 4 + rnd() * 0.8;
  const ox = (W - gw) / 2 + (rnd() - 0.5) * 0.6, oy = (Hh - gh) / 2 + (rnd() - 0.5) * 0.6;
  const slant = (rnd() - 0.5) * 0.35;
  const pts = GLYPHS[glyphKey].map(([x, y]) => [
    ox + (x + slant * (0.5 - y)) * gw + (rnd() - 0.5) * 0.2,
    oy + y * gh + (rnd() - 0.5) * 0.2,
  ]);
  const wmm = 0.38 + rnd() * 0.26;
  const bitmap = new Uint8Array(cols * rows);

  const drawSegment = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * step, y = r * step;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= wmm / 2) bitmap[r * cols + c] = 1;
    }
  };

  for (let i = 0; i + 1 < pts.length; i++) drawSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  if (glyphKey === '7_bar') {
    // Горизонтальная перекладинка на семерке
    const my = oy + gh * 0.48;
    drawSegment(ox + gw * 0.25, my, ox + gw * 0.85, my);
  }

  // Обрезка и центрирование в 28x28 (MNIST format)
  let x0 = cols, x1 = -1, y0 = rows, y1 = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (bitmap[r * cols + c]) {
    if (c < x0) x0 = c;
    if (c > x1) x1 = c;
    if (r < y0) y0 = r;
    if (r > y1) y1 = r;
  }
  const out14 = new Float32Array(14 * 14);
  if (x1 < 0) return out14;

  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = 20 / Math.max(bw, bh);
  const tw = bw * s, th = bh * s;
  const tmp = new Float32Array(28 * 28);
  let sx = 0, sy = 0, m = 0;
  const k = Math.max(1, Math.round(1 / s));
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
    const px = x0 + (x - (28 - tw) / 2) / s, py = y0 + (y - (28 - th) / 2) / s;
    const ix = Math.floor(px), iy = Math.floor(py);
    let v = 0;
    if (ix >= x0 && ix <= x1 && iy >= y0 && iy <= y1) {
      let sum = 0, cnt = 0;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
        sum += bitmap[Math.min(y1, iy + dy) * cols + Math.min(x1, ix + dx)];
        cnt++;
      }
      v = sum / cnt;
    }
    tmp[y * 28 + x] = v;
    sx += x * v; sy += y * v; m += v;
  }
  if (m === 0) return out14;

  const shx = Math.round(13.5 - sx / m), shy = Math.round(13.5 - sy / m);
  const v28 = new Float32Array(28 * 28);
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
    const xx = x - shx, yy = y - shy;
    if (xx >= 0 && xx < 28 && yy >= 0 && yy < 28) v28[y * 28 + x] = tmp[yy * 28 + xx];
  }

  // 28x28 -> 14x14
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
    const avg = (v28[2 * y * 28 + 2 * x] + v28[2 * y * 28 + 2 * x + 1] + v28[(2 * y + 1) * 28 + 2 * x] + v28[(2 * y + 1) * 28 + 2 * x + 1]) / 4;
    out14[y * 14 + x] = avg;
  }
  return out14;
}


const rnd = mulberry(Number(process.argv[2] ?? 42));
const perDigit = Number(process.argv[3] ?? 300);
const out = [];
for (let d = 0; d < 10; d++) for (let i = 0; i < perDigit; i++) out.push({ d, x: Array.from(drawSample(d, rnd), (v) => Math.round(v * 255)) });
process.stdout.write(JSON.stringify(out));
