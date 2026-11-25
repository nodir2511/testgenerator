// Распознавание бланка по снимку одной полоски. Без зависимостей: работает над серым изображением.
// Порядок: строгая бинаризация (при неудаче мягче) → четыре угловые метки → выравнивание (гомография) →
// код бланка (он же определяет поворот снимка) → вариант, тесты, соответствия, клетки открытых.
// Распознавание самих цифр здесь нет: для открытых вопросов отдаётся, есть ли в клетке цифра, и её рисунок.
import type { GrayImage, OmrCircle, OmrLayout, OmrResult, OpenBox, Picked } from './types';

type H3 = number[];

// ---------- геометрия ----------
export function solveHomography(src: number[][], dst: number[][]): H3 | null {
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    [B[i], B[p]] = [B[p], B[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      B[r] -= f * B[i];
    }
  }
  const h = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = B[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * h[c];
    h[i] = s / A[i][i];
  }
  return [...h, 1];
}

export const applyH = (H: H3, x: number, y: number): [number, number] => {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
};

// ---------- бинаризация и пятна ----------
/** Пиксель «тёмный», если он темнее k · (среднее в окне). k = 0,8 — чернила, 0,4 — почти чёрные метки */
export function adaptiveBinary(img: GrayImage, win: number, k: number): Uint8Array {
  const { w, h, data } = img;
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const half = win >> 1;
  const bin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      bin[y * w + x] = data[y * w + x] < mean * k ? 1 : 0;
    }
  }
  return bin;
}

interface Blob { area: number; cx: number; cy: number; x0: number; y0: number; x1: number; y1: number; iso: number; solid: number }

function components(bin: Uint8Array, w: number, h: number): Blob[] {
  const lab = new Uint8Array(w * h);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!bin[i] || lab[i]) continue;
    let area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack.push(i);
    lab[i] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && bin[p - 1] && !lab[p - 1]) { lab[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && bin[p + 1] && !lab[p + 1]) { lab[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && bin[p - w] && !lab[p - w]) { lab[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && bin[p + w] && !lab[p + w]) { lab[p + w] = 1; stack.push(p + w); }
    }
    const cx = sx / area, cy = sy / area;
    const vxx = sxx / area - cx * cx + 1 / 12, vyy = syy / area - cy * cy + 1 / 12, vxy = sxy / area - cx * cy;
    const tr = vxx + vyy, det = vxx * vyy - vxy * vxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    out.push({ area, cx, cy, x0, y0, x1, y1, iso: l2 / l1, solid: area / (12 * Math.sqrt(l1 * l2)) });
  }
  return out;
}

interface Corners { TL: Blob; TR: Blob; BL: Blob; BR: Blob }

/** Четыре угловые метки: самый большой согласованный четырёхугольник из квадратных пятен */
function findMarkers(bin: Uint8Array, w: number, h: number, want: number): Corners[] {
  const minArea = w * h * 0.00007;
  // Квадрат при любом повороте: равные главные оси и площадь ≈ 12·σ² (кольца и линии отсеиваются)
  const sq = components(bin, w, h).filter((c) => {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    return c.area >= minArea && c.iso > 0.45 && c.solid > 0.8 && c.solid < 1.35 && Math.max(bw, bh) < w * 0.12;
  });
  if (sq.length < 4) return [];
  // Закрашенные кружки и квадратики кода по размеру близки к меткам: берём для каждого угла
  // несколько самых крайних кандидатов и ищем четырёхугольник наибольшей площади, остальное лежит внутри него
  const K = 6;
  const best = (f: (c: Blob) => number) => sq.slice().sort((p, q) => f(q) - f(p)).slice(0, K);
  const TLs = best((c) => -(c.cx + c.cy)), BRs = best((c) => c.cx + c.cy);
  const TRs = best((c) => c.cx - c.cy), BLs = best((c) => -(c.cx - c.cy));
  const found: Array<Corners & { area2: number; fit: number }> = [];
  const seen = new Set<string>();
  for (const TL of TLs) for (const TR of TRs) for (const BL of BLs) for (const BR of BRs) {
    if (new Set([TL, TR, BL, BR]).size < 4) continue;
    const areas = [TL.area, TR.area, BL.area, BR.area];
    if (Math.max(...areas) > Math.min(...areas) * 2.6) continue;
    const P = [TL, TR, BR, BL];
    let area2 = 0;
    for (let i = 0; i < 4; i++) { const p = P[i], q = P[(i + 1) % 4]; area2 += p.cx * q.cy - q.cx * p.cy; }
    area2 = Math.abs(area2);
    const d1 = Math.hypot(TL.cx - BR.cx, TL.cy - BR.cy), d2 = Math.hypot(TR.cx - BL.cx, TR.cy - BL.cy);
    const mid = Math.hypot((TL.cx + BR.cx - TR.cx - BL.cx) / 2, (TL.cy + BR.cy - TR.cy - BL.cy) / 2);
    if (mid > 0.15 * Math.min(d1, d2)) continue;
    // Форма: длинная сторона к короткой должна быть как у бланка (на листе три полоски — в кадр может попасть соседняя)
    const dd = (a: Blob, b: Blob) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
    const long = (dd(TL, TR) + dd(BL, BR)) / 2, short = (dd(TL, BL) + dd(TR, BR)) / 2;
    const ratio = Math.max(long, short) / Math.min(long, short);
    const fit = Math.abs(Math.log(ratio / want));
    const key = [TL, TR, BL, BR].map((b) => `${b.cx | 0},${b.cy | 0}`).join(';');
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ area2, fit, TL, TR, BL, BR });
  }
  // Сначала те, чья форма ближе к бланку, при равной форме — больше по площади
  found.sort((a, b) => (Math.abs(a.fit - b.fit) > 0.04 ? a.fit - b.fit : b.area2 - a.area2));
  return found.slice(0, 8).map(({ TL, TR, BL, BR }) => ({ TL, TR, BL, BR }));
}

