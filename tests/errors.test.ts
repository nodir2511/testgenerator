import { describe, expect, it } from 'vitest';
import { authErrorText, explainError, passwordErrorText } from '../src/lib/errors';

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

describe('authErrorText', () => {
  it('переводит частые ошибки входа', () => {
    expect(authErrorText({ message: 'Invalid login credentials' })).toMatch(/Неверная эл. почта или пароль/);
    expect(authErrorText({ message: 'Request rate limit reached', status: 429 })).toMatch(/Слишком много попыток/);
    expect(authErrorText(new TypeError('Failed to fetch'))).toMatch(/Нет связи/);
    expect(authErrorText({ message: 'Something odd' })).toMatch(/Не удалось войти/);
  });
});

describe('passwordErrorText', () => {
  it('переводит ошибки смены пароля', () => {
    expect(passwordErrorText({ message: 'New password should be different from the old password.' })).toMatch(/отличаться/);
    expect(passwordErrorText({ message: 'Password is known to be weak and easy to guess' })).toMatch(/слишком простой/);
    expect(passwordErrorText({ message: 'Password should be at least 6 characters.' })).toMatch(/длиннее/);
    expect(passwordErrorText({ message: 'boom' })).toMatch(/Не удалось сменить пароль/);
  });
});
