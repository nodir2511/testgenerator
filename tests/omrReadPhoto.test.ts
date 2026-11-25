import { describe, expect, it } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { CODE_TEXT, DECODE_TEXT, MANY_TEXT, EMPTY_FILE_TEXT, FAIL_TEXT, NOT_IMAGE_TEXT, OTHER_SUBJECT_TEXT, fileProblem, otherBlankText, readGray } from '../src/lib/omr/readPhoto';
import { MORE_TEXT, keyFromAnswers, answersFromResult, qualityWarnings, variantFromResult } from '../src/lib/omr/answers';
import type { GrayImage } from '../src/lib/omr/types';
import { BLANKS } from '../supabase/functions/_shared/omrScore';

import { render, renderPile } from './omrRender';

const ALL = Object.values(OMR_LAYOUTS);

// Эталонный бланк можно снять камерой или выбрать из галереи: оба фото идут через readGray.
describe('чтение фото бланка (камера и галерея)', () => {
  it('фото нужного бланка читается: ответы и вариант совпадают, из них собирается ключ', () => {
    const layout = OMR_LAYOUTS.chem;
    const { img, truth } = render(layout, 41, 5);
    const r = readGray(img, [layout], ALL);
    expect(r.error).toBeUndefined();
    if (!r.res) return;
    expect(variantFromResult(r.res)).toBe(truth.variant);
    const key = keyFromAnswers(answersFromResult(r.res), { test: 18, matching: 2, open: 7 });
    expect(key.tests).toEqual(truth.tests);
    expect(key.matching).toEqual(truth.matching.map((row) => row.map((v) => (v === null ? null : String(v)))));
  });

  it('свой бланк читается и при сверке со всеми видами', () => {
    for (const b of BLANKS) for (const id of b.layouts) {
      const { img } = render(OMR_LAYOUTS[id], 7, 4);
      expect(readGray(img, b.layouts.map((l) => OMR_LAYOUTS[l]), ALL).res, id).toBeDefined();
    }
  }, 60000);

  it('не бланк (нет угловых меток) — сообщение про метки, а не случайные ответы', () => {
    const img: GrayImage = { w: 800, h: 500, data: new Uint8Array(800 * 500).fill(180) };
    const r = readGray(img, [OMR_LAYOUTS.chem], ALL);
    expect(r.res).toBeUndefined();
    expect(r.error).toBe(FAIL_TEXT);
    expect(r.layout?.id).toBe('chem');
  });

  it('бланк другого предмета (заданий столько же, код другой): со сверкой — точное сообщение', () => {
    const { img } = render(OMR_LAYOUTS.chem, 5, 4);
    const plain = readGray(img, [OMR_LAYOUTS.phys]);
    expect(plain.res).toBeUndefined();
    expect(plain.error).toBeTruthy();
    const r = readGray(img, [OMR_LAYOUTS.phys], ALL);
    expect(r.res).toBeUndefined();
    expect(r.error).toBe(OTHER_SUBJECT_TEXT);
    expect(r.layout?.id).toBe('phys');
  });

  it('целый бланк другого вида называется прямо, а не «не виден угол»', () => {
    for (const b of BLANKS) {
      const wanted = b.layouts.map((id) => OMR_LAYOUTS[id]);
      for (const id of Object.keys(OMR_LAYOUTS)) {
        if (b.layouts.includes(id)) continue;
        for (const deg of [3, 177]) {
          const { img } = render(OMR_LAYOUTS[id], 11, deg);
          const r = readGray(img, wanted, ALL);
          const tag = `${b.layouts.join('+')} <- ${id}, ${deg}°`;
          expect(r.res, tag).toBeUndefined();
          expect(r.error, tag).toBe(otherBlankText(OMR_LAYOUTS[id], wanted[0]));
          expect(r.error, tag).toMatch(/^На фото бланк другого вида \(тестов: \d+, соответствий: \d+, открытых: \d+\), а нужен бланк на \d+ заданий/);
          expect(r.error, tag).not.toMatch(/угол/);
        }
      }
    }
  }, 120000);

  it('текст про другой вид: состав найденного и нужного бланка', () => {
    expect(otherBlankText(OMR_LAYOUTS.bio, OMR_LAYOUTS.chem)).toBe('На фото бланк другого вида (тестов: 20, соответствий: 4, открытых: 2), а нужен бланк на 27 заданий (тестов: 18, соответствий: 2, открытых: 7). Возьмите нужный бланк.');
    expect(otherBlankText(OMR_LAYOUTS.taj, OMR_LAYOUTS.bio)).toBe(OTHER_SUBJECT_TEXT);
  });

  it('метки есть, но код бланка не читается ни как один из видов — общее сообщение про вид бланка', () => {
    const layout = OMR_LAYOUTS.chem;
    const { img } = render(layout, 9, 0);
    const data = Float32Array.from(img.data as ArrayLike<number>);
    // Закрашиваем все квадратики кода: такого кода нет ни у одного бланка
    for (const c of layout.codeCells) {
      const cx = img.w / 2 + (c.x - layout.strip.w / 2) * 6, cy = img.h / 2 + (c.y - layout.strip.h / 2) * 6;
      for (let y = Math.round(cy - 9); y < cy + 9; y++) for (let x = Math.round(cx - 9); x < cx + 9; x++) data[y * img.w + x] = 15;
    }
    const r = readGray({ w: img.w, h: img.h, data }, [layout, OMR_LAYOUTS.phys], ALL);
    expect(r.res).toBeUndefined();
    expect(r.error).toBeTruthy();
    expect(r.error).not.toMatch(/другого вида|другого предмета/);
  });

  it('угол бланка не попал в кадр — говорится, какой именно', () => {
    const layout = OMR_LAYOUTS.chem;
    const { img } = render(layout, 123, 0);
    const data = Float32Array.from(img.data as ArrayLike<number>);
    const m = layout.markers[3];
    const cx = img.w / 2 + (m.x - layout.strip.w / 2) * 6, cy = img.h / 2 + (m.y - layout.strip.h / 2) * 6;
    for (let y = Math.round(cy - 25); y < cy + 25; y++) for (let x = Math.round(cx - 25); x < cx + 25; x++) data[y * img.w + x] = 230;
    const r = readGray({ w: img.w, h: img.h, data }, [layout], ALL);
    expect(r.res).toBeUndefined();
    expect(r.error).toMatch(/нижний правый|правый нижний/i);
  });

  it('состав с двумя раскладками (биология и таджикский): раскладка выбирается по коду бланка', () => {
    const pair = [OMR_LAYOUTS.bio, OMR_LAYOUTS.taj];
    for (const id of ['taj', 'bio'] as const) {
      const { img } = render(OMR_LAYOUTS[id], 5, 2);
      const r = readGray(img, pair, ALL);
      expect(r.error, id).toBeUndefined();
      expect(r.res?.open.map((o) => o.boxes.length), id).toEqual(id === 'taj' ? [5, 5] : [4, 4]);
    }
  });
});

