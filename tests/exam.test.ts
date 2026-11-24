import { describe, it, expect } from 'vitest';
import {
  EXAM_LINK_HOURS, publicSnapshot, reviewSnapshot, parseOpen, scoreAttempt, pickVariant, examCode,
  parseStartPayload, tgPlain, reviewLines, chunkLines, examLang, reviewHead, reviewButtonText, reviewJustSent, REVIEW_RESEND_GUARD_MS,
  EXAM_MIN_MINUTES, EXAM_MAX_MINUTES, EXAM_COUNTDOWN_SEC, EXAM_START_LEAD_SEC, EXAM_POLL_MS, sessionEnd, sessionPhase, clampMinutes, countdownDigit,
  shuffleOptions, awayMs, AWAY_MS_MAX,
} from '../supabase/functions/_shared/exam';
import * as examShared from '../supabase/functions/_shared/exam';

const test = (id = 'q1', right = 'o2') => ({
  id, type: 'test', content: 'Формула воды', content_ru: 'Формула воды', content_tg: 'Формулаи об', image_url: null, order_index: 1,
  passage: { id: 'ps1', kind: 'text', title: 'Заголовок', content: 'Текст' }, passage_id: 'ps1', passage_order: 1, chapter_name: 'Гл', correct_numeric_answer: null,
  options: ['o1', 'o2', 'o3'].map((o, i) => ({ id: o, text: o.toUpperCase(), text_ru: `R${o}`, text_tg: `T${o}`, image_url: null, is_correct: o === right, order_index: i + 1 })),
});
const matching = () => ({
  id: 'm1', type: 'matching', content: 'Соотнесите', content_ru: 'Соотнесите', content_tg: 'Мувофиқ', image_url: null,
  matching_items: [
    ...[1, 2, 3, 4].map((n) => ({ id: `l${n}`, side: 'left', text: `L${n}`, text_ru: `Л${n}`, text_tg: `Ч${n}`, correct_match_id: `r${n}`, order_index: n })),
    ...[1, 2, 3, 4, 5].map((n) => ({ id: `r${n}`, side: 'right', text: `R${n}`, text_ru: `П${n}`, text_tg: `Р${n}`, correct_match_id: null, order_index: n })),
  ],
});
const open = (v: number | null = 16) => ({ id: 'p1', type: 'open', content: 'Сколько?', content_ru: 'Сколько?', content_tg: 'Чанд?', image_url: null, correct_numeric_answer: v });

describe('publicSnapshot', () => {
  it('убирает ключи ответов и оставляет остальное', () => {
    for (const s of [test(), matching(), open()]) {
      const copy = JSON.stringify(s);
      const out = publicSnapshot(s);
      const j = JSON.stringify(out);
      expect(j).not.toContain('is_correct');
      expect(j).not.toContain('correct_match_id');
      expect(j).not.toContain('correct_numeric_answer');
      expect(JSON.stringify(s)).toBe(copy);
      expect(out.id).toBe(s.id);
      expect(out.type).toBe(s.type);
    }
    const t = publicSnapshot(test());
    expect(t.passage).toEqual({ id: 'ps1', kind: 'text', title: 'Заголовок', content: 'Текст' });
    expect(t.passage_order).toBe(1);
    expect(t.order_index).toBe(1);
    expect(t.options[1]).toMatchObject({ id: 'o2', text: 'O2', text_ru: 'Ro2', text_tg: 'To2', image_url: null, order_index: 2 });
    expect(publicSnapshot(matching()).matching_items[0]).toMatchObject({ id: 'l1', side: 'left', text_ru: 'Л1' });
  });
  it('неизвестные поля не попадают к ученику (список разрешённых)', () => {
    const s: any = test();
    s.explanation = 'секрет'; s.correct_foo = 1; s.options[0].correct_bar = true; s.options[0].hint = 'x';
    s.passage.correct_baz = 1;
    const j = JSON.stringify(publicSnapshot(s));
    for (const bad of ['explanation', 'correct_foo', 'correct_bar', 'hint', 'correct_baz', 'секрет']) expect(j).not.toContain(bad);
  });
  it('в реальном снимке нет ни одного ключа со словом correct', () => {
    for (const s of [test(), matching(), open()]) expect(JSON.stringify(publicSnapshot(s))).not.toMatch(/correct/);
  });
  it('пустое место возвращается как есть', () => {
    const e = { empty: true, type: 'test' };
    expect(publicSnapshot(e)).toEqual(e);
  });
});

