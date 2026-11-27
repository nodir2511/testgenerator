# Обучение маленькой свёрточной сети для рукописных цифр и запись src/lib/omr/digitWeights.generated.ts.
# Сеть: 14×14 → свёртка 3×3 (8, с полями) → максимум 2×2 → свёртка 3×3 (16) → 64 → 10 (её же считает digitNn.ts).
# Данные: нарисованные эталоны (scripts/digit-synth.mjs) + реальные цифры с бланков (scripts/real-digits.json).
# Каждая реальная цифра повторяется REAL_REP раз со случайным поворотом, наклоном, растяжением, сдвигом и толщиной
# штриха: без этого сеть запоминает почерк пачек и на новых бланках ошибается.
# Нужны python с numpy и scipy, и node (для эталонов).
#   python scripts/train-digit-nn.py                      — обучение на всём, запись весов
#   python scripts/train-digit-nn.py --holdout batch-3    — честная проверка: пачка в обучение не идёт, веса не пишутся
#   --seed N — начальное число (по умолчанию 42); наборы данных сравнивают по сумме нескольких чисел (1, 2, 3).
import base64, json, os, subprocess, sys
import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
C1, C2, FC, OUT = 8, 16, 64, 10
N_SYNTH, REAL_REP, EPOCHS, BATCH, LR, DROP = 300, 20, 25, 32, 0.003, 0.3
CROSS = np.array([[[0, 1, 0], [1, 1, 1], [0, 1, 0]]])

def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

def augment(x, rng, strong=1.0):
    """Случайные поворот, наклон, растяжение и сдвиг; у части — толще или бледнее штрих."""
    n = len(x); im = x.reshape(n, 14, 14); o = np.empty_like(im); c = np.array([6.5, 6.5])
    for i in range(n):
        a = rng.normal(0, 0.14 * strong); sh = rng.normal(0, 0.18 * strong)
        sx, sy = np.exp(rng.normal(0, 0.10 * strong, 2))
        M = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]]) @ np.array([[1, 0], [sh, 1]]) @ np.diag([1 / sy, 1 / sx])
        o[i] = ndimage.affine_transform(im[i], M, offset=c - M @ c + rng.normal(0, 0.7, 2), order=1)
    r = rng.random(n)
    th = r < 0.3; o[th] = np.maximum(o[th], 0.6 * ndimage.maximum_filter(o[th], footprint=CROSS))
    er = r > 0.85; o[er] = o[er] * (0.6 + 0.4 * rng.random((int(er.sum()), 1, 1)))
    return o.reshape(n, 196).astype(np.float32)

def im2col(x, k):  # (N,H,W,C) -> (N,H-k+1,W-k+1,k*k*C); порядок признаков: (i*k+j)*C + c
    w = np.lib.stride_tricks.sliding_window_view(x, (k, k), axis=(1, 2))
    return np.ascontiguousarray(w.transpose(0, 1, 2, 4, 5, 3)).reshape(w.shape[0], w.shape[1], w.shape[2], -1)

def col2im(dc, shape, k):
    N, H, W, C = shape; out = np.zeros(shape, np.float32); d = dc.reshape(N, H - k + 1, W - k + 1, k, k, C)
    for i in range(k):
        for j in range(k): out[:, i:i + H - k + 1, j:j + W - k + 1, :] += d[:, :, :, i, j, :]
    return out

class Net:
    def __init__(s, rng):
        r = lambda fan, *sh: ((rng.random(sh, dtype=np.float32) * 2 - 1) * np.sqrt(2 / fan)).astype(np.float32)
        s.K1 = r(9, 9, C1); s.c1 = np.zeros(C1, np.float32)
        s.K2 = r(9 * C1, 9 * C1, C2); s.c2 = np.zeros(C2, np.float32)
        s.W1 = r(25 * C2, 25 * C2, FC); s.b1 = np.zeros(FC, np.float32)
        s.W2 = r(FC, FC, OUT); s.b2 = np.zeros(OUT, np.float32)
        s.ps = [s.K1, s.c1, s.K2, s.c2, s.W1, s.b1, s.W2, s.b2]; s.rng = rng
    def fwd(s, x, train=False):
        N = len(x); xp = np.pad(x.reshape(N, 14, 14, 1), ((0, 0), (1, 1), (1, 1), (0, 0)))
        s.col1 = im2col(xp, 3); s.a1 = np.maximum(0, s.col1 @ s.K1 + s.c1)
        a = s.a1.reshape(N, 7, 2, 7, 2, C1); s.p1 = a.max((2, 4)); s.pm = (a == s.p1[:, :, None, :, None, :])
        s.col2 = im2col(s.p1, 3); s.a2 = np.maximum(0, s.col2 @ s.K2 + s.c2)
        s.f = s.a2.reshape(N, -1); s.h = np.maximum(0, s.f @ s.W1 + s.b1); s.tr = train
        if train: s.mask = ((s.rng.random(s.h.shape) > DROP) / (1 - DROP)).astype(np.float32); s.h = s.h * s.mask
        return s.h @ s.W2 + s.b2
    def bwd(s, dz):
        N = len(dz); gW2 = s.h.T @ dz; gb2 = dz.sum(0); dh = dz @ s.W2.T
        if s.tr: dh = dh * s.mask
        dh = dh * (s.h > 0); gW1 = s.f.T @ dh; gb1 = dh.sum(0)
        da2 = (dh @ s.W1.T).reshape(s.a2.shape) * (s.a2 > 0)
        gK2 = s.col2.reshape(-1, s.col2.shape[-1]).T @ da2.reshape(-1, C2); gc2 = da2.sum((0, 1, 2))
        dp1 = col2im(da2 @ s.K2.T, s.p1.shape, 3)
        da1 = (s.pm * dp1[:, :, None, :, None, :]).reshape(N, 14, 14, C1) * (s.a1 > 0)
        return [s.col1.reshape(-1, 9).T @ da1.reshape(-1, C1), da1.sum((0, 1, 2)), gK2, gc2, gW1, gb1, gW2, gb2]

