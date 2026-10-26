import { describe, expect, it } from 'vitest';
import { explainError } from '../src/lib/errors';

describe('explainError', () => {
  it('показывает русское сообщение как причину, без технических подробностей', () => {
    const e = explainError(new Error('Дневной лимит исчерпан: 5 генераций в сутки. Попробуйте завтра.'), 'Не удалось сгенерировать билеты');
    expect(e.reason).toBe('Дневной лимит исчерпан: 5 генераций в сутки. Попробуйте завтра.');
    expect(e.details).toBeUndefined();
  });

  it('технические ошибки по-прежнему объясняет и прячет текст в подробности', () => {
    const e = explainError(new Error('Failed to fetch'), 'Не удалось сгенерировать билеты');
    expect(e.reason).toContain('Нет связи');
    expect(e.details).toBe('Failed to fetch');
    expect(explainError(new Error('something odd')).details).toBe('something odd');
  });
});