/**
 * Запасной поиск меток — когда обычный (самые крайние квадраты кадра) не дал бланка. На снимке стопки в кадр попадают
 * соседние листы: их метки и квадратики кода лежат ближе к углам кадра, чем метки своего бланка, и вытесняют их из
 * кандидатов. Здесь четвёрка собирается по форме: две диагонали с общей серединой и длиной, которая соответствует
 * размеру самих меток (диагональ бланка = diagPerSide сторон метки), стороны — как у бланка. Подходящих четвёрок бывает
 * много (метки нижних листов рядом со своими), поэтому отдаётся до 80 самых больших: какая из них настоящая, решают
 * код бланка и кружки.
 */
function findMarkersWide(sq: Blob[], want: number, diagPerSide: number): Corners[] {
  if (sq.length < 4 || sq.length > 140) return [];
  const dist = (p: Blob, q: Blob) => Math.hypot(p.cx - q.cx, p.cy - q.cy);
  const diags: Array<{ p: Blob; q: Blob; d: number }> = [];
  for (let i = 0; i < sq.length; i++) for (let j = i + 1; j < sq.length; j++) {
    const p = sq[i], q = sq[j];
    if (Math.max(p.area, q.area) > Math.min(p.area, q.area) * 2.6) continue;
    const d = dist(p, q), rel = d / (Math.sqrt((p.area + q.area) / 2) * diagPerSide);
    if (rel > 0.6 && rel < 1.7) diags.push({ p, q, d });
  }
  const found: Array<Corners & { area2: number }> = [];
  for (let i = 0; i < diags.length; i++) for (let j = i + 1; j < diags.length; j++) {
    const A = diags[i], B = diags[j];
    if (A.p === B.p || A.p === B.q || A.q === B.p || A.q === B.q) continue;
    const mid = Math.hypot((A.p.cx + A.q.cx - B.p.cx - B.q.cx) / 2, (A.p.cy + A.q.cy - B.p.cy - B.q.cy) / 2);
    if (mid > 0.15 * Math.min(A.d, B.d)) continue;
    const areas = [A.p.area, A.q.area, B.p.area, B.q.area];
    if (Math.max(...areas) > Math.min(...areas) * 2.6) continue;
    // Обход по часовой стрелке (ось y вниз), иначе гомография получится зеркальной
    const cw = (B.p.cx - A.p.cx) * (A.q.cy - B.p.cy) - (B.p.cy - A.p.cy) * (A.q.cx - B.p.cx) > 0;
    let P = cw ? [A.p, B.p, A.q, B.q] : [A.p, B.q, A.q, B.p];
    // Насколько четвёрка похожа на прямоугольник бланка: противоположные стороны равны, стороны относятся как у бланка,
    // диагонали делят друг друга пополам. Снимок под углом всё это немного нарушает, случайная четвёрка — сильно.
    const e = [dist(P[0], P[1]), dist(P[1], P[2]), dist(P[2], P[3]), dist(P[3], P[0])];
    const s1 = (e[0] + e[2]) / 2, s2 = (e[1] + e[3]) / 2;
    const off = Math.abs(Math.log(e[0] / e[2])) + Math.abs(Math.log(e[1] / e[3])) + Math.abs(Math.log(Math.max(s1, s2) / Math.min(s1, s2) / want)) + mid / Math.min(A.d, B.d);
    if (off > WIDE_OFF_MAX) continue;
    // Первым идёт левый верхний угол кадра — как в обычном поиске, чтобы поворот снимка считался одинаково
    let first = 0;
    for (let n = 1; n < 4; n++) if (P[n].cx + P[n].cy < P[first].cx + P[first].cy) first = n;
    P = [0, 1, 2, 3].map((n) => P[(first + n) % 4]);
    let area2 = 0;
    for (let n = 0; n < 4; n++) area2 += P[n].cx * P[(n + 1) % 4].cy - P[(n + 1) % 4].cx * P[n].cy;
    found.push({ TL: P[0], TR: P[1], BR: P[2], BL: P[3], area2: Math.abs(area2) });
  }
  found.sort((x, y) => y.area2 - x.area2);
  return found.slice(0, 80).map(({ TL, TR, BL, BR }) => ({ TL, TR, BL, BR }));
}
/** Наибольшее отклонение четвёрки от прямоугольника бланка в запасном поиске (сумма долей, см. findMarkersWide) */
const WIDE_OFF_MAX = 0.35;