def main():
    seed = int(arg('--seed', 42)); holdout = arg('--holdout')
    rng = np.random.default_rng(seed)
    syn = json.loads(subprocess.run(['node', os.path.join(HERE, 'digit-synth.mjs'), str(seed), str(N_SYNTH)], capture_output=True, check=True).stdout)
    SX = np.array([s['x'] for s in syn], np.float32) / 255; SY = np.array([s['d'] for s in syn])
    real = json.load(open(os.path.join(HERE, 'real-digits.json'), encoding='utf-8'))
    RX = np.array([list(base64.b64decode(r['px'])) for r in real], np.float32) / 255
    RY = np.array([r['d'] for r in real]); RB = np.array([r['batch'] for r in real])
    te = RB == holdout
    print(f'Реальных цифр в обучении: {int((~te).sum())} (×{REAL_REP})' + (f', отложено для проверки ({holdout}): {int(te.sum())}' if holdout else ''), flush=True)
    X = np.concatenate([augment(SX, rng, 0.6)] + [augment(RX[~te], rng) for _ in range(REAL_REP)])
    Y = np.concatenate([SY] + [RY[~te]] * REAL_REP)
    if holdout: vX, vY = RX[te], RY[te]
    else:
        p = rng.permutation(len(X)); k = int(len(X) * 0.85)
        vX, vY = X[p[k:]], Y[p[k:]]; X, Y = X[p[:k]], Y[p[:k]]
    print(f'Обучающая выборка: {len(X)}, валидация: {len(vX)}', flush=True)

    net = Net(rng); m = [np.zeros_like(p) for p in net.ps]; v = [np.zeros_like(p) for p in net.ps]; t = 0; lr = LR
    for ep in range(1, EPOCHS + 1):
        if ep == int(EPOCHS * 0.7) + 1: lr = LR / 4
        p = rng.permutation(len(X)); loss = 0.0
        for i in range(0, len(p), BATCH):
            j = p[i:i + BATCH]; z = net.fwd(X[j], True)
            z = z - z.max(1, keepdims=True); pr = np.exp(z); pr /= pr.sum(1, keepdims=True)
            loss -= float(np.log(np.maximum(1e-12, pr[np.arange(len(j)), Y[j]])).sum())
            pr[np.arange(len(j)), Y[j]] -= 1
            t += 1
            for w, g, mm, vv in zip(net.ps, net.bwd((pr / len(j)).astype(np.float32)), m, v):
                mm *= 0.9; mm += 0.1 * g; vv *= 0.999; vv += 0.001 * g * g
                w -= lr * (mm / (1 - 0.9 ** t)) / (np.sqrt(vv / (1 - 0.999 ** t)) + 1e-8)
        if ep % 5 == 0 or ep == EPOCHS:
            ok = int((net.fwd(vX).argmax(1) == vY).sum())
            print(f'Эпоха {ep}/{EPOCHS}: Loss = {loss / len(X):.4f}, Точность = {100 * ok / len(vX):.1f}% ({ok} из {len(vX)})', flush=True)

    if holdout:
        print('Режим проверки (--holdout): веса не записаны.'); return
    b64 = base64.b64encode(np.concatenate([w.astype('<f4').ravel() for w in net.ps]).tobytes()).decode()
    print(f'Размер весов: {len(b64)} символов base64 (~{len(b64) / 1024:.1f} КБ)')
    target = os.path.normpath(os.path.join(HERE, '..', 'src', 'lib', 'omr', 'digitWeights.generated.ts'))
    with open(target, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// Автоматически сгенерированные веса свёрточной сети цифр (14×14 → 3×3×%d → 2×2 → 3×3×%d → %d → %d)\n' % (C1, C2, FC, OUT))
        f.write('// Запуск сборщика: python scripts/train-digit-nn.py\n\n')
        f.write('export const DIGIT_NN_CONFIG = { c1: %d, c2: %d, fc: %d, out: %d } as const;\n' % (C1, C2, FC, OUT))
        f.write('export const DIGIT_NN_WEIGHTS_BASE64 = "%s";\n' % b64)
    print('Сохранено в ' + target)

if __name__ == '__main__':
    main()
