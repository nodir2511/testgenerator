import { describe, expect, it } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { omrRead } from '../src/lib/omr/recognize';
import { PIX, boxToPix, digitTo28, drawGlyph, pixFromBase64, pixToBase64, syntheticSamples } from '../src/lib/omr/digits';
import { DigitKnn, bootstrapKnn } from '../src/lib/omr/knn';
import { predictDigitNnPix } from '../src/lib/omr/digitNn';
import { guessOpen } from '../src/lib/omr/model';
import { render } from './omrRender';

describe('цифры из клеток', () => {
  it('рисунок 28×28: по центру, значения 0…1, пустая клетка — нули', () => {
    const v = digitTo28(drawGlyph('7', () => 0.5));
    expect(v.length).toBe(784);
    expect(Math.max(...v)).toBeLessThanOrEqual(1);
    let sx = 0, sy = 0, m = 0;
    v.forEach((x, i) => { sx += (i % 28) * x; sy += Math.floor(i / 28) * x; m += x; });
    expect(Math.abs(sx / m - 13.5)).toBeLessThan(1.2);
    expect(Math.abs(sy / m - 13.5)).toBeLessThan(1.2);
    expect(digitTo28({ cols: 10, rows: 10, bitmap: new Uint8Array(100) }).every((x) => x === 0)).toBe(true);
  });

  it('14×14 хранится и читается из base64 без потерь', () => {
    const px = boxToPix(drawGlyph('4', () => 0.3));
    expect(px.length).toBe(PIX * PIX);
    expect(pixToBase64(px).length).toBe(264);
    expect(Array.from(pixFromBase64(pixToBase64(px))!)).toEqual(Array.from(px));
    expect(pixFromBase64('AAAA')).toBeNull();
  });

  it('синтетика даёт по 24 примера каждой цифры и повторяется при том же seed', () => {
    const a = syntheticSamples(24, 7), b = syntheticSamples(24, 7);
    expect(a.length).toBe(240);
    expect(Array.from(a[5].px)).toEqual(Array.from(b[5].px));
  });

  it('kNN узнаёт цифры на новых искажённых рисунках', () => {
    const knn = bootstrapKnn();
    const test = syntheticSamples(30, 999); // другой seed — рисунки не совпадают с обучающими
    let ok = 0;
    for (const s of test) if (knn.predictPix(s.px)?.digit === s.d) ok++;
    expect(ok / test.length).toBeGreaterThan(0.95);
  });

  it('пустой классификатор ничего не отвечает; дубли и мусор в примерах не принимаются', () => {
    const k = new DigitKnn();
    expect(k.predictPix(new Uint8Array(PIX * PIX))).toBeNull();
    k.add([{ d: 12, px: new Uint8Array(PIX * PIX) }, { d: 3, px: new Uint8Array(5) }]);
    expect(k.size).toBe(0);
  });

  it('микро-нейросеть узнаёт цифры на синтетических примерах с высокой точностью', () => {
    const test = syntheticSamples(30, 888);
    let ok = 0;
    for (const s of test) {
      const pred = predictDigitNnPix(s.px);
      if (pred.digit === s.d) ok++;
    }
    expect(ok / test.length).toBeGreaterThan(0.96);
  });

  it('guessOpen выдаёт подсказки даже без kNN (на базе нейросети)', () => {
    const box = drawGlyph('5', () => 0.5);
    const openMock = {
      q: 1,
      boxes: [{ ink: 0.1, hasDigit: true, heightMm: 3.2, widthMm: 2.1, cols: 28, rows: 34, bitmap: box.bitmap }],
    };
    const hint = guessOpen(null, openMock);
    expect(hint).not.toBeNull();
    expect(hint?.text).toBe('5');
  });

  it('собранные примеры перевешивают: цифра в непривычном стиле узнаётся после добавления', () => {
    const knn = bootstrapKnn();
    // «Странная» единица: наклонная черта слева вниз — сначала не единица
    const odd = new Uint8Array(PIX * PIX);
    for (let i = 0; i < PIX; i++) { odd[i * PIX + Math.max(0, PIX - 1 - i)] = 255; odd[i * PIX + Math.max(0, PIX - 2 - i)] = 200; }
    const before = knn.predictPix(odd)!;
    knn.add(Array.from({ length: 6 }, () => ({ d: 1, px: odd })), true);
    const after = knn.predictPix(odd)!;
    expect(after.digit).toBe(1);
    expect(after.nearest).toBeLessThan(0.01);
    expect(knn.real).toBe(6);
    void before;
  });
});

describe('цифры по снимкам бланков (конвейер от фото до цифры)', () => {
  it('в узких клетках бланка таджикского (пять по 5,5 мм) цифры читаются не хуже', () => {
    const knn = bootstrapKnn();
    let total = 0, ok = 0;
    for (let s = 0; s < 6; s++) {
      const layout = OMR_LAYOUTS.taj;
      const { img, truth } = render(layout, 700 + s * 13, s % 2 ? 6 : -5, { glyphs: true });
      const res = omrRead(img, layout);
      expect(res.ok && res.codeOk).toBe(true);
      if (!res.ok) continue;
      res.open.forEach((o, qi) => {
        const want = truth.openText[qi];
        const boxes = o.boxes.filter((b) => b.hasDigit);
        expect(boxes.length).toBe(want.length);
        boxes.forEach((b, i) => { total++; if (knn.predictBox(b)!.digit === Number(want[i])) ok++; });
      });
    }
    expect(ok / total).toBeGreaterThan(0.9);
  }, 20000);

  it('на нарисованных бланках узнаются цифры в клетках, а ненадёжные помечаются', () => {
    const knn = bootstrapKnn();
    let total = 0, ok = 0, unsureWrong = 0, sureWrong = 0, unsure = 0;
    for (const id of ['chem', 'bio', 'chemphys']) {
      for (let s = 0; s < 6; s++) {
        const layout = OMR_LAYOUTS[id];
        const { img, truth } = render(layout, 500 + s * 13 + id.length, s % 2 ? 6 : -5, { glyphs: true });
        const res = omrRead(img, layout);
        expect(res.ok && res.codeOk).toBe(true);
        if (!res.ok) continue;
        res.open.forEach((o, qi) => {
          const want = truth.openText[qi];
          const boxes = o.boxes.filter((b) => b.hasDigit);
          expect(boxes.length).toBe(want.length);
          boxes.forEach((b, i) => {
            const g = knn.predictBox(b)!;
            total++;
            if (g.unsure) unsure++;
            if (g.digit === Number(want[i])) ok++;
            else if (g.unsure) unsureWrong++;
            else sureWrong++;
          });
        });
      }
    }
    expect(total).toBeGreaterThan(60);
    // Измерение конвейера на «идеальных» штрихах; на настоящем почерке результат будет ниже
    expect(ok / total).toBeGreaterThan(0.9);
    expect(sureWrong / total).toBeLessThan(0.05);
    void unsureWrong; void unsure;
  }, 30000);
});
