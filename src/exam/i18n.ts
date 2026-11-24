// Тексты страницы ученика /tg/exam на языке билета: русский или таджикский.
// Язык выбирает ученик на экране ввода имени; до выбора (загрузка, «откройте в Telegram») страница русская.
// Вопросы и варианты сюда не относятся: они приходят с сервера уже на языке попытки.
import { timesRu } from '../lib/examView';
import type { Lang } from './examLogic';

export interface ExamTexts {
  ticket: string;
  retry: string;
  backToResult: string;
  genericFail: string;
  // вход
  hintWaiting: string;
  hintRunning: (minutes: number) => string;
  nameLabel: string;
  namePlaceholder: string;
  langLabel: string;
  enter: string;
  entering: string;
  // зал ожидания
  yourVariant: string;
  waitTeacher: string;
  soon: string;
  starting: string;
  minutes: (n: number) => string;
  offline: string;
  // билет
  progress: (pos: number, total: number, answered: number) => string;
  unsavedCount: (n: number) => string;
  saving: string;
  saveFailed: string;
  saved: string;
  questionAria: (n: number) => string;
  back: string;
  next: string;
  submit: string;
  confirmTitle: (unanswered: number) => string;
  confirmHint: (answered: number, total: number, unanswered: number) => string;
  confirmYes: string;
  submitting: string;
  confirmBack: string;
  submitFailed: string;
  sessionExpired: string;
  away: (count: number) => string;
  emptyPlace: string;
  openAria: string;
  digitAria: (n: number) => string;
  // результат и разбор
  done: string;
  score: (score: number, max: number) => string;
  viewReview: string;
  reviewLater: string;
  reviewNotSent: string;
  reviewLoadFailed: string;
  reviewUnavailable: string;
  reviewTitle: (title: string) => string;
  noMistakes: string;
  points: (points: number, max: number) => string;
  correct: string;
  yours: string;
  notAnswered: string;
  yourAnswer: string;
  rightShort: string;
  rightAnswer: string;
  closedTitle: string;
  closedText: string;
  /** Ошибки сервера и связи по коду (ExamApiError.code); кода нет в списке — errorFallback */
  errors: Record<string, string>;
  errorFallback: string;
}