// ---------- чтение отметок ----------
/** Доля закрашенной площади кружка, начиная с которой он считается отмеченным */
export const FILL_ON = 0.40;
const UNSURE_LO = 0.18;

type At = (x: number, y: number) => number;

function sampler(bin: Uint8Array, w: number, h: number, H: H3): At {
  return (x, y) => {
    const [u, v] = applyH(H, x, y);
    const ix = Math.round(u), iy = Math.round(v);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return -1;
    return bin[iy * w + ix];
  };
}

function discFill(at: At, cx: number, cy: number, r: number): number {
  let on = 0, tot = 0;
  const step = 0.3;
  for (let dy = -r; dy <= r; dy += step) for (let dx = -r; dx <= r; dx += step) {
    if (dx * dx + dy * dy > r * r) continue;
    const v = at(cx + dx, cy + dy);
    if (v < 0) continue;
    tot++; on += v;
  }
  return tot ? on / tot : 0;
}

function squareFill(at: At, cx: number, cy: number, size: number): number {
  let on = 0, tot = 0;
  const r = size / 2 * 0.7, step = 0.25;
  for (let dy = -r; dy <= r; dy += step) for (let dx = -r; dx <= r; dx += step) {
    const v = at(cx + dx, cy + dy);
    if (v < 0) continue;
    tot++; on += v;
  }
  return tot ? on / tot : 0;
}

/** Оценка совпадения контура кружка с напечатанным кольцом при небольшом смещении (dx, dy) */
function circleRingMatch(at: At, c: OmrCircle, dx: number, dy: number): number {
  const R = c.d / 2;
  const N = 8;
  let ring = 0, out = 0, tot = 0;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    let hit = 0, bad = false;
    for (const dr of [-0.2, 0, 0.2]) {
      const v = at(c.x + dx + (R + dr) * ca, c.y + dy + (R + dr) * sa);
      if (v < 0) { bad = true; break; }
      if (v > 0) hit = 1;
    }
    const o = at(c.x + dx + (R + 0.6) * ca, c.y + dy + (R + 0.6) * sa);
    if (bad || o < 0) continue;
    tot++; ring += hit; out += o;
  }
  return tot ? (ring - out) / tot : 0;
}

/** Смещения ряда, которые перебирает подстройка (мм). Сначала нулевое: при равной оценке выбирается меньший сдвиг */
const ROW_SHIFTS = [0, -0.3, 0.3, -0.6, 0.6, -0.9, 0.9];

/**
 * Локальная адаптивная автоподстройка ряда: компенсирует изгиб бумаги. На реальных снимках печатные
 * рамки уезжают относительно раскладки до 0,9 мм (лист изогнут, рука держит полоску), поэтому ±0,3 мм мало.
 */
function refineRowOffset(options: OmrCircle[], at: At): { dx: number; dy: number; score: number } {
  let bestDx = 0, bestDy = 0, bestScore = -999;
  for (const dy of ROW_SHIFTS) for (const dx of ROW_SHIFTS) {
    let sum = 0;
    for (const o of options) sum += circleRingMatch(at, o, dx, dy);
    if (sum > bestScore + 1e-9) {
      bestScore = sum;
      bestDx = dx;
      bestDy = dy;
    }
  }
  return bestScore > 0 ? { dx: bestDx, dy: bestDy, score: bestScore } : { dx: 0, dy: 0, score: bestScore };
}