describe("reviewSnapshot", () => {
  it("как publicSnapshot плюс только три поля ключа", () => {
    const s: any = test();
    s.explanation = "секрет"; s.options[0].hint = "x"; s.chapter_name = "Гл";
    const t = reviewSnapshot(s);
    expect(t.options.map((o: any) => o.is_correct)).toEqual([false, true, false]);
    expect(t.correct_numeric_answer).toBeNull();
    const j = JSON.stringify(t);
    for (const bad of ["explanation", "hint", "секрет", "chapter_name"]) expect(j).not.toContain(bad);
    expect(t.passage).toEqual(publicSnapshot(s).passage);
    const m = reviewSnapshot(matching());
    expect(m.matching_items[0]).toMatchObject({ id: "l1", side: "left", correct_match_id: "r1" });
    expect(reviewSnapshot(open(16)).correct_numeric_answer).toBe(16);
    expect(reviewLines([{ tqId: "a", snapshot: reviewSnapshot(test()) }], { a: "o1" }, "ru")).toEqual(reviewLines([{ tqId: "a", snapshot: test() }], { a: "o1" }, "ru"));
  });
  it("пустое место — только признак и тип", () => {
    expect(reviewSnapshot({ empty: true, type: "test", content: "x", topic_name: "Т" })).toEqual({ empty: true, type: "test" });
  });
});

describe("scoreAttempt", () => {
  const q = (snapshot: any, tqId = snapshot.id) => ({ tqId, snapshot });
  it('тест', () => {
    const r = scoreAttempt([q(test('a')), q(test('b')), q(test('c'))], { a: 'o2', b: 'o1', c: null });
    expect(r.score).toBe(1);
    expect(r.max).toBe(3);
    expect(r.items.map((i) => [i.points, i.max, i.answered])).toEqual([[1, 1, true], [0, 1, true], [0, 1, false]]);
  });
  it('соответствие: по баллу за пункт', () => {
    const r = scoreAttempt([q(matching())], { m1: { l1: 'r1', l2: 'r2', l3: 'r3', l4: 'r5' } });
    expect(r.score).toBe(3);
    expect(r.max).toBe(4);
    expect(scoreAttempt([q(matching())], {}).score).toBe(0);
  });
  it('открытый: 2 балла, запятая как точка', () => {
    expect(scoreAttempt([q(open(16))], { p1: '16' }).score).toBe(2);
    expect(scoreAttempt([q(open(16))], { p1: '16,0' }).score).toBe(2);
    expect(scoreAttempt([q(open(12.5))], { p1: '12,5' }).score).toBe(2);
    expect(scoreAttempt([q(open(16))], { p1: '17' }).score).toBe(0);
    const n = scoreAttempt([q(open(null))], { p1: '16' });
    expect([n.score, n.max]).toEqual([0, 2]);
  });
  it('пустое место — 0 из 0; сумма билета 18+2+7 = 40', () => {
    const e = scoreAttempt([q({ empty: true, type: 'test' }, 'e')], {});
    expect([e.score, e.max]).toEqual([0, 0]);
    const qs = [
      ...Array.from({ length: 18 }, (_, i) => q(test(`t${i}`))),
      ...Array.from({ length: 2 }, (_, i) => q({ ...matching(), id: `m${i}` })),
      ...Array.from({ length: 7 }, (_, i) => q({ ...open(), id: `p${i}` })),
    ];
    expect(scoreAttempt(qs, {}).max).toBe(40);
  });
});

describe('parseOpen', () => {
  it('разбор числа', () => {
    expect(parseOpen('12,5')).toBe(12.5);
    expect(parseOpen(' -3 ')).toBe(-3);
    expect(parseOpen('abc')).toBeNull();
    expect(parseOpen('')).toBeNull();
    expect(parseOpen(null)).toBeNull();
  });
});