const ru: ExamTexts = {
  ticket: 'Билет',
  retry: 'Повторить',
  backToResult: 'Назад к результату',
  genericFail: 'Что-то пошло не так. Повторите.',
  hintWaiting: 'Время назначит преподаватель, попытка одна.',
  hintRunning: (m) => `Сессия уже идёт, осталось ${m} мин. Попытка одна.`,
  nameLabel: 'Фамилия и имя',
  namePlaceholder: 'Например, Расулов Алишер',
  langLabel: 'Язык билета',
  enter: 'Войти',
  entering: 'Входим…',
  yourVariant: 'Ваш вариант',
  waitTeacher: 'Ждите, преподаватель начнёт сессию',
  soon: 'Скоро начнём…',
  starting: 'Начинаем!',
  minutes: (n) => `Время: ${n} мин`,
  offline: 'Нет связи, пробуем снова…',
  progress: (p, t, a) => `Вопрос ${p} из ${t} · отвечено ${a}`,
  unsavedCount: (n) => `не сохранено: ${n}`,
  saving: 'сохраняем…',
  saveFailed: 'не сохранено — повторяем отправку…',
  saved: '✓ сохранено',
  questionAria: (n) => `Вопрос ${n}`,
  back: 'Назад',
  next: 'Далее',
  submit: 'Сдать',
  confirmTitle: (u) => (u > 0 ? `Не отвечено: ${u}. Сдать?` : 'Сдать билет?'),
  confirmHint: (a, t, u) => `Отвечено ${a} из ${t}.${u > 0 ? ' Вопросы без ответа получат 0 баллов.' : ''} После сдачи изменить ответы нельзя.`,
  confirmYes: 'Да, сдать',
  submitting: 'Сдаём…',
  confirmBack: 'Вернуться к билету',
  submitFailed: 'Не удалось сдать билет. Повторите.',
  sessionExpired: 'Сессия Telegram устарела: ответ не сохранён. Закройте страницу и откройте ссылку на билет заново.',
  away: (n) => `Вы уходили со страницы билета: ${timesRu(n)}. Преподаватель это видит.`,
  emptyPlace: 'Это место в билете пустое — пропустите его.',
  openAria: 'Ответ — число, по одной цифре в клетке',
  digitAria: (n) => `Цифра ${n}`,
  done: 'Билет сдан',
  score: (s, m) => `Вы набрали ${s} из ${m}`,
  viewReview: 'Посмотреть разбор',
  reviewLater: 'Разбор ошибок появится, когда преподаватель его отправит.',
  reviewNotSent: 'Разбор пока не отправлен: он появится, когда преподаватель его отправит.',
  reviewLoadFailed: 'Не удалось загрузить разбор',
  reviewUnavailable: 'Разбор недоступен',
  reviewTitle: (title) => `Разбор${title ? `: ${title}` : ''}`,
  noMistakes: 'Ошибок нет',
  points: (p, m) => `Баллы: ${p} из ${m}`,
  correct: 'верный',
  yours: 'ваш',
  notAnswered: 'Вы не ответили',
  yourAnswer: 'Ваш ответ: ',
  rightShort: 'Верный: ',
  rightAnswer: 'Верный ответ: ',
  closedTitle: 'Приём ответов закрыт',
  closedText: 'Билет по этой ссылке закрыт. Спросите новую ссылку у преподавателя.',
  // По-русски сервер уже прислал понятный текст: показываем его (см. examErrorText)
  errors: {},
  errorFallback: 'Что-то пошло не так. Повторите.',
};

