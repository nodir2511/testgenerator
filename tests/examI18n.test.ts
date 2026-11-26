import { describe, it, expect } from 'vitest';
import { examErrorText, examTexts, type ExamTexts } from '../src/exam/i18n';
import { lobbyMinutesText, lobbyWaitText, waitText } from '../src/exam/examLogic';

const ru = examTexts('ru');
const tg = examTexts('tg');

/** Значение текста для сравнения: функции вызываем с одними и теми же числами */
const sample = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'function') return String((v as (...a: unknown[]) => unknown)(3, 7, 2));
  return '';
};
const keys = (t: ExamTexts) => Object.keys(t).filter((k) => k !== 'errors').sort();

describe('страница ученика: язык интерфейса', () => {
  it('русский — по умолчанию и для неизвестного языка', () => {
    expect(examTexts(undefined)).toBe(ru);
    expect(examTexts(null)).toBe(ru);
    expect(examTexts('en' as never)).toBe(ru);
    expect(tg).not.toBe(ru);
  });

  it('в обоих языках одни и те же тексты, пустых нет', () => {
    expect(keys(tg)).toEqual(keys(ru));
    for (const k of keys(ru)) {
      expect(sample((ru as never)[k]).trim(), `ru.${k}`).not.toBe('');
      expect(sample((tg as never)[k]).trim(), `tg.${k}`).not.toBe('');
    }
  });

  it('таджикский текст не остался русским (кроме слов, одинаковых в обоих языках)', () => {
    const same = new Set(['ticket', 'namePlaceholder']); // «Билет»; пример имени отличается только первым словом
    for (const k of keys(ru)) {
      if (same.has(k)) continue;
      expect(sample((tg as never)[k]), k).not.toBe(sample((ru as never)[k]));
    }
    expect(tg.namePlaceholder).toBe('Масалан, Расулов Алишер');
  });

  it('числа подставляются в оба языка', () => {
    expect(ru.progress(3, 20, 2)).toBe('Вопрос 3 из 20 · отвечено 2');
    expect(tg.progress(3, 20, 2)).toBe('Саволи 3 аз 20 · ҷавоб дода шуд: 2');
    expect(ru.confirmTitle(0)).toBe('Сдать билет?');
    expect(ru.confirmTitle(4)).toBe('Не отвечено: 4. Сдать?');
    expect(tg.confirmTitle(0)).toBe('Билетро месупоред?');
    expect(tg.confirmTitle(4)).toBe('Бе ҷавоб: 4. Месупоред?');
    expect(ru.confirmHint(16, 20, 4)).toBe('Отвечено 16 из 20. Вопросы без ответа получат 0 баллов. После сдачи изменить ответы нельзя.');
    expect(ru.confirmHint(20, 20, 0)).toBe('Отвечено 20 из 20. После сдачи изменить ответы нельзя.');
    expect(tg.confirmHint(20, 20, 0)).toBe('Ҷавоб дода шуд: 20 аз 20. Пас аз супоридан ҷавобҳоро иваз кардан мумкин нест.');
    expect(ru.score(31, 40)).toBe('Вы набрали 31 из 40');
    expect(tg.score(31, 40)).toBe('Шумо 31 аз 40 гирифтед');
    expect(ru.reviewTitle('')).toBe('Разбор');
    expect(tg.reviewTitle('Химия')).toBe('Шарҳ: Химия');
  });

  it('предупреждение об уходе со страницы — на языке билета', () => {
    expect(ru.away(1)).toBe('Вы уходили со страницы билета: 1 раз. Преподаватель это видит.');
    expect(ru.away(3)).toBe('Вы уходили со страницы билета: 3 раза. Преподаватель это видит.');
    expect(tg.away(3)).toBe('Шумо аз саҳифаи билет баромадед: 3 маротиба. Омӯзгор инро мебинад.');
    expect(ru.awayRule(3, 10)).toBe('Не выходите из билета: после 3 выходов или 10 секунд вне страницы билет закроется сам.');
    expect(ru.awayUsed(1, 3, 4, 10)).toBe('Выходов: 1 из 3 · вне страницы: 4 из 10 с. Преподаватель это видит.');
    expect(ru.copyBlocked(2)).toBe('Копировать текст билета нельзя. Попытка записана (2 раза) — преподаватель это видит.');
    expect(tg.awayRule(3, 10)).toContain('3 баромад');
  });

  it('зал ожидания: подписи на языке билета, без языка — по-русски', () => {
    expect(lobbyWaitText({ kind: 'waiting' })).toBe('Ждите, преподаватель начнёт сессию');
    expect(lobbyWaitText({ kind: 'waiting' }, 'tg')).toBe(tg.waitTeacher);
    expect(lobbyWaitText({ kind: 'soon' }, 'tg')).toBe(tg.soon);
    expect(lobbyWaitText({ kind: 'countdown', digit: 2 }, 'tg')).toBe(tg.starting);
    expect(waitText({ state: 'countdown' }, 'tg')).toBe(tg.starting);
    expect(lobbyMinutesText({ minutes: 30 }, 'tg')).toBe('Вақт: 30 дақиқа');
    expect(lobbyMinutesText({ minutes: null }, 'tg')).toBe('');
  });
});

describe('страница ученика: текст ошибки на языке билета', () => {
  const err = (code: string, message = 'Текст сервера') => ({ code, message, status: 400 });
  it('русский: текст сервера как есть', () => {
    expect(examErrorText(err('bad_name', 'Введите фамилию и имя (от 2 до 80 знаков).'), 'ru')).toBe('Введите фамилию и имя (от 2 до 80 знаков).');
    expect(examErrorText(err('network', 'Нет связи с сервером. Проверьте интернет.'), undefined)).toBe('Нет связи с сервером. Проверьте интернет.');
  });
  it('таджикский: текст по коду ошибки, а не русский текст сервера', () => {
    expect(examErrorText(err('bad_name'), 'tg')).toBe(tg.errors.bad_name);
    expect(examErrorText(err('network'), 'tg')).toBe(tg.errors.network);
    expect(examErrorText(err('session_not_started'), 'tg')).toBe(tg.errors.session_not_started);
  });
  it('таджикский: неизвестный код — общий таджикский текст, не русский', () => {
    expect(examErrorText(err('error', 'Внутренняя ошибка. Попробуйте ещё раз.'), 'tg')).toBe(tg.errorFallback);
  });
  it('не ошибка сервера (без кода) — общий текст', () => {
    expect(examErrorText(new Error('boom'), 'ru')).toBe(ru.errorFallback);
    expect(examErrorText(null, 'tg')).toBe(tg.errorFallback);
  });
  it('все коды ошибок действия ученика tg-exam переведены', () => {
    for (const code of ['network', 'bad_init_data', 'bad_code', 'not_found', 'bad_name', 'no_tickets', 'start_failed', 'bad_question', 'bad_answer', 'not_started', 'session_not_started', 'review_not_ready']) {
      expect(tg.errors[code], code).toBeTruthy();
    }
  });
});