describe('pickVariant, examCode, parseStartPayload', () => {
  it('pickVariant', () => {
    expect(pickVariant(['a', 'b', 'c'], () => 0)).toBe('a');
    expect(pickVariant(['a', 'b', 'c'], () => 0.99)).toBe('c');
    expect(() => pickVariant([])).toThrow('В наборе нет билетов');
  });
  it('examCode', () => {
    expect(examCode(() => 0)).toBe('AAAAAA');
    for (let i = 0; i < 50; i++) expect(examCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });
  it('parseStartPayload', () => {
    expect(parseStartPayload('/start exam_K7M2QX')).toBe('K7M2QX');
    expect(parseStartPayload('/start K7M2QX')).toBeNull();
    expect(parseStartPayload('/start exam_k7m2qx')).toBe('K7M2QX');
    expect(parseStartPayload('/start exam_<script>')).toBeNull();
  });
});

describe('время', () => {
  it('константы', () => { expect(EXAM_LINK_HOURS).toBe(24); });
  it('старый срок попытки (30 мин от входа) удалён: конец у всех общий — от старта сессии', () => {
    const mod: Record<string, unknown> = examShared;
    for (const dead of ['EXAM_MINUTES', 'deadlineOf', 'attemptState']) expect(mod[dead]).toBeUndefined();
  });
});

describe('awayMs: длительность ухода со страницы от клиента', () => {
  it('целое число миллисекунд больше нуля', () => {
    expect(awayMs(1500)).toBe(1500);
    expect(awayMs(1499.6)).toBe(1500);
  });
  it('не больше суток', () => expect(awayMs(1e15)).toBe(AWAY_MS_MAX));
  it('мусор, ноль и отрицательное — null', () => {
    for (const v of [0, -5, 0.4, NaN, Infinity, '1500', null, undefined, {}, true]) expect(awayMs(v)).toBeNull();
  });
});

describe('tgPlain', () => {
  it('индексы, степени, теги, экранирование', () => {
    expect(tgPlain('H<sub>2</sub>SO<sub>4</sub>')).toBe('H₂SO₄');
    expect(tgPlain('x<sup>2</sup>')).toBe('x²');
    expect(tgPlain('<b>да</b> &lt;')).toBe('да &lt;');
    expect(tgPlain('a < b')).toBe('a &lt; b');
    expect(tgPlain('a<sub>n</sub>')).toBe('a_n');
    expect(tgPlain('x<sup>n</sup>')).toBe('x^n');
    expect(tgPlain('<frac>1/2</frac>')).toBe('1/2');
    expect(tgPlain('A & B > C')).toBe('A &amp; B &gt; C');
    expect(tgPlain('&amp;lt;')).toBe('&amp;lt;');
    expect(tgPlain('&amp;')).toBe('&amp;');
  });
});

describe('tgPlain: математика со знаками < и >', () => {
  it('сравнение с «<» и «>» в одной строке не вырезается как тег', () => {
    expect(tgPlain('x<y и z>w')).toBe('x&lt;y и z&gt;w');
    expect(tgPlain('если a<b и c>d, то')).toBe('если a&lt;b и c&gt;d, то');
    expect(tgPlain('1<x<5')).toBe('1&lt;x&lt;5');
    expect(tgPlain('<y>')).toBe('&lt;y&gt;');
  });
  it('разметку сайта по-прежнему убирает', () => {
    expect(tgPlain('<b>а</b><i>б</i><u>в</u><em>г</em><strong>д</strong><span class="x">е</span><p>ж</p>')).toBe('абвгдеж');
    expect(tgPlain('<lab1>слово</lab1>')).toBe('слово');
    expect(tgPlain('а<br>б<br/>в<BR />г')).toBe('а\nб\nв\nг');
  });
  it('безопасно для Telegram HTML: чужие теги экранируются', () => {
    const out = tgPlain('<script>alert(1)</script><a href="x">y</a> <b>ok</b>');
    expect(out).not.toMatch(/<(?!\/?(b|i|u)>)/);
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('ok');
  });
});

describe('examLang и защита от двойной рассылки', () => {
  it('examLang: только tg считается таджикским', () => {
    expect(examLang('tg')).toBe('tg');
    expect(examLang('ru')).toBe('ru');
    expect(examLang(undefined)).toBe('ru');
    expect(examLang('en')).toBe('ru');
  });
  it('reviewJustSent: 409 только если разбор отправлен меньше 10 секунд назад', () => {
    const now = new Date('2026-11-22T12:00:30Z');
    expect(REVIEW_RESEND_GUARD_MS).toBe(10_000);
    expect(reviewJustSent(null, now)).toBe(false);
    expect(reviewJustSent('2026-11-22T12:00:25Z', now)).toBe(true);
    expect(reviewJustSent('2026-11-22T12:00:20Z', now)).toBe(false);
    expect(reviewJustSent('2026-11-22T12:00:10Z', now)).toBe(false);
    expect(reviewJustSent('2026-11-22T12:00:40Z', now)).toBe(false); // из будущего (сдвиг часов) не блокирует
  });
});

describe('тексты разбора по языку запуска', () => {
  it('русский по умолчанию', () => {
    expect(reviewHead('Алгебра', 3, 5, 'ru')).toBe('📝 <b>Разбор: Алгебра</b>\nВы набрали 3 из 5.');
    expect(reviewButtonText('ru')).toBe('Открыть с формулами и рисунками');
  });
  it('таджикский: заголовок, кнопка и подписи строк', () => {
    expect(reviewHead('Алгебра', 3, 5, 'tg')).toContain('Шарҳ');
    expect(reviewHead('Алгебра', 3, 5, 'tg')).toContain('3 аз 5');
    expect(reviewButtonText('tg')).not.toBe(reviewButtonText('ru'));
    const qs = [{ tqId: 'a', snapshot: test('a') }];
    const lines = reviewLines(qs, { a: 'o1' }, 'tg').join(' ');
    expect(lines).toContain('Ҷавоби шумо');
    expect(lines).toContain('Ҷавоби дуруст');
    expect(lines).not.toContain('Ваш ответ');
    expect(reviewLines(qs, { a: 'o2' }, 'tg')).toEqual(['Хатоҳо нест']);
    expect(reviewLines(qs, { a: 'o2' }, 'ru')).toEqual(['Ошибок нет']);
  });
});

describe('reviewLines', () => {
  const qs = [
    { tqId: 'a', snapshot: test('a') },
    { tqId: 'b', snapshot: { ...test('b'), image_url: 'http://x/y.png' } },
    { tqId: 'm', snapshot: matching() },
    { tqId: 'p', snapshot: open(16) },
  ];
  it('только вопросы с ошибкой', () => {
    const lines = reviewLines(qs, { a: 'o2', b: 'o1', m: { l1: 'r1', l2: 'r2', l3: 'r3', l4: 'r5' }, p: '17' }, 'ru');
    const all = lines.join('\n');
    expect(all).toContain('[рисунок]');
    expect(all).toContain('Ваш ответ: A) Ro1');
    expect(all).toContain('Верный ответ: B) Ro2');
    expect(all).toContain('Ваш ответ: A) Л1 — 1) П1; B) Л2 — 2) П2; C) Л3 — 3) П3; D) Л4 — 5) П5');
    expect(all).toContain('Ваш ответ: 17');
    expect(all).toContain('Верный ответ: 16');
    expect(all).toMatch(/2\. .*Формула воды/);
    expect(all).not.toMatch(/1\. .*Формула/);
    expect(all).toMatch(/3\. .*Соотнесите/);
    expect(all).toMatch(/4\. .*Сколько/);
  });
  it('верные пропускаются', () => {
    const all = reviewLines(qs, { a: 'o2', b: 'o2', m: { l1: 'r1', l2: 'r2', l3: 'r3', l4: 'r5' }, p: '16' }, 'ru').join('\n');
    expect(all).not.toMatch(/Формула/);
    expect(all).not.toMatch(/Сколько/);
    expect(all).toMatch(/3\. .*Соотнесите/);
  });
  it('таджикские тексты', () => {
    expect(reviewLines([qs[0]], { a: 'o1' }, 'tg').join('\n')).toContain('Формулаи об');
  });
  it('без ошибок', () => {
    expect(reviewLines([qs[0]], { a: 'o2' }, 'ru')).toEqual(['Ошибок нет']);
  });
  it('номер — среди непустых мест, как в билете ученика (пустые места не считаются)', () => {
    const withGaps = [
      { tqId: 'e1', snapshot: { empty: true, type: 'test' } },
      { tqId: 'a', snapshot: test('a') },
      { tqId: 'e2', snapshot: null },
      { tqId: 'p', snapshot: open(16) },
    ];
    const lines = reviewLines(withGaps, { a: 'o1', p: '17' }, 'ru');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^1\. Формула воды/);
    expect(lines[1]).toMatch(/^2\. Сколько/);
  });
});

