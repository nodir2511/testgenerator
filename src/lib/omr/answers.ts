// Перевод результата распознавания в ответы ученика и в ключ (для «ключа по сканированию бланка»).
import type { Answers, Composition, TicketKey } from '../../../supabase/functions/_shared/omrScore';
import type { OmrResult, Picked } from './types';

type Ok = Extract<OmrResult, { ok: true }>;

const asText = (p: Picked): string | null => (p.answer === null || p.answer === 'multi' ? null : String(p.answer));

/** Ответы по распознанному снимку. Цифры открытых вопросов в клетках не читаются — их вводит проверяющий. */
export function answersFromResult(res: Ok): Answers {
  return {
    tests: res.tests.map(asText),
    matching: res.matching.map((m) => m.rows.map(asText)),
    open: res.open.map(() => ''),
  };
}

/** Клетки, которым распознавание не доверяет: «несколько отметок», неуверенные и пустые тесты */
export interface Doubt { kind: 'test' | 'matching' | 'open' | 'variant'; q: number; row?: string; why: 'multi' | 'unsure' | 'empty' | 'digit' }

export function doubts(res: Ok): Doubt[] {
  const out: Doubt[] = [];
  const check = (p: Picked, d: Omit<Doubt, 'why'>) => {
    if (p.answer === 'multi') out.push({ ...d, why: 'multi' });
    else if (p.answer === null) out.push({ ...d, why: 'empty' });
    else if (p.unsure) out.push({ ...d, why: 'unsure' });
  };
  check(res.variant, { kind: 'variant', q: 0 });
  for (const t of res.tests) check(t, { kind: 'test', q: t.q });
  for (const m of res.matching) for (const r of m.rows) check(r, { kind: 'matching', q: m.q, row: r.row });
  return out;
}

/** Ключ по эталонному бланку: пустые ответы остаются null и в проверке не засчитываются */
export function keyFromAnswers(a: Answers, comp: Composition): TicketKey {
  return {
    tests: a.tests.slice(0, comp.test),
    matching: a.matching.slice(0, comp.matching),
    open: a.open.slice(0, comp.open).map((x) => (x.trim() === '' ? null : x.trim())),
  };
}

/** Номер варианта, отмеченный на бланке (1–4), либо null, если не отмечен или отмечено несколько */
export function variantFromResult(res: Ok): number | null {
  return typeof res.variant.answer === 'number' ? res.variant.answer : null;
}

export const MORE_TEXT = 'На фото несколько бланков, прочитан только один. Остальные снимите отдельно, по одному в кадре.';

/** Предупреждения о снимке: что мешает прочитать надёжно (пустой список — всё хорошо) */
export function qualityWarnings(res: Ok): string[] {
  const out: string[] = [];
  if (res.more) out.push(MORE_TEXT);
  if (res.quality.pxPerMm < 4) out.push('Бланк снят слишком далеко или в низком разрешении: приблизьте камеру так, чтобы бланк занял весь кадр.');
  if (res.quality.skew > 1.25) out.push('Бланк снят под сильным углом: держите телефон прямо над бланком.');
  const picks: Picked[] = [res.variant, ...res.tests, ...res.matching.flatMap((m) => m.rows)];
  const bad = picks.filter((p) => p.answer === 'multi' || p.unsure).length;
  if (bad >= 3 && bad / picks.length > 0.08) out.push(`Много неясных отметок (${bad}): возможны блики, тень или смятая бумага. Переснимите при ровном свете, без бликов.`);
  return out;
}