function pickOne(options: OmrCircle[], at: At): Picked {
  const { dx, dy } = refineRowOffset(options, at);
  const fills = options.map((o) => discFill(at, o.x + dx, o.y + dy, o.d / 2 * 0.62));
  const on: number[] = [];
  fills.forEach((f, i) => { if (f >= FILL_ON) on.push(i); });
  const unsure = fills.some((f) => f >= UNSURE_LO && f < FILL_ON + 0.1);
  if (on.length === 0) return { answer: null, unsure, fills };
  if (on.length > 1) return { answer: 'multi', unsure: true, fills, candidates: on.map((i) => options[i].value) };
  return { answer: options[on[0]].value, unsure, fills };
}

/**
 * Положение печатной рамки клеток открытого ответа. Лист изогнут, и рамка уезжает от раскладки до ~1 мм; окно чтения
 * (на 0,9 мм внутрь клетки) тогда захватывает линию рамки, и пустая клетка выглядит «с цифрой». Перебираем сдвиг
 * всей строки клеток и берём тот, при котором больше всего точек на линиях рамки (границы клеток, верх и низ) тёмные.
 */
export function fitOpenFrame(at: At, boxes: Array<{ x: number; y: number; w: number; h: number }>): { dx: number; dy: number } {
  const n = boxes.length;
  if (!n) return { dx: 0, dy: 0 };
  const x0 = boxes[0].x, y0 = boxes[0].y, x1 = boxes[n - 1].x + boxes[n - 1].w, y1 = y0 + boxes[0].h;
  const vert: Array<[number, number]> = [], horiz: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const x = i < n ? boxes[i].x : x1;
    for (let y = y0 + 0.4; y <= y1 - 0.4; y += 0.25) vert.push([x, y]);
  }
  for (const y of [y0, y1]) for (let x = x0 + 0.4; x <= x1 - 0.4; x += 0.25) horiz.push([x, y]);
  const PERP = [-0.2, 0, 0.2];
  const score = (dx: number, dy: number) => {
    let hit = 0;
    for (const [x, y] of vert) { for (const o of PERP) if (at(x + dx + o, y + dy) > 0) { hit++; break; } }
    for (const [x, y] of horiz) { for (const o of PERP) if (at(x + dx, y + dy + o) > 0) { hit++; break; } }
    return hit / (vert.length + horiz.length);
  };
  let best = { dx: 0, dy: 0, s: score(0, 0) };
  for (let iy = -10; iy <= 10; iy++) for (let ix = -10; ix <= 10; ix++) {
    const dx = ix * 0.15, dy = iy * 0.15;
    // при равной оценке — меньший сдвиг
    const sc = score(dx, dy) - 0.004 * Math.hypot(dx, dy);
    if (sc > best.s + 1e-9) best = { dx, dy, s: sc };
  }
  // линии рамки не нашлись (клетка пустая и без рамки в кадре, засветка) — оставляем как в раскладке
  return best.s >= 0.3 ? { dx: best.dx, dy: best.dy } : { dx: 0, dy: 0 };
}

