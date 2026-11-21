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

import { parseReleaseCommand, releaseSummary, releaseSummaryLines } from '../supabase/functions/_shared/releases';

describe('короткая сводка версии и команда /release', () => {
  const it1 = (kind: string, scope: 'site' | 'bot' | 'app') => ({ kind, scope, text: 't', min_rank: 1, subject_id: null });

  it('считает новое по месту, улучшения и исправления', () => {
    const lines = releaseSummary({ version: '1.0.0', title: 'A&B', items: [
      it1('new', 'site'), it1('new', 'bot'), it1('improved', 'site'), it1('fixed', 'site'), it1('fixed', 'app'),
    ] });
    expect(lines).toEqual([
      '<b>Версия 1.0.0</b> — A&amp;B', '🆕 Новое на сайте (1)', '🆕 Новое в боте (1)', '✨ Улучшения (1)', '🔧 Мелкие исправления (2)',
    ]);
  });

  it('пустая версия не даёт сводки, внизу подсказка с командой', () => {
    expect(releaseSummary({ version: '1', title: '', items: [] })).toEqual([]);
    const lines = releaseSummaryLines([
      { version: '1.0.0', title: '', items: [it1('fixed', 'site')] },
      { version: '0.9', title: '', items: [] },
    ]);
    expect(lines.at(-1)).toContain('/release 1.0.0');
  });

  it('понимает /release, /release@бот, «релиз» и номер с v', () => {
    expect(parseReleaseCommand('/release 1.0.0')).toEqual({ version: '1.0.0' });
    expect(parseReleaseCommand('/release@testgenerrepbot 1.0.0')).toEqual({ version: '1.0.0' });
    expect(parseReleaseCommand('релиз v1.2')).toEqual({ version: '1.2' });
    expect(parseReleaseCommand('/realise')).toEqual({ version: null });
    expect(parseReleaseCommand('/releases')).toBeNull();
    expect(parseReleaseCommand('Что нового')).toBeNull();
  });
});
