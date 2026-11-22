import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExamApiError, apiOpen, apiSave, apiSubmit, getServerOffset } from './api';
import { ExamQuestion } from './ExamQuestion';
import { isAnswered as isAnsweredQ, saveOutcome, SAVE_WAIT_MAX_TRIES, SAVE_WAIT_RETRY_MS } from './examLogic';
import { countAnswered, firstUnansweredPos, formatRemaining, navIndexes, progressFraction, remainingMs, stepNav, type Answer, type Answers, type ExamQ, type Lang } from './examLogic';

const RETRY_MS = 4000;

/** Экран билета: все вопросы подряд, сверху таймер, счётчик и «Сдать». Каждый ответ сразу уходит на сервер. */
export function ExamTicket({ code, lang, deadline, questions, initialAnswers, onFinished }: {
  code: string; lang: Lang; deadline: string; questions: ExamQ[]; initialAnswers: Answers;
  onFinished: (r: { score: number; max: number }) => void;
}) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [unsaved, setUnsaved] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const nav = useMemo(() => navIndexes(questions), [questions]);
  const [pos, setPos] = useState(() => firstUnansweredPos(questions, initialAnswers));

  const answersRef = useRef(answers);
  const unsavedRef = useRef(unsaved);
  const ver = useRef<Record<string, number>>({});
  const flying = useRef(new Map<string, Promise<void>>()); // сохранения в полёте: сдача ждёт их
  const submittingRef = useRef(false);
  const doneRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

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
      setNotice(e instanceof ExamApiError ? e.message : 'Не удалось сдать билет. Повторите.');
      if (auto) setConfirm(false);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [code]);

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
            if (++waits > SAVE_WAIT_MAX_TRIES || doneRef.current) return; // остаётся «не сохранено», повтор по таймеру
            await new Promise((res) => setTimeout(res, SAVE_WAIT_RETRY_MS));
            continue;
          }
          if (out === 'keep') return; // остаётся «не сохранено»
          if ((ver.current[tqId] ?? 0) === v) { markUnsaved(tqId, false); setNotice(''); return; }
        }
      } catch (e) {
        if (e instanceof ExamApiError && e.status === 401) setNotice('Сессия Telegram устарела: ответ не сохранён. Закройте страницу и откройте ссылку на билет заново.');
        else if (e instanceof ExamApiError && !e.retryable) { markUnsaved(tqId, false); setNotice(e.message); }
        // сеть: остаётся «не сохранено», повтор по таймеру
      } finally {
        flying.current.delete(tqId);
      }
      })();
    flying.current.set(tqId, p);
    return p;
  }, [code, finish]);

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => { const m = timers.current; return () => m.forEach(clearTimeout); }, []);

  // deferred — набор числа: ответ учитывается сразу, на сервер уходит после паузы (или по blur)
  const onAnswer = (tqId: string, a: Answer, deferred = false) => {
    const next = { ...answersRef.current, [tqId]: a };
    answersRef.current = next;
    setAnswers(next);
    ver.current[tqId] = (ver.current[tqId] ?? 0) + 1;
    markUnsaved(tqId, true);
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

  useEffect(() => {
    document.getElementById(`strip-${pos}`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
    window.scrollTo({ top: 0 });
  }, [pos]);

  const qi = nav[pos];
  const q = qi === undefined ? undefined : questions[qi];
  const last = pos >= nav.length - 1;
  const unanswered = total - answered;
  return (
    <div className="exam-app" style={{ paddingBottom: 100 }}>
      <div className="exam-bar" style={{ flexWrap: 'wrap' }}>
        <span className={`timer${left < 60_000 ? ' low' : ''}`}>{formatRemaining(left)}</span>
        <span className="count">
          Вопрос {pos + 1} из {total} · отвечено {answered}
          {unsaved.size > 0 && <span className="unsaved"> · не сохранено: {unsaved.size}</span>}
        </span>
        <div className="exam-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
          <div style={{ width: `${Math.round(progressFraction(answered, total) * 100)}%` }} />
        </div>
        <div className="exam-strip">
          {nav.map((idx, p) => (
            <button
              key={questions[idx].tqId} id={`strip-${p}`} type="button" aria-label={`Вопрос ${p + 1}`}
              className={`${p === pos ? 'cur ' : ''}${isAnsweredQ(questions[idx].snapshot.type, answers[questions[idx].tqId]) ? 'done' : ''}`}
              onClick={() => setPos(p)}
            >{p + 1}</button>
          ))}
        </div>
      </div>

      {notice && <div className="exam-card lost">{notice}</div>}

      {q && (
        <ExamQuestion
          key={q.tqId} snap={q.snapshot} n={pos + 1} lang={lang} prevPassageId={null}
          answer={answers[q.tqId]} unsaved={unsaved.has(q.tqId)} onAnswer={(a, d) => onAnswer(q.tqId, a, d)}
        />
      )}

      <div className="exam-nav">
        <button type="button" className="exam-btn ghost" disabled={pos === 0} onClick={() => setPos(stepNav(nav.length, pos, -1))}>Назад</button>
        <button type="button" className="exam-btn" disabled={submitting} onClick={() => (last ? setConfirm(true) : setPos(stepNav(nav.length, pos, 1)))}>{last ? 'Сдать' : 'Далее'}</button>
      </div>

      {confirm && (
        <div className="exam-modal" onClick={() => !submitting && setConfirm(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 18 }}>{unanswered > 0 ? `Не отвечено: ${unanswered}. Сдать?` : 'Сдать билет?'}</b>
            <div className="hint">
              Отвечено {answered} из {total}.{unanswered > 0 ? ' Вопросы без ответа получат 0 баллов.' : ''} После сдачи изменить ответы нельзя.
            </div>
            {notice && <div style={{ color: 'var(--bad)' }}>{notice}</div>}
            <button type="button" className="exam-btn" disabled={submitting} onClick={() => void finish(false)}>{submitting ? 'Сдаём…' : 'Да, сдать'}</button>
            <button type="button" className="exam-btn ghost" disabled={submitting} onClick={() => setConfirm(false)}>Вернуться к билету</button>
          </div>
        </div>
      )}
    </div>
  );
}