function openBox(at: At, b: { x: number; y: number; w: number; h: number }): OpenBox {
  const inset = 0.9, step = 0.15;
  const x0 = b.x + inset, x1 = b.x + b.w - inset, y0 = b.y + inset, y1 = b.y + b.h - inset;
  const cols = Math.floor((x1 - x0) / step), rows = Math.floor((y1 - y0) / step);
  const bitmap = new Uint8Array(cols * rows);
  let on = 0, top = rows, bottom = -1, left = cols, right = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = at(x0 + c * step, y0 + r * step);
    if (v > 0) {
      bitmap[r * cols + c] = 1;
      on++;
      if (r < top) top = r;
      if (r > bottom) bottom = r;
      if (c < left) left = c;
      if (c > right) right = c;
    }
  }

  // Очистка типографской рамки клетки. Лист изогнут, поэтому рамка уезжает от раскладки до ~1 мм (и идёт чуть
  // наклонно) и попадает в окно, даже когда положение рамки уже найдено (fitOpenFrame). Убираем пятна, которые целиком
  // лежат в краевой полосе окна (1,2 мм) и тянутся почти на всю его высоту (ширину): это остаток линии рамки.
  const bandPx = Math.round(1.2 / step), minSpan = 0.8;
  // Но тонкая «1», написанная вплотную к линии клетки, выглядит так же: высокое пятно в краевой полосе. Отличие —
  // настоящая линия рамки при этом видна отдельно, снаружи окна, и между ней и пятном светлый зазор.
  // side: с какой стороны окна пятно; from…to — его протяжённость вдоль этой стороны (в точках окна).
  const frameApart = (side: 'L' | 'R' | 'T' | 'B', from: number, to: number): boolean => {
    let gap = false;
    for (let k = 1; k <= Math.round(1.5 / step); k++) {
      let dark = 0;
      for (let i = from; i <= to; i++) {
        const v = side === 'L' ? at(x0 - k * step, y0 + i * step)
          : side === 'R' ? at(x0 + (cols - 1 + k) * step, y0 + i * step)
            : side === 'T' ? at(x0 + i * step, y0 - k * step)
              : at(x0 + i * step, y0 + (rows - 1 + k) * step);
        if (v > 0) dark++;
      }
      const share = dark / (to - from + 1);
      if (share <= 0.2) gap = true;
      else if (gap && share >= 0.7) return true;
    }
    return false;
  };
  const seen = new Uint8Array(cols * rows);
  const stack: number[] = [];
  for (let i0 = 0; i0 < cols * rows; i0++) {
    if (!bitmap[i0] || seen[i0]) continue;
    const comp: number[] = [];
    let cx0 = cols, cx1 = -1, cy0 = rows, cy1 = -1;
    stack.push(i0);
    seen[i0] = 1;
    while (stack.length) {
      const p = stack.pop() as number;
      comp.push(p);
      const x = p % cols, y = (p / cols) | 0;
      if (x < cx0) cx0 = x;
      if (x > cx1) cx1 = x;
      if (y < cy0) cy0 = y;
      if (y > cy1) cy1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const q = ny * cols + nx;
        if (bitmap[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    const tall = (cy1 - cy0 + 1) >= rows * minSpan, wide = (cx1 - cx0 + 1) >= cols * minSpan;
    const inSide = cx1 < bandPx || cx0 >= cols - bandPx, inEnd = cy1 < bandPx || cy0 >= rows - bandPx;
    const isFrame = (tall && inSide && !frameApart(cx1 < bandPx ? 'L' : 'R', cy0, cy1)) || (wide && inEnd && !frameApart(cy1 < bandPx ? 'T' : 'B', cx0, cx1));
    if (isFrame) for (const p of comp) { bitmap[p] = 0; on--; }
  }

  // Пересчитываем габариты чернил после очистки рамки
  top = rows; bottom = -1; left = cols; right = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (bitmap[r * cols + c]) {
      if (r < top) top = r;
      if (r > bottom) bottom = r;
      if (c < left) left = c;
      if (c > right) right = c;
    }
  }

  // Цифра — рисунок высотой не меньше ~45 % клетки; точки и короткие чёрточки — случайные пятна
  const heightMm = bottom >= 0 ? (bottom - top + 1) * step : 0;
  const widthMm = right >= 0 ? (right - left + 1) * step : 0;
  const ink = cols * rows ? on / (cols * rows) : 0;
  return { ink, hasDigit: ink > 0.02 && heightMm >= 2.4, heightMm, widthMm, cols, rows, bitmap };
}

/**
 * Совпадают ли напечатанные кружки бланка с раскладкой: на контуре кружка должно быть тёмное,
 * чуть снаружи — светлое. Код бланка (4 квадратика) иногда случайно «сходится» и на неверной четвёрке
 * меток (например, из закрашенных кружков, когда настоящая метка закрыта пальцем или бликом) —
 * тогда ответы читались со сдвигом. Эта проверка такие четвёрки отсекает.
 */
export function ringScore(at: At, layout: OmrLayout): number {
  const per = ringParts(at, layout);
  return per.length ? per[per.length >> 1] : 0;
}
/** Оценка каждого кружка бланка по возрастанию (см. ringScore) */
function ringParts(at: At, layout: OmrLayout): number[] {
  const groups: OmrCircle[][] = [layout.variant, ...layout.tests.map((t) => t.options), ...layout.matching.flatMap((m) => m.rows.map((r) => r.options))];
  const N = 16;
  const per: number[] = [];
  for (const g of groups) {
    // Ряд ищется со своим небольшим сдвигом: у изогнутого листа кружки лежат не там, где в раскладке, но рядом
    const { dx, dy } = refineRowOffset(g, at);
    for (const c of g) {
      const R = c.d / 2;
      let ring = 0, out = 0, tot = 0;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        let hit = 0, bad = false;
        for (const dr of [-0.35, -0.15, 0, 0.15]) {
          const v = at(c.x + dx + (R + dr) * ca, c.y + dy + (R + dr) * sa);
          if (v < 0) { bad = true; break; }
          if (v > 0) hit = 1;
        }
        const o = at(c.x + dx + (R + 0.6) * ca, c.y + dy + (R + 0.6) * sa);
        if (bad || o < 0) continue;
        tot++; ring += hit; out += o;
      }
      if (tot) per.push((ring - out) / tot);
    }
  }
  per.sort((p, q) => p - q);
  return per;
}
/** Начиная с какого ringScore раскладка считается совпавшей со снимком */
export const RING_MIN = 0.5;
/**
 * Средняя оценка кружков, при которой четвёрка меток не вызывает сомнений. На реальных снимках у настоящей четвёрки
 * она 0,84–0,98, у «смешанной» с меткой нижнего листа стопки — 0,61–0,65; ниже порога включается запасной поиск.
 */
