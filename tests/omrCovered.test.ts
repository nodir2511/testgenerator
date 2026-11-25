import { describe, expect, it, vi } from 'vitest';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import { omrRead } from '../src/lib/omr/recognize';

import { render } from './omrRender';

const ids = Object.keys(OMR_LAYOUTS);

// Отдельный файл: vitest выполняет файлы параллельно, а эти тесты — самые долгие из распознавания
vi.setConfig({ testTimeout: 60000 });

describe('распознавание бланка по снимку: метка закрыта', () => {
  // Закрытая пальцем или бликом метка: раньше четвёрка из закрашенных кружков иногда «проходила» код бланка,
  // и ответы читались со сдвигом. Теперь такой снимок либо отклоняется, либо читается верно — но не неверно.
  // Отдельный тест на каждый бланк: все 72 снимка в одном тесте не укладывались в лимит времени на сервере сборки.
  it.each(ids)('%s: метка закрыта — снимок отклоняется или читается верно, белиберды нет', (id) => {
    let wrong = 0;
    for (let s = 0; s < 12; s++) {
      const layout = OMR_LAYOUTS[id];
      const deg = [0, 4, -5, 180][s % 4];
      const { img, truth } = render(layout, 3000 + s * 13 + id.length, deg);
      const data = Float32Array.from(img.data as ArrayLike<number>);
      const m = layout.markers[s % 4], a = (deg * Math.PI) / 180;
      const dx = (m.x - layout.strip.w / 2) * 6, dy = (m.y - layout.strip.h / 2) * 6;
      const cx = img.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), cy = img.h / 2 + dx * Math.sin(a) + dy * Math.cos(a);
      for (let y = Math.round(cy - 25); y < cy + 25; y++) for (let x = Math.round(cx - 25); x < cx + 25; x++) data[y * img.w + x] = 230;
      const res = omrRead({ w: img.w, h: img.h, data }, layout);
      if (!res.ok || !res.codeOk) continue;
      if (res.variant.answer !== truth.variant || JSON.stringify(res.tests.map((t) => t.answer)) !== JSON.stringify(truth.tests)) wrong++;
    }
    expect(wrong).toBe(0);
  });
});
