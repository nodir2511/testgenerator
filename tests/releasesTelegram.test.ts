import { describe, it, expect } from 'vitest';
import { chunkLines, itemVisible, rankOf, releaseLines } from '../supabase/functions/_shared/releases';

describe('рассылка обновлений в Telegram', () => {
  it('уровень роли совпадает с сайтом', () => {
    expect(rankOf('admin', true)).toBe(4);
    expect(rankOf('admin', false)).toBe(3);
    expect(rankOf('subject_admin', false)).toBe(2);
    expect(rankOf('teacher', false)).toBe(1);
    expect(rankOf(null, null)).toBe(1);
  });

  it('пункт виден только с достаточным уровнем и доступным предметом', () => {
    expect(itemVisible({ min_rank: 3, subject_id: null }, 2, null)).toBe(false);
    expect(itemVisible({ min_rank: 1, subject_id: null }, 1, ['a'])).toBe(true);
    expect(itemVisible({ min_rank: 1, subject_id: 'x' }, 1, ['a'])).toBe(false);
    expect(itemVisible({ min_rank: 1, subject_id: 'x' }, 1, null)).toBe(true);
  });

  it('группирует пункты по месту изменения и экранирует HTML', () => {
    const lines = releaseLines([{ version: '1.0', title: 'A<B', items: [
      { kind: 'new', scope: 'bot', text: 'бот', min_rank: 1, subject_id: null },
      { kind: 'new', scope: 'site', text: 'сайт & форма', min_rank: 1, subject_id: null },
    ] }]);
    expect(lines).toEqual(['<b>Версия 1.0</b> — A&lt;B', '<i>🌐 Сайт</i>', '• сайт &amp; форма', '<i>🤖 Чат-бот</i>', '• бот']);
  });

  it('при одном месте изменения заголовок группы не нужен, пустые версии пропускаются', () => {
    const lines = releaseLines([
      { version: '2', title: '', items: [] },
      { version: '1', title: '', items: [{ kind: 'new', scope: 'site', text: 'x', min_rank: 1, subject_id: null }] },
    ]);
    expect(lines).toEqual(['<b>Версия 1</b>', '• x']);
  });

  it('делит длинный текст на сообщения', () => {
    const chunks = chunkLines(['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)], 100);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });
});