const RING_AVG_SURE = 0.75;

/**
 * Порог повторного чтения клетки открытого ответа. Бледный карандаш темнее бумаги всего на 15–30 %, строгая бинаризация
 * (0,8) его не видит, и клетка выглядит пустой. Клетку, где цифра не нашлась, перечитываем с этим порогом; клетки с
 * найденной цифрой не трогаем — их рисунок (по нему подсказывается цифра) остаётся прежним.
 */
const OPEN_SOFT_K = 0.88;

/** Пороги поиска меток: сначала строгий (метки почти чёрные), потом мягче — у тёмного стола или в тени краевая метка не всегда темнее 0,4 от среднего окна */
const MARKER_K = [0.4, 0.55, 0.7];

export interface OmrOptions {
  /** Допустимые коды бланка (у химии и физики одинаковая раскладка, а коды разные). По умолчанию — код раскладки. */
  codes?: number[];
}

interface Located { best: { score: number; mism: number; rot: number; H: H3; at: At; ring: Blob[]; fit: number; avg: number } | null; shapeBad: boolean; anyMarkers: boolean; dstRing: number[][]; k: number; missingHint?: string }

function findMissingHint(sq: Blob[], w: number, h: number, want: number): string | undefined {
  if (sq.length < 3) return undefined;
  for (let i = 0; i < sq.length; i++) {
    for (let j = 0; j < sq.length; j++) {
      if (j === i) continue;
      for (let k = 0; k < sq.length; k++) {
        if (k === i || k === j) continue;
        const P = sq[i], Q = sq[j], R = sq[k];
        const u = [Q.cx - P.cx, Q.cy - P.cy], v = [R.cx - P.cx, R.cy - P.cy];
        const d1 = Math.hypot(u[0], u[1]), d2 = Math.hypot(v[0], v[1]);
        if (d1 < w * 0.12 || d2 < w * 0.12) continue;
        const dot = Math.abs(u[0] * v[0] + u[1] * v[1]) / (d1 * d2);
        if (dot > 0.25) continue;
        const ratio = Math.max(d1, d2) / Math.min(d1, d2);
        if (Math.abs(Math.log(ratio / want)) > 0.38) continue;
        const sx = Q.cx + R.cx - P.cx, sy = Q.cy + R.cy - P.cy;
        const cornerName = sy < h / 2
          ? (sx < w / 2 ? 'верхний левый' : 'верхний правый')
          : (sx < w / 2 ? 'нижний левый' : 'нижний правый');
        const outOfFrame = sx < 20 || sx > w - 20 || sy < 20 || sy > h - 20;
        return outOfFrame
          ? `Не виден ${cornerName} угол бланка: метка вышла за пределы кадра. Отодвиньте камеру чуть назад.`
          : `Не виден ${cornerName} угол бланка: метка перекрыта пальцем, бликом или тенью.`;
      }
    }
  }
  return undefined;
}