// Преподаватели снимают несколько бланков одним кадром (4 снимка химии/физики, 11 бланков): бот молча брал один из
// 2–4, остальные работы терялись, либо отказывал с непонятной причиной.
describe('несколько бланков на одном фото', () => {
  const layout = OMR_LAYOUTS.chemphys;

  for (const degs of [[2, -2], [4, -5]]) {
    it(`один прочитан, рядом есть ещё (наклон ${degs.join('°, ')}°): предупреждение, ответы — одного из бланков целиком`, () => {
      const { img, truths } = renderPile(layout, 9, degs);
      const r = readGray(img, [layout], ALL);
      expect(r.error).toBeUndefined();
      if (!r.res) return;
      expect(r.res.more).toBe(true);
      expect(qualityWarnings(r.res)).toContain(MORE_TEXT);
      expect(truths.map((t) => t.tests)).toContainEqual(r.res.tests.map((x) => x.answer));
    });
  }

  it('четыре бланка: отказ называет причину либо один прочитан с предупреждением', () => {
    const { img, truths } = renderPile(layout, 9, [2, -2, 1, -1]);
    const r = readGray(img, [layout], ALL);
    // либо отказ с причиной, либо один бланк прочитан целиком и с предупреждением — но не молча
    if (!r.res) { expect(r.error).toBe(MANY_TEXT); return; }
    expect(r.res.more).toBe(true);
    expect(truths.map((t) => t.tests)).toContainEqual(r.res.tests.map((x) => x.answer));
  });

  it('один бланк — предупреждения нет, ни у одного вида', () => {
    for (const b of BLANKS) for (const id of b.layouts) {
      const { img } = render(OMR_LAYOUTS[id], 7, 4);
      const r = readGray(img, b.layouts.map((l) => OMR_LAYOUTS[l]), ALL);
      expect(r.res, id).toBeDefined();
      expect(r.res?.more, id).toBeUndefined();
    }
  }, 60000);

  it('соседний бланк виден не целиком — предупреждения нет', () => {
    const { img } = renderPile(layout, 9, [2, -2]);
    // нижний бланк срезан краем кадра: его нижних меток не видно
    const h = Math.round(img.h * 0.72);
    const r = readGray({ w: img.w, h, data: (img.data as Float32Array).subarray(0, img.w * h) }, [layout], ALL);
    expect(r.res).toBeDefined();
    expect(r.res?.more).toBeUndefined();
  });
});

describe('проверка выбранного файла до распознавания', () => {
  it('картинки пропускаются, в том числе с неизвестным типом (решит попытка открыть)', () => {
    expect(fileProblem({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(fileProblem({ type: 'IMAGE/HEIC', size: 1000 })).toBeNull();
    expect(fileProblem({ type: '', size: 1000 })).toBeNull();
    expect(fileProblem({ size: 1000 })).toBeNull();
  });

  it('не картинка и пустой файл — понятная причина', () => {
    expect(fileProblem({ type: 'application/pdf', size: 1000 })).toBe(NOT_IMAGE_TEXT);
    expect(fileProblem({ type: 'video/mp4', size: 1000 })).toBe(NOT_IMAGE_TEXT);
    expect(fileProblem({ type: 'image/jpeg', size: 0 })).toBe(EMPTY_FILE_TEXT);
  });

  it('тексты отказов разные и не пустые', () => {
    const all = [FAIL_TEXT, CODE_TEXT, MANY_TEXT, OTHER_SUBJECT_TEXT, NOT_IMAGE_TEXT, EMPTY_FILE_TEXT, DECODE_TEXT];
    expect(new Set(all).size).toBe(all.length);
    for (const t of all) expect(t.length).toBeGreaterThan(10);
  });
});
