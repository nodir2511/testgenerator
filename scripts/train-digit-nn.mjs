// Обучение компактной нейросети (196 -> 48 -> 10) для рукописных цифр и генерация digitWeights.generated.ts
// Данные: нарисованные эталоны (GLYPHS) + реальные цифры с бланков (scripts/real-digits.json, картинки 14×14 с меткой
// и пачкой). Каждая реальная цифра повторяется REAL_REP раз со сдвигом на пиксель и утолщением штриха.
// Запуск: node scripts/train-digit-nn.mjs — обучение на всём, запись весов.
//         node scripts/train-digit-nn.mjs --holdout batch-3 — честная проверка: пачка batch-3 в обучение не идёт,
//         точность считается на ней, веса не записываются.
//         --seed N — начальное число (по умолчанию 42); наборы данных сравнивают по сумме нескольких чисел.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

console.log('Генерация тренировочной выборки...');
const N_PER_DIGIT = 300;
// Начальное число: одна и та же выборка при разных числах даёт на отложенной пачке разброс в несколько процентов,
// поэтому сравнивать наборы данных надо по нескольким числам (--seed 1, 2, 3), а не по одному запуску.
const seedIdx = process.argv.indexOf('--seed');
const rnd = mulberry(seedIdx > 0 ? Number(process.argv[seedIdx + 1]) : 42);
const samples = [];
for (let d = 0; d < 10; d++) {
  for (let i = 0; i < N_PER_DIGIT; i++) {
    samples.push({ label: d, x: drawSample(d, rnd) });
  }
}

// Перемешиваем
for (let i = samples.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [samples[i], samples[j]] = [samples[j], samples[i]];
}

// Реальные цифры с бланков
const REAL_REP = 20;
const holdIdx = process.argv.indexOf('--holdout');
const HOLDOUT = holdIdx > 0 ? process.argv[holdIdx + 1] : null;
const REAL = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'real-digits.json'), 'utf8'));
const toF = (b64) => { const u = Buffer.from(b64, 'base64'); const f = new Float32Array(196); for (let i = 0; i < 196; i++) f[i] = u[i] / 255; return f; };
const shift = (f, dx, dy) => {
  const o = new Float32Array(196);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
    const xx = x - dx, yy = y - dy;
    if (xx >= 0 && yy >= 0 && xx < 14 && yy < 14) o[y * 14 + x] = f[yy * 14 + xx];
  }
  return o;
};
const thick = (f) => {
  const o = new Float32Array(196);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
    let m = f[y * 14 + x];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < 14 && yy < 14) m = Math.max(m, f[yy * 14 + xx] * 0.6);
    }
    o[y * 14 + x] = m;
  }
  return o;
};
const realTrain = REAL.filter((r) => r.batch !== HOLDOUT);
const realTest = REAL.filter((r) => r.batch === HOLDOUT).map((r) => ({ label: r.d, x: toF(r.px) }));
for (const r of realTrain) {
  const f = toF(r.px);
  for (let k = 0; k < REAL_REP; k++) {
    let g = shift(f, Math.floor(rnd() * 3) - 1, Math.floor(rnd() * 3) - 1);
    if (rnd() < 0.5) g = thick(g);
    samples.push({ label: r.d, x: g });
  }
}
for (let i = samples.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [samples[i], samples[j]] = [samples[j], samples[i]];
}
console.log(`Реальных цифр в обучении: ${realTrain.length} (×${REAL_REP})${HOLDOUT ? `, отложено для проверки (${HOLDOUT}): ${realTest.length}` : ''}`);

// Валидация: с --holdout — отложенная пачка реальных цифр, иначе 15 % выборки
const nTrain = HOLDOUT ? samples.length : Math.floor(samples.length * 0.85);
const train = samples.slice(0, nTrain);
const test = HOLDOUT ? realTest : samples.slice(nTrain);

console.log(`Обучающая выборка: ${train.length}, валидация: ${test.length}`);

// Сеть: 196 -> 48 -> 10
const IN = 196, HID = 48, OUT = 10;
const W1 = new Float32Array(IN * HID);
const b1 = new Float32Array(HID);
const W2 = new Float32Array(HID * OUT);
const b2 = new Float32Array(OUT);

// He initialization
const initScale1 = Math.sqrt(2 / IN);
for (let i = 0; i < W1.length; i++) W1[i] = (rnd() * 2 - 1) * initScale1;
const initScale2 = Math.sqrt(2 / HID);
for (let i = 0; i < W2.length; i++) W2[i] = (rnd() * 2 - 1) * initScale2;

// Adam optimizer state
const mW1 = new Float32Array(W1.length), vW1 = new Float32Array(W1.length);
const mb1 = new Float32Array(b1.length), vb1 = new Float32Array(b1.length);
const mW2 = new Float32Array(W2.length), vW2 = new Float32Array(W2.length);
const mb2 = new Float32Array(b2.length), vb2 = new Float32Array(b2.length);

const lr = 0.003, beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
const EPOCHS = 35, BATCH = 32;

console.log('Обучение нейросети...');
let step = 0;

