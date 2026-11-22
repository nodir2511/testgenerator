import { describe, it, expect } from 'vitest';
import {
  langName, needsRelaunchConfirm, RELAUNCH_WARNING, friendlyReviewError,
} from '../src/lib/examView';
import { reviewFailureKind } from '../src/exam/examLogic';

describe('язык билета', () => {
  it('подписи переключателя', () => {
    expect(langName('ru')).toBe('Русский');
    expect(langName('tg')).toBe('Тоҷикӣ');
    expect(langName(undefined)).toBe('Русский');
  });
});

describe('повторный запуск набора после рассылки разбора', () => {
  const links = [
    { batch_id: 'b1', review_sent_at: null },
    { batch_id: 'b2', review_sent_at: '2026-11-22T10:00:00Z' },
  ];
  it('предупреждает, только если у этого набора уже отправляли разбор', () => {
    expect(needsRelaunchConfirm(links, 'b2')).toBe(true);
    expect(needsRelaunchConfirm(links, 'b1')).toBe(false);
    expect(needsRelaunchConfirm(links, 'b3')).toBe(false);
    expect(needsRelaunchConfirm([], 'b1')).toBe(false);
    expect(needsRelaunchConfirm(undefined, 'b1')).toBe(false);
    expect(needsRelaunchConfirm(links, null)).toBe(false);
  });
  it('текст предупреждения', () => {
    expect(RELAUNCH_WARNING).toBe('Ответы этого набора уже отправлены другому классу. Запустить всё равно?');
  });
});

describe('friendlyReviewError', () => {
  it('«только что отправлен» (409) — спокойное сообщение, а не «сначала закройте»', () => {
    expect(friendlyReviewError('Разбор только что отправлен.', 409)).toBe('Разбор только что отправлен — повторно не отправляем. Подождите несколько секунд.');
  });
  it('409 «сначала закройте» и прочие', () => {
    expect(friendlyReviewError('Сначала закройте запуск: ...', 409)).toMatch(/Сначала закройте запуск/);
    expect(friendlyReviewError('x', 403)).toMatch(/Нет доступа/);
    expect(friendlyReviewError('Failed to send a request', undefined)).toMatch(/Нет связи/);
    expect(friendlyReviewError('что-то', 500)).toBe('что-то');
  });
});

describe('reviewFailureKind', () => {
  it('разбор не готов — показываем результат; сбой сети/сервера — «Повторить»; остальное — ошибка', () => {
    expect(reviewFailureKind({ status: 403, code: 'review_not_ready' })).toBe('not_ready');
    expect(reviewFailureKind({ status: 0, code: 'network' })).toBe('retry');
    expect(reviewFailureKind({ status: 503, code: 'error' })).toBe('retry');
    expect(reviewFailureKind({ status: 401, code: 'bad_init_data' })).toBe('error');
    expect(reviewFailureKind(new Error('x'))).toBe('error');
  });
});
