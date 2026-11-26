import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExamApiError, apiAdvance, apiCopy, apiFocus, apiOpen, apiSave, apiSubmit, getServerOffset, tgApp, type AwayRules } from './api';
import { COPY_EVENTS, createCopyGuard, isEditable } from './copyGuard';
import { watermarkImage, watermarkText } from './watermark';
import { applyFocusSignal, createAwayReporter, isAway, NO_FOCUS_FLAGS, type FocusSignal } from './awayReporter';
import { examErrorText, examTexts } from './i18n';
import { ExamQuestion } from './ExamQuestion';
import { isAnswered as isAnsweredQ, openCellsFor, saveOutcome, saveStatus, SAVE_WAIT_MAX_TRIES, SAVE_WAIT_RETRY_MS } from './examLogic';
import { noBackStartPos, countAnswered, firstUnansweredPos, formatRemaining, navIndexes, progressFraction, remainingMs, stepNav, type Answer, type Answers, type ExamQ, type Lang } from './examLogic';

const RETRY_MS = 4000;

/** Экран билета: все вопросы подряд, сверху таймер, счётчик и «Сдать». Каждый ответ сразу уходит на сервер. */
export function ExamTicket({ code, lang, subject, deadline, questions, initialAnswers, away, noBack = false, startPos = 0, studentName, onFinished, onAwayClosed }: {
  code: string; lang: Lang; subject: string; deadline: string; questions: ExamQ[]; initialAnswers: Answers;
  /** Правило о выходах: включено ли и сколько уже израсходовано (нет — старый сервер, правила нет) */
  away?: AwayRules;
  /** Без возврата к вопросам (галочка преподавателя); startPos — номер вопроса, до которого ученик уже дошёл */
  noBack?: boolean; startPos?: number;
  /** Имя ученика для водяного знака поверх билета */
  studentName?: string;
  onFinished: (r: { score: number; max: number }) => void;
  /** Правило о выходах закрыло билет: наверху перечитают состояние и покажут итог */
  onAwayClosed: () => void;
}) {
  const t = examTexts(lang); // весь интерфейс билета и предупреждения — на языке, который выбрал ученик
  const tRef = useRef(t);
  tRef.current = t;
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [unsaved, setUnsaved] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set()); // последняя отправка не удалась (красное)
  const [saved, setSaved] = useState<Set<string>>(new Set()); // сервер подтвердил запись (зелёное)
  const flag = (set: 'failed' | 'saved', tqId: string, on: boolean) => {
    (set === 'failed' ? setFailed : setSaved)((prev) => {
      if (prev.has(tqId) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(tqId); else next.delete(tqId);
      return next;
    });
  };
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const nav = useMemo(() => navIndexes(questions), [questions]);
  const [pos, setPos] = useState(() => (noBack ? noBackStartPos(navIndexes(questions), startPos) : firstUnansweredPos(questions, initialAnswers)));
  const [skipWarn, setSkipWarn] = useState(false); // «без возврата»: предупредили, что вопрос останется без ответа

  const answersRef = useRef(answers);
  const unsavedRef = useRef(unsaved);
  const ver = useRef<Record<string, number>>({});
  const flying = useRef(new Map<string, Promise<void>>()); // сохранения в полёте: сдача ждёт их
  const submittingRef = useRef(false);
  const doneRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const onAwayClosedRef = useRef(onAwayClosed);
  onAwayClosedRef.current = onAwayClosed;

  // Срок задаёт сервер; остаток считаем по часам сервера (смещение обновляется с каждым ответом)
  const offset = getServerOffset();
  const left = remainingMs(deadline, offset ?? 0, now);
  const { answered, total } = useMemo(() => countAnswered(questions, answers), [questions, answers]);

  // Набор неотправленных ведём синхронно в ref (его читает сдача), в state — для показа
  const markUnsaved = (tqId: string, on: boolean) => {
    if (unsavedRef.current.has(tqId) === on) return;
    const next = new Set(unsavedRef.current);
    if (on) next.add(tqId); else next.delete(tqId);
    unsavedRef.current = next;
    setUnsaved(next);
  };

  const finish = useCallback(async (auto: boolean) => {
    if (submittingRef.current || doneRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice('');
    try {
      // Сдача идёт после сохранений: сначала ждём те, что в полёте (не дольше 3 с), потом досылаем неотправленные
      const settle = (ps: Promise<unknown>[]) => Promise.race([Promise.allSettled(ps), new Promise((r) => setTimeout(r, 3000))]);
      timers.current.forEach(clearTimeout); // отложенные отправки заменяет досылка ниже
      timers.current.clear();
      await settle([...flying.current.values()]);
      const rest = Object.keys(ver.current).filter((id) => unsavedRef.current.has(id) && !flying.current.has(id));
      await settle(rest.map((id) => apiSave(code, id, answersRef.current[id] ?? null).catch(() => undefined)));
      const r = await apiSubmit(code);
      doneRef.current = true;
      onFinishedRef.current(r);
    } catch (e) {
      setNotice(e instanceof ExamApiError ? examErrorText(e, lang) : tRef.current.submitFailed);
      if (auto) setConfirm(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [code, lang]);

  const send = useCallback((tqId: string): Promise<void> => {
    if (flying.current.has(tqId) || doneRef.current) return flying.current.get(tqId) ?? Promise.resolve();
    const p = (async () => {
      try {
        let waits = 0;
        for (;;) {
          const v = ver.current[tqId] ?? 0;
          const r = await apiSave(code, tqId, answersRef.current[tqId] ?? null);
          const out = saveOutcome(r);
          if (out === 'finish') { void finish(true); return; } // срок вышел или запуск закрыт — сдаём то, что сохранено
          // Часы сервера на границе старта ещё «до начала»: ответ не записан — повторяем, не сдаём
          if (out === 'retry') {
            if (++waits > SAVE_WAIT_MAX_TRIES || doneRef.current) { flag('failed', tqId, true); return; } // остаётся «не сохранено», повтор по таймеру
            await new Promise((res) => setTimeout(res, SAVE_WAIT_RETRY_MS));
            continue;
          }
          if (out === 'keep') { flag('failed', tqId, true); return; } // остаётся «не сохранено»
          flag('failed', tqId, false);
          if ((ver.current[tqId] ?? 0) === v) { markUnsaved(tqId, false); flag('saved', tqId, true); setNotice(''); return; }
        }
      } catch (e) {
        if (e instanceof ExamApiError && e.status === 401) setNotice(tRef.current.sessionExpired);
        else if (e instanceof ExamApiError && !e.retryable) { markUnsaved(tqId, false); setNotice(examErrorText(e, lang)); }
        // сеть: остаётся «не сохранено», повтор по таймеру
        else flag('failed', tqId, true);
      } finally {
        flying.current.delete(tqId);
      }
      })();
    flying.current.set(tqId, p);
    return p;
  }, [code, lang, finish]);

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => { const m = timers.current; return () => m.forEach(clearTimeout); }, []);

  // deferred — набор числа: ответ учитывается сразу, на сервер уходит после паузы (или по blur)
  const onAnswer = (tqId: string, a: Answer, deferred = false) => {
    const next = { ...answersRef.current, [tqId]: a };
    answersRef.current = next;
    setAnswers(next);
    ver.current[tqId] = (ver.current[tqId] ?? 0) + 1;
    markUnsaved(tqId, true);
    flag('saved', tqId, false);
    flag('failed', tqId, false);
    clearTimeout(timers.current.get(tqId));
    timers.current.delete(tqId);
    if (deferred) timers.current.set(tqId, setTimeout(() => { timers.current.delete(tqId); void send(tqId); }, 700));
    else void send(tqId);
  };

  // Таймер
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  // Авто-сдача только когда по часам сервера время вышло. Времени сервера нет — сначала спрашиваем сервер (open), он же сдаёт просроченную попытку.
  const expired = left <= 0;
  useEffect(() => {
    if (!expired) return;
    const tick = async () => {
      if (getServerOffset() !== null) { void finish(true); return; }
      try {
        const v = await apiOpen(code);
        if (v.state === 'finished' && !doneRef.current) { doneRef.current = true; onFinishedRef.current(v.attempt); }
      } catch { /* повторим по таймеру */ }
    };
    void tick();
    const t = setInterval(() => void tick(), RETRY_MS);
    return () => clearInterval(t);
  }, [expired, finish, code]);

  // Повтор неотправленных ответов
  useEffect(() => {
    if (unsaved.size === 0) return;
    const t = setInterval(() => { for (const id of unsavedRef.current) void send(id); }, RETRY_MS);
    return () => clearInterval(t);
  }, [unsaved.size, send]);

  // Полный экран на время билета (Telegram 8.0+; на компьютере и в старых версиях просто не включится), подтверждение
  // при закрытии и без жеста «смахнуть вниз» — меньше случайных выходов. При переходе в полный экран страница может
  // на миг потерять фокус: первые секунды такие сигналы уходом не считаем (quietUntil)
  const quietUntil = useRef(0);
  useEffect(() => {
    const tg = tgApp();
    const modern = (v: string) => { try { return tg?.isVersionAtLeast?.(v) === true; } catch { return false; } };
    const safe = (fn: (() => void) | undefined) => { try { fn?.call(tg); } catch { /* в этой версии Telegram метода нет */ } };
    const quiet = () => { quietUntil.current = Date.now() + 2500; };
    const fs = modern('8.0');
    if (fs) { quiet(); safe(tg?.requestFullscreen); tg?.onEvent?.('fullscreenChanged', quiet); }
    if (modern('6.2')) safe(tg?.enableClosingConfirmation);
    if (modern('7.7')) safe(tg?.disableVerticalSwipes);
    return () => {
      if (fs) { tg?.offEvent?.('fullscreenChanged', quiet); if (tg?.isFullscreen) safe(tg?.exitFullscreen); }
      if (modern('6.2')) safe(tg?.disableClosingConfirmation);
      if (modern('7.7')) safe(tg?.enableVerticalSwipes);
    };
  }, []);

  // Уход со страницы (свернули Telegram, другое окно или приложение поверх): сообщаем серверу, преподаватель видит это в таблице
  const [awayCount, setAwayCount] = useState(0);
  const [awayInfo, setAwayInfo] = useState<AwayRules | undefined>(away); // счётчики правила — с сервера
  useEffect(() => {
    const report = async (isAway: boolean, ms?: number) => {
      const r = await apiFocus(code, isAway, ms);
      if (r.away) setAwayInfo(r.away);
      // Третий выход или больше допустимого времени вне страницы: сервер закрыл билет — дальше ничего не шлём
      if (r.closed && !doneRef.current) { doneRef.current = true; onAwayClosedRef.current(); }
      return r;
    };
    const reporter = createAwayReporter(report, {
      isRetryable: (e) => !(e instanceof ExamApiError) || e.retryable,
    });
    let flags = { ...NO_FOCUS_FLAGS, hidden: document.hidden };
    if (isAway(flags)) reporter.leave(); else reporter.arrive();
    const on = (s: FocusSignal) => () => {
      // Переход в полный экран: кратковременная потеря фокуса — не уход
      if ((s === 'hidden' || s === 'blur' || s === 'inactive') && Date.now() < quietUntil.current) return;
      const was = isAway(flags);
      flags = applyFocusSignal(flags, s);
      // Страница снова видна и фокус уже у неё: отдельное событие focus приходит не во всех приложениях
      if ((s === 'visible' || s === 'active') && document.hasFocus()) flags = applyFocusSignal(flags, 'focus');
      const away = isAway(flags);
      if (away && !was) reporter.leave();
      else if (!away && was) { reporter.back(); setAwayCount(reporter.count); }
    };
    const onVisibility = () => on(document.hidden ? 'hidden' : 'visible')();
    const onHidden = on('hidden'), onBlur = on('blur'), onFocus = on('focus'), onTouch = on('touch');
    const onInactive = on('inactive'), onActive = on('active');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHidden);
    window.addEventListener('pageshow', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pointerdown', onTouch, true);
    window.addEventListener('keydown', onTouch, true);
    const tg = tgApp();
    tg?.onEvent?.('deactivated', onInactive);
    tg?.onEvent?.('activated', onActive);
    return () => {
      reporter.stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHidden);
      window.removeEventListener('pageshow', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pointerdown', onTouch, true);
      window.removeEventListener('keydown', onTouch, true);
      tg?.offEvent?.('deactivated', onInactive);
      tg?.offEvent?.('activated', onActive);
    };
  }, [code]);

  // Запрет копирования: выделение отключено стилями (.exam-nocopy), а копирование, вырезание, перетаскивание и меню
  // по долгому нажатию отменяются; каждая попытка уходит на сервер. Снимок экрана страница запретить не может
  const [copyCount, setCopyCount] = useState(0);
  useEffect(() => {
    const guard = createCopyGuard(() => { void apiCopy(code).catch(() => undefined); });
    const onCopy = (e: Event) => {
      if (isEditable(e.target as HTMLElement | null)) return; // в клетках ответа меню и выделение нужны ученику
      e.preventDefault();
      if (doneRef.current) return;
      if (guard.hit()) setCopyCount(guard.count);
    };
    const onDrag = (e: Event) => e.preventDefault();
    for (const ev of COPY_EVENTS) document.addEventListener(ev, onCopy, true);
    document.addEventListener('dragstart', onDrag, true);
    return () => {
      for (const ev of COPY_EVENTS) document.removeEventListener(ev, onCopy, true);
      document.removeEventListener('dragstart', onDrag, true);
    };
  }, [code]);

  useEffect(() => {
    document.getElementById(`strip-${pos}`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
    window.scrollTo({ top: 0 });
  }, [pos]);

  useEffect(() => { setSkipWarn(false); }, [pos]);

  // «Далее». Без возврата к вопросам: сначала дожидаемся сохранения ответа (потом сервер его уже не примет),
  // о вопросе без ответа предупреждаем один раз, затем сообщаем серверу новый номер вопроса
  const goNext = async () => {
    if (pos >= nav.length - 1) { setConfirm(true); return; }
    const nextPos = stepNav(nav.length, pos, 1);
    if (!noBack) { setPos(nextPos); return; }
    const cur = questions[nav[pos]];
    if (timers.current.has(cur.tqId)) { clearTimeout(timers.current.get(cur.tqId)); timers.current.delete(cur.tqId); void send(cur.tqId); }
    if (unsavedRef.current.has(cur.tqId)) {
      await Promise.race([flying.current.get(cur.tqId) ?? send(cur.tqId), new Promise((r) => setTimeout(r, 3000))]);
      if (unsavedRef.current.has(cur.tqId)) { setNotice(tRef.current.noBackUnsaved); return; }
    }
    if (!isAnsweredQ(cur.snapshot.type, answersRef.current[cur.tqId]) && !skipWarn) { setSkipWarn(true); return; }
    void apiAdvance(code, nav[nextPos]).catch(() => undefined);
    setPos(nextPos);
  };

  const qi = nav[pos];
  const q = qi === undefined ? undefined : questions[qi];
  const last = pos >= nav.length - 1;
  const unanswered = total - answered;
  return (
    <div className="exam-app exam-nocopy" style={{ paddingBottom: 100 }}>
      <div className="exam-bar" style={{ flexWrap: 'wrap' }}>
        <span className={`timer${left < 60_000 ? ' low' : ''}`}>{formatRemaining(left)}</span>
        <span className="count">
          {t.progress(pos + 1, total, answered)}
          {unsaved.size > 0 && (failed.size > 0
            ? <span className="unsaved"> · {t.unsavedCount(failed.size)}</span>
            : <span className="saving"> · {t.saving}</span>)}
        </span>
        <div className="exam-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
          <div style={{ width: `${Math.round(progressFraction(answered, total) * 100)}%` }} />
        </div>
        <div className="exam-strip">
          {nav.map((idx, p) => (
            <button
              key={questions[idx].tqId} id={`strip-${p}`} type="button" aria-label={t.questionAria(p + 1)}
              className={`${p === pos ? 'cur ' : ''}${isAnsweredQ(questions[idx].snapshot.type, answers[questions[idx].tqId]) ? 'done' : ''}`}
              disabled={noBack && p !== pos} onClick={() => setPos(p)}
            >{p + 1}</button>
          ))}
        </div>
      </div>

      {notice && <div className="exam-card lost">{notice}</div>}
      {awayInfo?.strict ? (
        <div className={`exam-card exam-rule${awayInfo.count > 0 || awayInfo.ms > 0 ? ' lost' : ''}`} role="status">
          <b>{t.awayRule(awayInfo.maxCount, Math.round(awayInfo.maxMs / 1000))}</b>
          <div className="hint">{t.awayUsed(awayInfo.count, awayInfo.maxCount, Math.min(Math.round(awayInfo.maxMs / 1000), Math.ceil(awayInfo.ms / 1000)), Math.round(awayInfo.maxMs / 1000))}</div>
        </div>
      ) : awayCount > 0 && (
        <div className="exam-card lost" role="status">
          {t.away(awayCount)}
        </div>
      )}
      {copyCount > 0 && <div className="exam-card lost" role="status">{t.copyBlocked(copyCount)}</div>}
      {noBack && <div className={`exam-card exam-rule${skipWarn ? ' lost' : ''}`} role="status">{skipWarn ? t.noBackSkip : t.noBackRule}</div>}

      {q && (
        <ExamQuestion
          key={q.tqId} snap={q.snapshot} n={pos + 1} lang={lang} prevPassageId={null}
          answer={answers[q.tqId]} saveState={saveStatus(q.tqId, unsaved, failed, saved)} onAnswer={(a, d) => onAnswer(q.tqId, a, d)}
          onEnter={() => void goNext()}
          openCells={openCellsFor(subject)} aiNotice
        />
      )}

      <div className="exam-nav">
        {!noBack && <button type="button" className="exam-btn ghost" disabled={pos === 0} onClick={() => setPos(stepNav(nav.length, pos, -1))}>{t.back}</button>}
        <button type="button" className={noBack ? 'exam-btn full' : 'exam-btn'} disabled={submitting} onClick={() => void goNext()}>{last ? t.submit : t.next}</button>
      </div>

      {/* Имя ученика поверх билета: снимок экрана показывает, чей он */}
      <div className="exam-wm" aria-hidden="true" style={{ backgroundImage: watermarkImage(watermarkText(studentName, code)) }} />

      {confirm && (
        <div className="exam-modal" onClick={() => !submitting && setConfirm(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 18 }}>{t.confirmTitle(unanswered)}</b>
            <div className="hint">{t.confirmHint(answered, total, unanswered)}</div>
            {notice && <div style={{ color: 'var(--bad)' }}>{notice}</div>}
            <button type="button" className="exam-btn" disabled={submitting} onClick={() => void finish(false)}>{submitting ? t.submitting : t.confirmYes}</button>
            <button type="button" className="exam-btn ghost" disabled={submitting} onClick={() => setConfirm(false)}>{t.confirmBack}</button>
          </div>
        </div>
      )}
    </div>
  );
}
