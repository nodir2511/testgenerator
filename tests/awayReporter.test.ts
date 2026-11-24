import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyFocusSignal, createAwayReporter, isAway, NO_FOCUS_FLAGS, type FocusSignal } from '../src/exam/awayReporter';

const run = (signals: FocusSignal[]) => signals.reduce(applyFocusSignal, NO_FOCUS_FLAGS);

describe('уход со страницы билета: события', () => {
  it('в начале ученик на странице — даже если фокуса у страницы ещё не было', () => {
    expect(isAway(NO_FOCUS_FLAGS)).toBe(false);
    expect(isAway(run(['focus', 'visible', 'active']))).toBe(false);
  });
  it('скрытие, потеря фокуса и сворачивание Telegram — уход', () => {
    expect(isAway(run(['hidden']))).toBe(true);
    expect(isAway(run(['blur']))).toBe(true);
    expect(isAway(run(['inactive']))).toBe(true);
  });
  it('возвращением считается снятие всех причин', () => {
    expect(isAway(run(['blur', 'hidden', 'visible']))).toBe(true); // вкладка видна, но окно ещё не в фокусе
    expect(isAway(run(['blur', 'hidden', 'visible', 'focus']))).toBe(false);
    expect(isAway(run(['inactive', 'hidden', 'active']))).toBe(true);
  });
  it('нажатие на страницу снимает все причины', () => {
    expect(isAway(run(['blur', 'hidden', 'inactive', 'touch']))).toBe(false);
  });
});

describe('уход со страницы билета: отправка', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const offline = () => Promise.reject(new Error('network'));

  it('уход и возвращение уходят по порядку, возвращение несёт длительность', async () => {
    const calls: Array<[boolean, number | undefined]> = [];
    const r = createAwayReporter(async (away, ms) => { calls.push([away, ms]); });
    r.leave(1000);
    r.leave(1500); // уже ушёл — не считается второй раз
    await flush();
    r.back(8000);
    r.back(9000); // уже вернулся
    await flush();
    expect(calls).toEqual([[true, undefined], [false, 7000]]);
    expect(r.count).toBe(1);
  });

  it('возвращение не обгоняет уход, который ещё в пути', async () => {
    const calls: boolean[] = [];
    let release = () => {};
    const r = createAwayReporter((away) => {
      calls.push(away);
      return away ? new Promise<void>((res) => { release = res; }) : Promise.resolve();
    });
    r.leave(0);
    r.back(500);
    await flush();
    expect(calls).toEqual([true]);
    release();
    await flush();
    expect(calls).toEqual([true, false]);
  });

  it('уход не дошёл (нет связи) — после возвращения отправляется только возвращение с длительностью', async () => {
    const calls: Array<[boolean, number | undefined]> = [];
    let online = false;
    const r = createAwayReporter((away, ms) => { calls.push([away, ms]); return online ? Promise.resolve() : offline(); });
    r.leave(0);
    await flush();
    online = true;
    r.back(60_000);
    await flush();
    expect(calls).toEqual([[true, undefined], [false, 60_000]]);
  });

  it('уход, упавший в пути, отбрасывается, если ученик уже вернулся', async () => {
    const calls: Array<[boolean, number | undefined]> = [];
    let fail = () => {};
    const r = createAwayReporter((away, ms) => {
      calls.push([away, ms]);
      return away ? new Promise<void>((_, rej) => { fail = () => rej(new Error('network')); }) : Promise.resolve();
    });
    r.leave(0);
    r.back(3000);
    fail();
    await flush();
    expect(calls).toEqual([[true, undefined], [false, 3000]]);
  });

  it('пока ученик не на странице, недошедший уход повторяется', async () => {
    let n = 0;
    const r = createAwayReporter(() => (++n < 3 ? offline() : Promise.resolve()), { retryMs: 4000 });
    r.leave(0);
    await flush();
    expect(n).toBe(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(n).toBe(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(n).toBe(3);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(n).toBe(3); // дошло — больше не шлём
  });

  it('возвращение повторяется при сбое связи, но не бесконечно', async () => {
    let n = 0;
    const r = createAwayReporter((away) => { if (!away) n++; return away ? Promise.resolve() : offline(); }, { retryMs: 100, maxTries: 3 });
    r.leave(0);
    await flush();
    r.back(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(n).toBe(3);
  });

  it('ошибка, которую повторять бессмысленно (старый сервер без этого действия), отбрасывается сразу', async () => {
    let n = 0;
    const r = createAwayReporter(() => { n++; return Promise.reject(new Error('400')); }, { retryMs: 100, isRetryable: () => false });
    r.leave(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(n).toBe(1);
  });

  it('страница открыта заново: одно «вернулся» без длительности — сервер закроет незавершённый уход', async () => {
    const calls: Array<[boolean, number | undefined]> = [];
    const r = createAwayReporter(async (away, ms) => { calls.push([away, ms]); });
    r.arrive();
    await flush();
    expect(calls).toEqual([[false, undefined]]);
    expect(r.count).toBe(0);
    r.leave(0);
    r.arrive(); // ученик не на странице — не «прибыл»
    await flush();
    expect(calls).toEqual([[false, undefined], [true, undefined]]);
  });

  it('после stop ничего не отправляется', async () => {
    let n = 0;
    const r = createAwayReporter(() => { n++; return offline(); }, { retryMs: 100 });
    r.leave(0);
    await flush();
    r.stop();
    r.back(100);
    r.leave(200);
    await vi.advanceTimersByTimeAsync(1000);
    expect(n).toBe(1);
    expect(r.count).toBe(1);
  });
});