for (let epoch = 1; epoch <= EPOCHS; epoch++) {
  let lossSum = 0;
  for (let b = 0; b < train.length; b += BATCH) {
    const batch = train.slice(b, b + BATCH);
    const gW1 = new Float32Array(W1.length);
    const gb1 = new Float32Array(b1.length);
    const gW2 = new Float32Array(W2.length);
    const gb2 = new Float32Array(b2.length);

    for (const item of batch) {
      const x = item.x, target = item.label;
      // Forward 1: linear + ReLU
      const h = new Float32Array(HID);
      for (let j = 0; j < HID; j++) {
        let sum = b1[j];
        for (let i = 0; i < IN; i++) sum += x[i] * W1[i * HID + j];
        h[j] = sum > 0 ? sum : 0;
      }
      // Forward 2: linear + Softmax
      const z = new Float32Array(OUT);
      let maxZ = -Infinity;
      for (let k = 0; k < OUT; k++) {
        let sum = b2[k];
        for (let j = 0; j < HID; j++) sum += h[j] * W2[j * OUT + k];
        z[k] = sum;
        if (sum > maxZ) maxZ = sum;
      }
      let sumExp = 0;
      const probs = new Float32Array(OUT);
      for (let k = 0; k < OUT; k++) {
        probs[k] = Math.exp(z[k] - maxZ);
        sumExp += probs[k];
      }
      for (let k = 0; k < OUT; k++) probs[k] /= sumExp;

      lossSum -= Math.log(Math.max(1e-12, probs[target]));

      // Backward
      const dZ = new Float32Array(OUT);
      for (let k = 0; k < OUT; k++) dZ[k] = probs[k] - (k === target ? 1 : 0);

      const dH = new Float32Array(HID);
      for (let k = 0; k < OUT; k++) {
        gb2[k] += dZ[k] / batch.length;
        for (let j = 0; j < HID; j++) {
          gW2[j * OUT + k] += (dZ[k] * h[j]) / batch.length;
          dH[j] += dZ[k] * W2[j * OUT + k];
        }
      }

      for (let j = 0; j < HID; j++) {
        if (h[j] <= 0) continue;
        gb1[j] += dH[j] / batch.length;
        for (let i = 0; i < IN; i++) {
          gW1[i * HID + j] += (dH[j] * x[i]) / batch.length;
        }
      }
    }

    step++;
    const update = (w, gw, mw, vw) => {
      for (let i = 0; i < w.length; i++) {
        mw[i] = beta1 * mw[i] + (1 - beta1) * gw[i];
        vw[i] = beta2 * vw[i] + (1 - beta2) * (gw[i] * gw[i]);
        const mHat = mw[i] / (1 - Math.pow(beta1, step));
        const vHat = vw[i] / (1 - Math.pow(beta2, step));
        w[i] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
      }
    };
    update(W1, gW1, mW1, vW1);
    update(b1, gb1, mb1, vb1);
    update(W2, gW2, mW2, vW2);
    update(b2, gb2, mb2, vb2);
  }

  // Оценка на валидации
  if (epoch % 5 === 0 || epoch === EPOCHS) {
    let correct = 0;
    for (const item of test) {
      const x = item.x;
      const h = new Float32Array(HID);
      for (let j = 0; j < HID; j++) {
        let sum = b1[j];
        for (let i = 0; i < IN; i++) sum += x[i] * W1[i * HID + j];
        h[j] = sum > 0 ? sum : 0;
      }
      let bestDigit = 0, bestVal = -Infinity;
      for (let k = 0; k < OUT; k++) {
        let sum = b2[k];
        for (let j = 0; j < HID; j++) sum += h[j] * W2[j * OUT + k];
        if (sum > bestVal) { bestVal = sum; bestDigit = k; }
      }
      if (bestDigit === item.label) correct++;
    }
    const acc = ((correct / test.length) * 100).toFixed(1);
    console.log(`Эпоха ${epoch}/${EPOCHS}: Loss = ${(lossSum / train.length).toFixed(4)}, Точность = ${acc}%`);
  }
}

// Экспорт весов в компактный base64 / Float32Array
const buf = new ArrayBuffer((W1.length + b1.length + W2.length + b2.length) * 4);
const f32 = new Float32Array(buf);
let offset = 0;
f32.set(W1, offset); offset += W1.length;
f32.set(b1, offset); offset += b1.length;
f32.set(W2, offset); offset += W2.length;
f32.set(b2, offset); offset += b2.length;

const base64Weights = Buffer.from(buf).toString('base64');
console.log(`Размер весов: ${base64Weights.length} символов base64 (~${(base64Weights.length / 1024).toFixed(1)} КБ)`);

const code = `// Автоматически сгенерированные веса микро-нейросети (196 -> 48 -> 10)
// Запуск сборщика: node scripts/train-digit-nn.mjs

export const DIGIT_NN_CONFIG = { in: ${IN}, hid: ${HID}, out: ${OUT} } as const;
export const DIGIT_NN_WEIGHTS_BASE64 = "${base64Weights}";
`;

if (HOLDOUT) {
  console.log('Режим проверки (--holdout): веса не записаны.');
} else {
  const targetPath = path.resolve(__dirname, '../src/lib/omr/digitWeights.generated.ts');
  fs.writeFileSync(targetPath, code, 'utf-8');
  console.log(`Сохранено в ${targetPath}`);
}
