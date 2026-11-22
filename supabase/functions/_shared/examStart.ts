// Бот: ссылка ученика /start exam_КОД. Чистые помощники (тексты, срок ссылки, ограничитель перебора кодов).
// Подключает только exam.ts (он без импортов): Edge Function telegram-bot и тесты.

import { tgPlain } from './exam.ts';

export const EXAM_CLOSED_TEXT = 'Билет по этой ссылке закрыт. Спросите новую ссылку у преподавателя.';
export const EXAM_TOO_MANY_TEXT = 'Слишком много попыток. Подождите несколько минут.';

/** Ссылка закрыта: нет такой, закрыта преподавателем или истекла. Для ученика все три случая выглядят одинаково. */
export function examLinkClosed(link: { closed_at: string | null; closes_at: string | null } | null | undefined, now: Date): boolean {
  if (!link) return true;
  if (link.closed_at) return true;
  return !!link.closes_at && new Date(link.closes_at).getTime() <= now.getTime();
}

/** Текст сообщения (parse_mode HTML): название набора проходит через tgPlain (разметка сайта → текст, «<», «>», «&» экранированы). */
export function examStartText(title: string | null | undefined): string {
  const t = tgPlain(String(title ?? '')).trim();
  return `📝 Билет${t ? `: ${t}` : ''}. Нажмите «Войти в билет» и ждите: время назначит преподаватель, попытка одна.`;
}

/**
 * Ограничитель перебора кодов: считает только промахи (неизвестный или закрытый код) на одного пользователя Telegram
 * в скользящем окне. Хранится в памяти экземпляра функции — это защита «по возможности», не строгая.
 */
export function createMissLimiter(max: number, windowMs: number) {
  const hits = new Map<number, number[]>();
  const fresh = (id: number, now: number) => {
    const list = (hits.get(id) ?? []).filter((t) => now - t < windowMs);
    if (list.length) hits.set(id, list); else hits.delete(id);
    return list;
  };
  const sweep = (now: number) => {
    for (const id of [...hits.keys()]) fresh(id, now);
  };
  return {
    blocked(id: number, now: number = Date.now()): boolean {
      if (hits.size > 200) sweep(now);
      return fresh(id, now).length >= max;
    },
    miss(id: number, now: number = Date.now()): void {
      const list = fresh(id, now);
      list.push(now);
      hits.set(id, list);
    },
    size: () => hits.size,
  };
}