/** Ищет метки и поворот бланка: порог меток ослабляем, пока не сойдётся код бланка */
function locate(img: GrayImage, layout: OmrLayout, opts: OmrOptions): Located {
  const { w, h } = img;
  const win = Math.max(31, Math.round(w / 8) | 1);
  const lm = layout.markers; // TL, TR, BL, BR
  const want = Math.hypot(lm[1].x - lm[0].x, lm[1].y - lm[0].y) / Math.hypot(lm[2].x - lm[0].x, lm[2].y - lm[0].y);
  const bin = adaptiveBinary(img, win, 0.8);
  const dstRing: number[][] = [[lm[0].x, lm[0].y], [lm[1].x, lm[1].y], [lm[3].x, lm[3].y], [lm[2].x, lm[2].y]]; // по часовой
  const codes = opts.codes ?? [layout.code];
  const popcount = (n: number) => { let c = 0; for (; n; n >>= 1) c += n & 1; return c; };
  let best: Located['best'] = null;
  let shapeBad = false;
  let anyMarkers = false;
  let kUsed = MARKER_K[0];
  let missingHint: string | undefined;
  const found = () => !!best && best.mism === 0 && best.fit >= RING_MIN;
  const sure = () => found() && (best as NonNullable<Located['best']>).avg >= RING_AVG_SURE;
  const squares: Blob[][] = [];
  // Кандидатов несколько (в кадр может попасть соседняя полоска листа): выбираем того, у кого сходится код бланка
  const tryQuads = (cands: Corners[], k: number) => {
    for (const mk of cands) {
      const d = (a: Blob, b: Blob) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
      const got = (d(mk.TL, mk.TR) + d(mk.BL, mk.BR)) / (d(mk.TL, mk.BL) + d(mk.TR, mk.BR));
      // форма должна быть как у бланка, в любом из поворотов на 90°
      if (Math.min(got / want, want / got) < 0.6 && Math.min(got * want, 1 / (got * want)) < 0.6) { shapeBad = true; continue; }
      const ring = [mk.TL, mk.TR, mk.BR, mk.BL];
      for (let rot = 0; rot < 4; rot++) {
        const src = dstRing.map((_, i) => [ring[(i + rot) % 4].cx, ring[(i + rot) % 4].cy]);
        const H = solveHomography(dstRing, src);
        if (!H) continue;
        const at = sampler(bin, w, h, H);
        const bits = layout.codeCells.map((c) => squareFill(at, c.x, c.y, c.size));
        const first = bits[0];
        const value = bits.slice(1).reduce((a, f) => (a << 1) | (f > 0.5 ? 1 : 0), 0);
        let mism = Math.min(...codes.map((c) => popcount(c ^ value)));
        if (first < 0.5) mism += 2;
        // Код сошёлся — проверяем, что и кружки бланка лежат на своих местах
        const per = mism === 0 ? ringParts(at, layout) : [];
        const fit = per.length ? per[per.length >> 1] : 0;
        const avg = per.length ? per.reduce((a, v) => a + v, 0) / per.length : 0;
        // Из четвёрок, прошедших проверку, берётся та, у которой на месте больше кружков (средняя оценка): у «смешанной»
        // четвёрки (три свои метки и метка нижнего листа стопки) медиана тоже высокая, а средняя заметно ниже
        const score = mism * 10 - first - (fit >= RING_MIN ? 100 + 10 * avg : 0) - fit;
        if (!best || score < best.score) { best = { score, mism, rot, H, at, ring, fit, avg }; kUsed = k; }
      }
    }
  };
  for (const k of MARKER_K) {
    const sqCandidates = components(adaptiveBinary(img, win, k), w, h).filter((c) => {
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      const minArea = w * h * 0.00007;
      return c.area >= minArea && c.iso > 0.45 && c.solid > 0.8 && c.solid < 1.35 && Math.max(bw, bh) < w * 0.12;
    });
    squares.push(sqCandidates);
    const cands = findMarkers(adaptiveBinary(img, win, k), w, h, Math.max(want, 1 / want));
    if (!cands.length) {
      if (!missingHint) missingHint = findMissingHint(sqCandidates, w, h, Math.max(want, 1 / want));
      continue;
    }
    anyMarkers = true;
    tryQuads(cands, k);
    if (found()) break;
  }
  // Бланк не нашёлся среди самых крайних квадратов кадра (их заслонили метки соседних листов стопки) либо нашёлся
  // сомнительно: кружки совпали не все — возможно, одна из меток взята с нижнего листа
  if (!sure()) {
    const before = { best, kUsed, shapeBad };
    const diagPerSide = Math.hypot(lm[3].x - lm[0].x, lm[3].y - lm[0].y) / lm[0].size;
    for (let i = 0; i < squares.length && !sure(); i++) tryQuads(findMarkersWide(squares[i], Math.max(want, 1 / want), diagPerSide), MARKER_K[i]);
    // Не помогло — итог и причина отказа остаются такими, какими были без запасного поиска
    if (found()) anyMarkers = true;
    else ({ best, kUsed, shapeBad } = before);
  }
  if (!found() && !missingHint) {
    for (const k of MARKER_K) {
      const minArea = w * h * 0.00007;
      const sqCandidates = components(adaptiveBinary(img, win, k), w, h).filter((c) => {
        const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
        return c.area >= minArea && c.iso > 0.45 && c.solid > 0.8 && c.solid < 1.35 && Math.max(bw, bh) < w * 0.12;
      });
      missingHint = findMissingHint(sqCandidates, w, h, Math.max(want, 1 / want));
      if (missingHint) break;
    }
  }
  return { best, shapeBad, anyMarkers, dstRing, k: kUsed, missingHint };
}