describe('сообщения преподавателю', () => {
  it('linkSendText / linkSendButton: «Войти в билет», не «Начать билет»', () => {
    const t = examShared.linkSendText('Алгебра', 'Математика', 'https://t.me/bot?start=exam_AB23CD');
    expect(t).toContain('📝 <b>Билет: Алгебра</b>');
    expect(t).toContain('\nПредмет: Математика');
    expect(t).toContain('нажмите «Войти в билет»');
    expect(t).toContain('https://t.me/bot?start=exam_AB23CD');
    expect(t).not.toMatch(/Начать билет/);
    expect(examShared.linkSendText('Алгебра', '', 'u')).not.toContain('Предмет');
    expect(examShared.LINK_SEND_BUTTON).toBe('📝 Войти в билет');
  });

  it('closedSummary: закрытые в ожидании не считаются ни в «сдали», ни в среднем', () => {
    const start = '2026-11-22T12:00:00Z';
    const rows = [
      { finished_at: '2026-11-22T12:20:00Z', score: 30, max_score: 40 },
      { finished_at: '2026-11-22T12:25:00Z', score: 20, max_score: 40 },
      { finished_at: '2026-11-22T11:59:00Z', score: 0, max_score: 40 }, // закрыта в ожидании
      { finished_at: null, score: null, max_score: null },
    ];
    const s = examShared.closedSummary(rows, start);
    expect([s.finished, s.started]).toEqual([2, 4]);
    expect(s.lines).toEqual(['Сдали: 2 из 4 начавших.', 'Средний балл: 25 из 40.']);
    // Сессию так и не начали — сдавших нет, среднего нет
    const none = examShared.closedSummary(rows, null);
    expect(none.finished).toBe(0);
    expect(none.lines).toEqual(['Сдали: 0 из 4 начавших.']);
    expect(examShared.closedSummary([{ finished_at: '2026-11-22T12:20:00Z', score: 12.25, max_score: 40 }], start).lines[1]).toBe('Средний балл: 12,3 из 40.');
  });
});

