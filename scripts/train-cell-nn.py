# Обучение сети, которая читает цифру по серой вырезке всей клетки (28×32, cellGray в recognize.ts), и запись
# src/lib/omr/cellWeights.generated.ts. Сеть: свёртка 3×3 (C1, с полями) → максимум 2×2 → свёртка 3×3 (C2, с полями)
# → максимум 2×2 → FC → 10; её же считает predictDigitNnCell в digitNn.ts.
# Данные: scripts/real-cells.json — обезличенные вырезки клеток с меткой и пачкой (без фото и имён).
# Каждая вырезка повторяется REAL_REP раз со случайным поворотом, наклоном, растяжением, сдвигом и контрастом.
# Нужны python с numpy и scipy. Перед запуском нескольких проверок сразу: OMP_NUM_THREADS=1.
#   python scripts/train-cell-nn.py                      — обучение на всём, запись весов
#   python scripts/train-cell-nn.py --holdout batch-9    — честная проверка: пачка в обучение не идёт, веса не пишутся
#   python scripts/train-cell-nn.py --all-holdouts       — все пачки по очереди (в 7 процессов), сумма верных
#   --seed N — начальное число (по умолчанию 42); наборы данных сравнивают по сумме нескольких чисел (1, 2, 3).
import base64, json, os, sys
import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
H, W = 32, 28
C1, C2, FC, OUT = 8, 16, 64, 10
REAL_REP, EPOCHS, BATCH, LR, DROP = 12, 20, 32, 0.003, 0.3
PADS = ((0, 0), (1, 1), (1, 1), (0, 0))

def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

def norm(g):
    """Серое (тёмные чернила) → 0…1: фон (85-й процентиль) в ноль, самое тёмное в единицу, размах не меньше 40."""
    g = g.astype(np.float32); bg = np.percentile(g, 85, axis=(1, 2), keepdims=True); lo = g.min(axis=(1, 2), keepdims=True)
    return np.clip((bg - g) / np.maximum(40, bg - lo), 0, 1)

def augment(im, rng):
    n = len(im); o = np.empty_like(im); c = np.array([(H - 1) / 2, (W - 1) / 2])
    for i in range(n):
        a = rng.normal(0, 0.10); sh = rng.normal(0, 0.14); sx, sy = np.exp(rng.normal(0, 0.08, 2))
        M = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]]) @ np.array([[1, 0], [sh, 1]]) @ np.diag([1 / sy, 1 / sx])
        o[i] = ndimage.affine_transform(im[i], M, offset=c - M @ c + rng.normal(0, 1.2, 2), order=1)
    return (np.clip(o, 0, 1) ** np.exp(rng.normal(0, 0.25, (n, 1, 1)))).astype(np.float32)  # бледнее или жирнее

def im2col(x, k):  # (N,H,W,C) -> (N,H-k+1,W-k+1,k*k*C); порядок признаков: (i*k+j)*C + c
    w = np.lib.stride_tricks.sliding_window_view(x, (k, k), axis=(1, 2))
    return np.ascontiguousarray(w.transpose(0, 1, 2, 4, 5, 3)).reshape(w.shape[0], w.shape[1], w.shape[2], -1)

def col2im(dc, shape, k):
    N, Hh, Ww, C = shape; out = np.zeros(shape, np.float32); d = dc.reshape(N, Hh - k + 1, Ww - k + 1, k, k, C)
    for i in range(k):
        for j in range(k): out[:, i:i + Hh - k + 1, j:j + Ww - k + 1, :] += d[:, :, :, i, j, :]
    return out

