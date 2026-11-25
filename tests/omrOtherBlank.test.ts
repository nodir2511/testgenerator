import { describe, expect, it } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { otherBlankText, readGray } from '../src/lib/omr/readPhoto';
import { BLANKS } from '../supabase/functions/_shared/omrScore';

import { render } from './omrRender';

const ALL = Object.values(OMR_LAYOUTS);

describe('чтение фото бланка: на фото бланк другого вида', () => {
  // Отдельный тест на каждый вид бланка и отдельный файл: вместе они шли дольше минуты
  for (const b of BLANKS) {
    it(`${b.layouts.join('+')}: целый бланк другого вида называется прямо, а не «не виден угол»`, () => {
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
    }, 120000);
  }
});
