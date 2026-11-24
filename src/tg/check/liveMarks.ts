// Кружочки поверх живой камеры: верно, сомнительно, неверно (чистая логика, проверяется тестами).
import type { TicketKey } from '../../../supabase/functions/_shared/omrScore';
import { scoreAnswers } from '../../../supabase/functions/_shared/omrScore';
import { answersFromResult, variantFromResult } from '../../lib/omr/answers';
import type { OpenHint } from '../../lib/omr/model';
import { applyH } from '../../lib/omr/recognize';
import type { OmrCircle, OmrLayout, Picked } from '../../lib/omr/types';
import { matchId, testId, type CellId, type Ok } from './logic';

/** ok — верно, warn — сомнительно, bad — неверно, read — прочитано, но сверять не с чем */
export type MarkTone = 'ok' | 'warn' | 'bad' | 'read';
/** Отметка в миллиметрах бланка: кружок (round) или рамка вокруг клеток открытого вопроса */
export interface LiveMark { id: CellId; tone: MarkTone; round: boolean; x: number; y: number; w: number; h: number }
export interface LiveResult {
  marks: LiveMark[];
  /** Сколько ответов каждого цвета (вариант не в счёт). Пустые ответы не показываются */
  counts: Record<MarkTone, number>;
  variant: number | null;
  /** Почему нельзя сверить с ключом; null — сверено (или ключа пока и не должно быть) */
  problem: string | null;
}

const circleOf = (id: CellId, tone: MarkTone, o: OmrCircle): LiveMark => ({ id, tone, round: true, x: o.x - o.d / 2, y: o.y - o.d / 2, w: o.d, h: o.d });

/** keys не передан — снимают эталон, сверять ещё не с чем. Баллы считает та же scoreAnswers, что и проверка */
export function liveMarks(res: Ok, layout: OmrLayout, keys: Record<number, TicketKey> | undefined, hints: Array<OpenHint | null>): LiveResult {
  const marks: LiveMark[] = [];
  const counts: Record<MarkTone, number> = { ok: 0, warn: 0, bad: 0, read: 0 };
  const variant = variantFromResult(res);
  const key = keys && variant !== null ? keys[variant] : undefined;
  const answers = answersFromResult(res);
  answers.open = answers.open.map((_, i) => hints[i]?.text ?? '');
  const score = key ? scoreAnswers(key, answers) : null;
  const judge = (known: boolean, right: boolean | undefined): MarkTone => (score && known ? (right ? 'ok' : 'bad') : 'read');

  const put = (id: CellId, options: OmrCircle[], p: Picked, sure: MarkTone, counted = true) => {
    if (p.answer === null) return;
    const tone = p.answer === 'multi' || p.unsure ? 'warn' : sure;
    // Отмечено несколько — обводим каждую отметку
    const chosen = p.answer === 'multi' ? p.candidates ?? [] : [p.answer];
    for (const o of options) if (chosen.some((c) => String(c) === String(o.value))) marks.push(circleOf(id, tone, o));
    if (counted) counts[tone]++;
  };

  put('v', layout.variant, res.variant, keys && variant !== null ? (key ? 'ok' : 'bad') : 'read', false);
  res.tests.forEach((t, i) => put(testId(i), layout.tests[i].options, t, judge(key?.tests[i] != null, score?.tests[i])));
  res.matching.forEach((m, i) => m.rows.forEach((r, j) => put(matchId(i, j), layout.matching[i].rows[j].options, r, judge(key?.matching[i]?.[j] != null, score?.matching[i]?.[j]))));
  res.open.forEach((_, i) => {
    const h = hints[i];
    if (!h) return;
    const tone = h.unsure ? 'warn' : judge(!!key?.open[i], score?.open[i]);
    const b = layout.open[i].boxes;
    const x = Math.min(...b.map((c) => c.x)), y = Math.min(...b.map((c) => c.y));
    marks.push({ id: `o${i}`, tone, round: false, x, y, w: Math.max(...b.map((c) => c.x + c.w)) - x, h: Math.max(...b.map((c) => c.y + c.h)) - y });
    counts[tone]++;
  });

  const problem = !keys || key ? null
    : res.variant.answer === 'multi' ? 'Отмечено несколько вариантов'
      : variant === null ? 'Вариант не отмечен' : `Для варианта ${variant} нет ключа`;
  return { marks, counts, variant, problem };
}

/** Кадр камеры → экран, как у object-fit: cover */
export interface ScreenMap { k: number; dx: number; dy: number }
export function coverMap(frameW: number, frameH: number, screenW: number, screenH: number): ScreenMap {
  const k = Math.max(screenW / frameW, screenH / frameH);
  return { k, dx: (screenW - frameW * k) / 2, dy: (screenH - frameH * k) / 2 };
}

/** Контур отметки на экране с учётом наклона бланка; pad — отступ в миллиметрах, чтобы не закрывать саму отметку */
export function markPolygon(m: LiveMark, toPhoto: number[], map: ScreenMap, pad = 0): Array<[number, number]> {
  const cx = m.x + m.w / 2, cy = m.y + m.h / 2, rx = m.w / 2 + pad, ry = m.h / 2 + pad;
  const mm: Array<[number, number]> = m.round
    ? Array.from({ length: 24 }, (_, i) => [cx + rx * Math.cos((i / 12) * Math.PI), cy + ry * Math.sin((i / 12) * Math.PI)])
    : [[cx - rx, cy - ry], [cx + rx, cy - ry], [cx + rx, cy + ry], [cx - rx, cy + ry]];
  return mm.map(([x, y]) => { const [a, b] = applyH(toPhoto, x, y); return [a * map.k + map.dx, b * map.k + map.dy]; });
}