/** Считывает одну полоску бланка. Если codeOk = false, снимок лучше не использовать. */
export function omrRead(img: GrayImage, layout: OmrLayout, opts: OmrOptions = {}): OmrResult {
  const { w, h } = img;
  const { best, shapeBad, anyMarkers, dstRing, missingHint } = locate(img, layout, opts);
  if (!anyMarkers) return missingHint ? { ok: false, reason: 'markers', missingHint } : { ok: false, reason: 'markers' };
  if (!best) return missingHint ? { ok: false, reason: shapeBad ? 'shape' : 'homography', missingHint } : { ok: false, reason: shapeBad ? 'shape' : 'homography' };
  const { at, ring } = best;

  // Качество снимка: сколько пикселей приходится на мм бланка и насколько сильно он снят под углом
  const edge = (a: Blob, b: Blob) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const e = [edge(ring[0], ring[1]), edge(ring[1], ring[2]), edge(ring[2], ring[3]), edge(ring[3], ring[0])];
  const mmE = [0, 1, 2, 3].map((i) => Math.hypot(dstRing[(i + 1) % 4][0] - dstRing[i][0], dstRing[(i + 1) % 4][1] - dstRing[i][1]));
  const pxPerMm = e.reduce((a, v) => a + v, 0) / mmE.reduce((a, v) => a + v, 0);
  const skew = Math.max(Math.max(e[0], e[2]) / Math.min(e[0], e[2]), Math.max(e[1], e[3]) / Math.min(e[1], e[3]));

  const codeOk = best.mism === 0 && best.fit >= RING_MIN;
  let soft: At | null = null;
  const atSoft = () => (soft ??= sampler(adaptiveBinary(img, Math.max(31, Math.round(w / 8) | 1), OPEN_SOFT_K), w, h, best.H));
  return {
    ok: true,
    codeOk,
    ...(missingHint && !codeOk ? { missingHint } : {}),
    quality: { pxPerMm, skew, ring: best.fit },
    rotation: best.rot * 90,
    toPhoto: best.H,
    variant: pickOne(layout.variant, at),
    tests: layout.tests.map((t) => ({ q: t.q, ...pickOne(t.options, at) })),
    matching: layout.matching.map((m) => ({ q: m.q, rows: m.rows.map((r) => ({ row: r.row, ...pickOne(r.options, at) })) })),
    open: layout.open.map((o) => {
      const { dx, dy } = fitOpenFrame(at, o.boxes);
      return {
        q: o.q,
        boxes: o.boxes.map((b) => {
          const cell = { ...b, x: b.x + dx, y: b.y + dy };
          const strict = openBox(at, cell);
          if (strict.hasDigit) return strict;
          const faint = openBox(atSoft(), cell);
          return faint.hasDigit ? faint : strict;
        }),
      };
    }),
  };
}

/** Что «видит» распознавание: чёрно-белая картинка (по ней ищутся метки) и найденные метки — для подсказки пользователю, если снимок не прочитался */
export function omrDebug(img: GrayImage, layout: OmrLayout): { bin: Uint8Array; markers: Array<{ x: number; y: number }> } {
  const { w } = img;
  const win = Math.max(31, Math.round(w / 8) | 1);
  const { best, k } = locate(img, layout, {});
  const bin = adaptiveBinary(img, win, best ? k : MARKER_K[0]);
  return { bin, markers: best ? best.ring.map((m) => ({ x: m.cx, y: m.cy })) : [] };
}

/**
 * Чтение бланка, когда составу билета подходят несколько раскладок (биология и таджикский: у второго пять клеток
 * под открытый ответ). Раскладки с одинаковыми клетками читаются за один проход по списку кодов, с разными —
 * по очереди, пока код бланка не сойдётся. Если не сошёлся ни один, возвращается первый результат.
 */
export function omrReadAny(img: GrayImage, layouts: OmrLayout[]): { res: ReturnType<typeof omrRead>; layout: OmrLayout } {
  const groups = new Map<string, { layout: OmrLayout; codes: number[] }>();
  for (const l of layouts) {
    const sig = JSON.stringify([l.kind, l.open]);
    const g = groups.get(sig);
    if (g) g.codes.push(l.code);
    else groups.set(sig, { layout: l, codes: [l.code] });
  }
  let first: { res: ReturnType<typeof omrRead>; layout: OmrLayout } | null = null;
  for (const g of groups.values()) {
    const res = omrRead(img, g.layout, { codes: g.codes });
    if (res.ok && res.codeOk) return { res, layout: g.layout };
    first ??= { res, layout: g.layout };
  }
  if (!first) throw new Error('omrReadAny: нет раскладок');
  return first;
}