const tg: ExamTexts = {
  ticket: 'Билет',
  retry: 'Такрор кардан',
  backToResult: 'Бозгашт ба натиҷа',
  genericFail: 'Хато рух дод. Такрор кунед.',
  hintWaiting: 'Вақтро омӯзгор таъин мекунад, кӯшиш якто аст.',
  hintRunning: (m) => `Сессия аллакай оғоз шудааст, ${m} дақиқа мондааст. Кӯшиш якто аст.`,
  nameLabel: 'Насаб ва ном',
  namePlaceholder: 'Масалан, Расулов Алишер',
  langLabel: 'Забони билет',
  enter: 'Даромадан',
  entering: 'Ворид мешавем…',
  yourVariant: 'Варианти шумо',
  waitTeacher: 'Интизор шавед, омӯзгор сессияро оғоз мекунад',
  soon: 'Ба зудӣ оғоз мекунем…',
  starting: 'Оғоз мекунем!',
  minutes: (n) => `Вақт: ${n} дақиқа`,
  offline: 'Пайваст нест, боз кӯшиш мекунем…',
  progress: (p, t, a) => `Саволи ${p} аз ${t} · ҷавоб дода шуд: ${a}`,
  unsavedCount: (n) => `сабт нашуд: ${n}`,
  saving: 'сабт мекунем…',
  saveFailed: 'сабт нашуд — аз нав мефиристем…',
  saved: '✓ сабт шуд',
  questionAria: (n) => `Саволи ${n}`,
  back: 'Ба қафо',
  next: 'Ба пеш',
  submit: 'Супоридан',
  confirmTitle: (u) => (u > 0 ? `Бе ҷавоб: ${u}. Месупоред?` : 'Билетро месупоред?'),
  confirmHint: (a, t, u) => `Ҷавоб дода шуд: ${a} аз ${t}.${u > 0 ? ' Саволҳои беҷавоб 0 хол мегиранд.' : ''} Пас аз супоридан ҷавобҳоро иваз кардан мумкин нест.`,
  confirmYes: 'Ҳа, месупорам',
  submitting: 'Месупорем…',
  confirmBack: 'Бозгашт ба билет',
  submitFailed: 'Билет супорида нашуд. Такрор кунед.',
  sessionExpired: 'Сессияи Telegram кӯҳна шуд: ҷавоб сабт нашуд. Саҳифаро пӯшед ва истиноди билетро аз нав кушоед.',
  away: (n) => `Шумо аз саҳифаи билет баромадед: ${n} маротиба. Омӯзгор инро мебинад.`,
  emptyPlace: 'Ин ҷой дар билет холӣ аст — онро гузаред.',
  openAria: 'Ҷавоб — адад, дар ҳар катак як рақам',
  digitAria: (n) => `Рақами ${n}`,
  done: 'Билет супорида шуд',
  score: (s, m) => `Шумо ${s} аз ${m} гирифтед`,
  viewReview: 'Дидани шарҳ',
  reviewLater: 'Шарҳи хатоҳо вақте пайдо мешавад, ки омӯзгор онро фиристад.',
  reviewNotSent: 'Шарҳ ҳанӯз фиристода нашудааст: он вақте пайдо мешавад, ки омӯзгор онро фиристад.',
  reviewLoadFailed: 'Шарҳ бор нашуд',
  reviewUnavailable: 'Шарҳ дастрас нест',
  reviewTitle: (title) => `Шарҳ${title ? `: ${title}` : ''}`,
  noMistakes: 'Хатоҳо нест',
  points: (p, m) => `Холҳо: ${p} аз ${m}`,
  correct: 'дуруст',
  yours: 'ҷавоби шумо',
  notAnswered: 'Шумо ҷавоб надодед',
  yourAnswer: 'Ҷавоби шумо: ',
  rightShort: 'Дуруст: ',
  rightAnswer: 'Ҷавоби дуруст: ',
  closedTitle: 'Қабули ҷавобҳо пӯшида шуд',
  closedText: 'Билет бо ин истинод пӯшида аст. Аз омӯзгор истиноди нав пурсед.',
  errors: {
    network: 'Бо сервер пайваст нест. Интернетро санҷед.',
    bad_init_data: 'Билетро аз Telegram кушоед.',
    bad_code: 'Истиноди билет нодуруст аст.',
    not_found: 'Истиноди билет ёфт нашуд: билет нест карда шудааст.',
    bad_name: 'Насаб ва номро нависед (аз 2 то 80 аломат).',
    no_tickets: 'Дар маҷмӯа билет нест.',
    start_failed: 'Билет оғоз нашуд. Боз кӯшиш кунед.',
    bad_question: 'Ин савол дар билети шумо нест.',
    bad_answer: 'Ҷавоб нодуруст навишта шудааст.',
    not_started: 'Билет ҳанӯз оғоз нашудааст.',
    session_not_started: 'Омӯзгор ҳанӯз билетро оғоз накардааст.',
    review_not_ready: 'Шарҳ вақте пайдо мешавад, ки омӯзгор онро фиристад.',
  },
  errorFallback: 'Хато рух дод. Боз кӯшиш кунед.',
};

export const examTexts = (lang: Lang | null | undefined): ExamTexts => (lang === 'tg' ? tg : ru);

/**
 * Текст ошибки на языке билета. Сервер отвечает по-русски, поэтому для таджикского текст берётся по коду ошибки;
 * для русского показываем текст сервера (он точнее), а без него — общий.
 */
export function examErrorText(e: unknown, lang: Lang | null | undefined): string {
  const t = examTexts(lang);
  const x = e as { code?: unknown; message?: unknown } | null;
  const code = typeof x?.code === 'string' ? x.code : '';
  if (code && t.errors[code]) return t.errors[code];
  if (lang !== 'tg' && code && typeof x?.message === 'string' && x.message) return x.message;
  return t.errorFallback;
}