describe('chunkLines', () => {
  it('режет по лимиту', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${i}. ${'я'.repeat(200)}`);
    const parts = chunkLines(lines);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(3800);
    expect(parts.join('\n').split('\n').length).toBe(100);
    expect(chunkLines(['a', 'b'])).toEqual(['a\nb']);
  });
});

describe('сессия: зал ожидания и общий старт', () => {
  const T0 = Date.parse('2026-11-22T12:00:00Z');
  const link = (startMs: number | null, min = 30) => ({ session_start_at: startMs === null ? null : new Date(startMs).toISOString(), duration_min: min });

  it('константы', () => {
    expect([EXAM_MIN_MINUTES, EXAM_MAX_MINUTES, EXAM_COUNTDOWN_SEC, EXAM_POLL_MS]).toEqual([5, 45, 3, 3000]);
  });

  it('EXAM_START_LEAD_SEC: старт через 6 с — больше отсчёта плюс одного опроса, чтобы каждый ученик увидел цифры', () => {
    expect(EXAM_START_LEAD_SEC).toBe(6);
    expect(EXAM_START_LEAD_SEC * 1000).toBeGreaterThanOrEqual(EXAM_COUNTDOWN_SEC * 1000 + EXAM_POLL_MS);
  });

  it('EXAM_START_LEAD_SEC совпадает с интервалом в exam_session_start (supabase/sql/exam_links.sql)', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../supabase/sql/exam_links.sql', import.meta.url), 'utf8');
    const m = /session_start_at\s*=\s*now\(\)\s*\+\s*interval\s*'(\d+) seconds'/.exec(sql);
    expect(m?.[1]).toBe(String(EXAM_START_LEAD_SEC));
  });

  it('sessionEnd', () => {
    expect(sessionEnd(link(null))).toBeNull();
    expect(sessionEnd(link(T0, 30))?.toISOString()).toBe('2026-11-22T12:30:00.000Z');
  });

  it('sessionPhase', () => {
    expect(sessionPhase(link(null), new Date(T0))).toBe('waiting');
    expect(sessionPhase(link(T0 + 2000), new Date(T0))).toBe('countdown');
    expect(sessionPhase(link(T0 - 10_000), new Date(T0))).toBe('running');
    expect(sessionPhase(link(T0 - 31 * 60_000), new Date(T0))).toBe('ended');
    expect(sessionPhase(link(T0), new Date(T0))).toBe('running');
    expect(sessionPhase(link(T0 - 30 * 60_000), new Date(T0))).toBe('ended');
  });

  it('clampMinutes', () => {
    expect(clampMinutes(30)).toBe(30);
    expect(clampMinutes('30')).toBe(30);
    expect(clampMinutes(5)).toBe(5);
    expect(clampMinutes(45)).toBe(45);
    for (const v of [4, 46, 30.5, 'abc', null]) expect(clampMinutes(v)).toBeNull();
  });

  it('countdownDigit', () => {
    expect(countdownDigit(T0 + 2500, T0)).toBe(3);
    expect(countdownDigit(T0 + 1500, T0)).toBe(2);
    expect(countdownDigit(T0 + 500, T0)).toBe(1);
    expect(countdownDigit(T0, T0)).toBe(0);
    expect(countdownDigit(T0, T0 + 5000)).toBe(0);
    expect(countdownDigit(T0 + 9000, T0)).toBe(3);
  });
});

describe('shuffleOptions: свой порядок вариантов у каждого ученика', () => {
  const four = (id = 'q4') => ({
    ...test(id),
    options: ['o1', 'o2', 'o3', 'o4'].map((o, i) => ({ id: o, text: `Вариант ${i + 1}`, text_ru: `Вариант ${i + 1}`, text_tg: `Ҷавоб ${i + 1}`, image_url: null, is_correct: o === 'o2', order_index: i + 1 })),
  });
  const sorted = (xs: any[]) => [...xs].sort((a, b) => a.order_index - b.order_index);
  const ids = (xs: any[]) => sorted(xs).map((o) => o.id).join(',');
  const side = (s: any, k: 'left' | 'right') => s.matching_items.filter((m: any) => m.side === k);

  it('один seed — один порядок (повторный вызов, повторное открытие)', () => {
    const a = shuffleOptions(publicSnapshot(four()), 'att-1');
    const b = shuffleOptions(publicSnapshot(four()), 'att-1');
    expect(a).toEqual(b);
    expect(ids(shuffleOptions(reviewSnapshot(four()), 'att-1').options)).toBe(ids(a.options));
  });

  it('разные seed дают разные порядки; порядок зависит и от id вопроса', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(ids(shuffleOptions(four(), `seed-${i}`).options));
    expect(seen.size).toBeGreaterThanOrEqual(3);
    const byQ = new Set<string>();
    for (let i = 0; i < 50; i++) byQ.add(ids(shuffleOptions(four(`q-${i}`), 'att-1').options));
    expect(byQ.size).toBeGreaterThanOrEqual(3);
  });

  it('те же варианты и id, order_index 0..n-1 по новому порядку, исходный снимок не изменён', () => {
    const src = four();
    const copy = JSON.stringify(src);
    for (let i = 0; i < 30; i++) {
      const out = shuffleOptions(src, `s${i}`);
      expect(out.options.map((o: any) => o.order_index)).toEqual([0, 1, 2, 3]);
      expect(out.options.map((o: any) => o.id).sort()).toEqual(['o1', 'o2', 'o3', 'o4']);
      for (const o of out.options) {
        const was = src.options.find((x) => x.id === o.id)!;
        expect({ ...o, order_index: was.order_index }).toEqual(was);
      }
      expect(out.content).toBe(src.content);
    }
    expect(JSON.stringify(src)).toBe(copy);
  });

  it('без is_correct на входе — без is_correct на выходе', () => {
    expect(JSON.stringify(shuffleOptions(publicSnapshot(four()), 'x'))).not.toMatch(/correct/);
    expect(JSON.stringify(shuffleOptions(publicSnapshot(matching()), 'x'))).not.toMatch(/correct/);
  });

  it('соответствие: левые и правые перемешиваются независимо, id и correct_match_id прежние', () => {
    const src = matching();
    const copy = JSON.stringify(src);
    const lefts = new Set<string>(), rights = new Set<string>(), pairs = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const out = shuffleOptions(src, `seed-${i}`);
      const l = side(out, 'left'), r = side(out, 'right');
      expect(sorted(l).map((m: any) => m.order_index)).toEqual([0, 1, 2, 3]);
      expect(sorted(r).map((m: any) => m.order_index)).toEqual([0, 1, 2, 3, 4]);
      expect(l.map((m: any) => m.id).sort()).toEqual(['l1', 'l2', 'l3', 'l4']);
      expect(r.map((m: any) => m.id).sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
      for (const m of l) expect(m.correct_match_id).toBe(`r${m.id.slice(1)}`);
      lefts.add(ids(l)); rights.add(ids(r)); pairs.add(`${ids(l)}|${ids(r)}`);
    }
    expect(lefts.size).toBeGreaterThanOrEqual(3);
    expect(rights.size).toBeGreaterThanOrEqual(3);
    // Независимо: пар порядков больше, чем порядков одной стороны
    expect(pairs.size).toBeGreaterThan(Math.max(lefts.size, rights.size));
    expect(JSON.stringify(src)).toBe(copy);
  });

  it('оценка не меняется: баллы по id', () => {
    const qs = [{ tqId: 'a', snapshot: four() }, { tqId: 'm', snapshot: matching() }];
    const ans = { a: 'o2', m: { l1: 'r1', l2: 'r3', l3: 'r3', l4: 'r4' } };
    const shuffled = qs.map((q) => ({ ...q, snapshot: shuffleOptions(q.snapshot, 'att-7') }));
    expect(scoreAttempt(shuffled, ans).score).toBe(scoreAttempt(qs, ans).score);
  });

  it('снимок без id: зерно — запасной ключ (tqId), разные вопросы перемешаны по-разному', () => {
    const noId = (): any => { const s: any = four(); delete s.id; return s; };
    // Запасной ключ задаёт порядок: тот же tqId — тот же порядок; разные tqId — разные порядки
    expect(shuffleOptions(noId(), 'att-1', 'tq-1')).toEqual(shuffleOptions(noId(), 'att-1', 'tq-1'));
    const byTq = new Set<string>();
    for (let i = 0; i < 50; i++) byTq.add(ids(shuffleOptions(noId(), 'att-1', `tq-${i}`).options));
    expect(byTq.size).toBeGreaterThanOrEqual(3);
    // id снимка важнее запасного ключа: порядок прежний, что бы ни передали третьим параметром
    expect(ids(shuffleOptions(four('q9'), 'att-1', 'tq-1').options)).toBe(ids(shuffleOptions(four('q9'), 'att-1').options));
    expect(ids(shuffleOptions(four('q9'), 'att-1', 'tq-1').options)).toBe(ids(shuffleOptions(four('q9'), 'att-1', 'tq-2').options));
    // reviewLines передаёт tqId: буквы разбора без id снимка — те же, что на экране
    const shown = sorted(shuffleOptions(publicSnapshot(noId()), 'att-3', 'x').options);
    const line = reviewLines([{ tqId: 'x', snapshot: noId() }], { x: 'o3' }, 'ru', 'att-3').join('\n');
    expect(line).toContain(`Ваш ответ: ${'ABCD'[shown.findIndex((o: any) => o.id === 'o3')]}) Вариант 3`);
  });

  it('open, пустое место, один вариант, группа из одного пункта — как есть', () => {
    expect(shuffleOptions(open(), 's')).toEqual(open());
    expect(shuffleOptions({ empty: true, type: 'test' }, 's')).toEqual({ empty: true, type: 'test' });
    expect(shuffleOptions(null, 's')).toBeNull();
    const one = { ...test(), options: [test().options[0]] };
    expect(shuffleOptions(one, 's')).toEqual(one);
    const m: any = matching();
    m.matching_items = [m.matching_items[0], ...m.matching_items.slice(4)]; // один левый, пять правых
    for (let i = 0; i < 20; i++) expect(side(shuffleOptions(m, `s${i}`), 'left')).toEqual([m.matching_items[0]]);
  });

  it('варианты вроде «все перечисленные» — порядок не меняется вовсе', () => {
    for (const phrase of ['Все перечисленные', 'ни один из перечисленных', 'Оба ответа верны', 'всё перечисленное', 'Ҳамаи ҷавобҳо', 'ҲЕҶ ЯКЕ']) {
      const s: any = four();
      s.options[3].text = phrase; s.options[3].text_ru = phrase;
      for (let i = 0; i < 20; i++) expect(shuffleOptions(s, `s${i}`)).toEqual(s);
    }
    const t: any = four();
    t.options[2].text_tg = 'Ҳеҷ яке аз инҳо'; // только в таджикском тексте
    for (let i = 0; i < 20; i++) expect(shuffleOptions(t, `s${i}`)).toEqual(t);
    // «оба» внутри другого слова — обычный вариант
    const w: any = four();
    w.options[0].text = 'Собака'; w.options[0].text_ru = 'Собака';
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(ids(shuffleOptions(w, `s${i}`).options));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('reviewLines с seed: буквы и цифры в тексте — как на экране ученика', () => {
    const LET = 'ABCDEFGH';
    for (let i = 0; i < 20; i++) {
      const seed = `att-${i}`;
      const qs = [{ tqId: 'a', snapshot: four() }, { tqId: 'm', snapshot: matching() }];
      const ans = { a: 'o3', m: { l1: 'r2', l2: 'r2', l3: 'r3', l4: 'r4' } as Record<string, string> };
      const all = reviewLines(qs, ans, 'ru', seed).join('\n');
      // Экран ученика: publicSnapshot + shuffleOptions, буква — по order_index
      const opts = sorted(shuffleOptions(publicSnapshot(four()), seed).options);
      expect(all).toContain(`Ваш ответ: ${LET[opts.findIndex((o: any) => o.id === 'o3')]}) Вариант 3`);
      expect(all).toContain(`Верный ответ: ${LET[opts.findIndex((o: any) => o.id === 'o2')]}) Вариант 2`);
      const ms = shuffleOptions(publicSnapshot(matching()), seed);
      const l = sorted(side(ms, 'left')), r = sorted(side(ms, 'right'));
      const row = (lid: string, rid: string) => `${LET[l.findIndex((x: any) => x.id === lid)]}) Л${lid.slice(1)} — ${r.findIndex((x: any) => x.id === rid) + 1}) П${rid.slice(1)}`;
      expect(all).toContain(`Ваш ответ: ${l.map((x: any) => row(x.id, ans.m[x.id])).join('; ')}`);
      expect(all).toContain(`Верный ответ: ${l.map((x: any) => row(x.id, `r${x.id.slice(1)}`)).join('; ')}`);
    }
    // Без seed — исходный порядок
    expect(reviewLines([{ tqId: 'a', snapshot: four() }], { a: 'o3' }, 'ru').join('\n')).toContain('Ваш ответ: C) Вариант 3');
  });
});