class Net:
    def __init__(s, rng):
        r = lambda fan, *sh: ((rng.random(sh, dtype=np.float32) * 2 - 1) * np.sqrt(2 / fan)).astype(np.float32)
        nf = (H // 4) * (W // 4) * C2
        s.K1 = r(9, 9, C1); s.c1 = np.zeros(C1, np.float32); s.K2 = r(9 * C1, 9 * C1, C2); s.c2 = np.zeros(C2, np.float32)
        s.W1 = r(nf, nf, FC); s.b1 = np.zeros(FC, np.float32); s.W2 = r(FC, FC, OUT); s.b2 = np.zeros(OUT, np.float32)
        s.ps = [s.K1, s.c1, s.K2, s.c2, s.W1, s.b1, s.W2, s.b2]; s.rng = rng
    def fwd(s, x, train=False):
        N = len(x); s.col1 = im2col(np.pad(x[..., None], PADS), 3); s.a1 = np.maximum(0, s.col1 @ s.K1 + s.c1)
        a = s.a1.reshape(N, H // 2, 2, W // 2, 2, C1); s.p1 = a.max((2, 4)); s.m1 = (a == s.p1[:, :, None, :, None, :])
        s.col2 = im2col(np.pad(s.p1, PADS), 3); s.a2 = np.maximum(0, s.col2 @ s.K2 + s.c2)
        b = s.a2.reshape(N, H // 4, 2, W // 4, 2, C2); s.p2 = b.max((2, 4)); s.m2 = (b == s.p2[:, :, None, :, None, :])
        s.f = s.p2.reshape(N, -1); s.hd = np.maximum(0, s.f @ s.W1 + s.b1); s.tr = train
        if train: s.mask = ((s.rng.random(s.hd.shape) > DROP) / (1 - DROP)).astype(np.float32); s.hd = s.hd * s.mask
        return s.hd @ s.W2 + s.b2
    def bwd(s, dz):
        N = len(dz); gW2 = s.hd.T @ dz; gb2 = dz.sum(0); dh = dz @ s.W2.T
        if s.tr: dh = dh * s.mask
        dh = dh * (s.hd > 0); gW1 = s.f.T @ dh; gb1 = dh.sum(0)
        dp2 = (dh @ s.W1.T).reshape(s.p2.shape)
        da2 = (s.m2 * dp2[:, :, None, :, None, :]).reshape(s.a2.shape) * (s.a2 > 0)
        gK2 = s.col2.reshape(-1, s.col2.shape[-1]).T @ da2.reshape(-1, C2); gc2 = da2.sum((0, 1, 2))
        dp1 = col2im(da2 @ s.K2.T, (N, H // 2 + 2, W // 2 + 2, C1), 3)[:, 1:-1, 1:-1]
        da1 = (s.m1 * dp1[:, :, None, :, None, :]).reshape(s.a1.shape) * (s.a1 > 0)
        return [s.col1.reshape(-1, 9).T @ da1.reshape(-1, C1), da1.sum((0, 1, 2)), gK2, gc2, gW1, gb1, gW2, gb2]

def load():
    real = json.load(open(os.path.join(HERE, 'real-cells.json'), encoding='utf-8'))
    X = norm(np.array([np.frombuffer(base64.b64decode(r['g']), np.uint8).reshape(H, W) for r in real]))
    return X, np.array([r['d'] for r in real]), np.array([r['batch'] for r in real])

def train(X, Y, seed, log=None):
    rng = np.random.default_rng(seed); net = Net(rng)
    A = np.concatenate([augment(X, rng) for _ in range(REAL_REP)]); B = np.concatenate([Y] * REAL_REP)
    m = [np.zeros_like(p) for p in net.ps]; v = [np.zeros_like(p) for p in net.ps]; t = 0; lr = LR
    for ep in range(1, EPOCHS + 1):
        if ep == int(EPOCHS * 0.7) + 1: lr = LR / 4
        p = rng.permutation(len(A)); loss = 0.0
        for i in range(0, len(p), BATCH):
            j = p[i:i + BATCH]; z = net.fwd(A[j], True); z = z - z.max(1, keepdims=True); pr = np.exp(z); pr /= pr.sum(1, keepdims=True)
            loss -= float(np.log(np.maximum(1e-12, pr[np.arange(len(j)), B[j]])).sum())
            pr[np.arange(len(j)), B[j]] -= 1; t += 1
            for w, g, mm, vv in zip(net.ps, net.bwd((pr / len(j)).astype(np.float32)), m, v):
                mm *= 0.9; mm += 0.1 * g; vv *= 0.999; vv += 0.001 * g * g
                w -= lr * (mm / (1 - 0.9 ** t)) / (np.sqrt(vv / (1 - 0.999 ** t)) + 1e-8)
        if log and (ep % 5 == 0 or ep == EPOCHS): log(ep, loss / len(A), net)
    return net

def hold(a):
    b, seed = a; X, Y, B = load(); te = B == b
    net = train(X[~te], Y[~te], seed)
    return b, int((net.fwd(X[te]).argmax(1) == Y[te]).sum()), int(te.sum())

def main():
    seed = int(arg('--seed', 42)); holdout = arg('--holdout')
    X, Y, B = load()
    if '--all-holdouts' in sys.argv:
        from multiprocessing import Pool
        with Pool(7) as p: res = p.map(hold, [(b, seed) for b in sorted(set(B))])
        for b, ok, n in res: print(f'{b}: {ok} из {n} ({100 * ok / n:.0f}%)')
        ok = sum(r[1] for r in res); n = sum(r[2] for r in res)
        print(f'Сумма (seed {seed}): {ok} из {n} = {100 * ok / n:.1f}%'); return
    te = B == holdout
    print(f'Реальных цифр в обучении: {int((~te).sum())} (×{REAL_REP})' + (f', отложено для проверки ({holdout}): {int(te.sum())}' if holdout else ''), flush=True)
    vX, vY = (X[te], Y[te]) if holdout else (X, Y)
    def log(ep, loss, net):
        ok = int((net.fwd(vX).argmax(1) == vY).sum())
        print(f'Эпоха {ep}/{EPOCHS}: Loss = {loss:.4f}, Точность = {100 * ok / len(vX):.1f}% ({ok} из {len(vX)})' + ('' if holdout else ' — на обучающих, не честная'), flush=True)
    net = train(X[~te], Y[~te], seed, log)
    if holdout:
        print('Режим проверки (--holdout): веса не записаны.'); return
    b64 = base64.b64encode(np.concatenate([w.astype('<f4').ravel() for w in net.ps]).tobytes()).decode()
    print(f'Размер весов: {len(b64)} символов base64 (~{len(b64) / 1024:.1f} КБ)')
    target = os.path.normpath(os.path.join(HERE, '..', 'src', 'lib', 'omr', 'cellWeights.generated.ts'))
    with open(target, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// Автоматически сгенерированные веса сети цифр по серой клетке (%d×%d → 3×3×%d → 2×2 → 3×3×%d → 2×2 → %d → %d)\n' % (W, H, C1, C2, FC, OUT))
        f.write('// Запуск сборщика: python scripts/train-cell-nn.py\n\n')
        f.write('export const CELL_NN_CONFIG = { w: %d, h: %d, c1: %d, c2: %d, fc: %d, out: %d } as const;\n' % (W, H, C1, C2, FC, OUT))
        f.write('export const CELL_NN_WEIGHTS_BASE64 = "%s";\n' % b64)
    print('Сохранено в ' + target)

if __name__ == '__main__':
    main()
