import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExamApiError, apiSave, apiSubmit } from './api';
import { ExamQuestion } from './ExamQuestion';
import { countAnswered, formatRemaining, remainingMs, type Answer, type Answers, type ExamQ, type Lang } from './examLogic';

const RETRY_MS = 4000;

/** Экран билета: все вопросы подряд, сверху таймер, счётчик и «Сдать». Каждый ответ сразу уходит на сервер. */
export function ExamTicket({ code, lang, minutes, deadline, questions, initialAnswers, onFinished }: {
  code: string; lang: Lang; minutes: number; deadline: string; questions: ExamQ[]; initialAnswers: Answers;
  onFinished: (r: { score: number; max: number }) => void;
}) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [unsaved, setUnsaved] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());

  const answersRef = useRef(answers);
  const ver = useRef<Record<string, number>>({});
  const flying = useRef(new Set<string>());
  const submittingRef = useRef(false);
  const doneRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  // Срок задаёт сервер; часы телефона могут уходить, поэтому остаток не больше длительности билета
  const left = Math.min(remainingMs(deadline, 0, now), minutes * 60_000);
  const { answered, total } = useMemo(() => countAnswered(questions, answers), [questions, answers]);

  const markUnsaved = (tqId: string, on: boolean) =>
    setUnsaved((prev) => {
      if (prev.has(tqId) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(tqId); else next.delete(tqId);
      return next;
    });

  const finish = useCallback(async (auto: boolean) => {
    if (submittingRef.current || doneRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice('');
    try {
      // Сначала дослать то, что не успело сохраниться (одна попытка), затем сдать
      for (const tqId of Object.keys(ver.current)) {
        if (!unsavedRef.current.has(tqId)) continue;
        try { await apiSave(code, tqId, answersRef.current[tqId] ?? null); } catch { /* сервер сдаст с тем, что сохранено */ }
      }
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

  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;

  const send = useCallback(async (tqId: string) => {
    if (flying.current.has(tqId) || doneRef.current) return;
    flying.current.add(tqId);
    try {
      for (;;) {
        const v = ver.current[tqId] ?? 0;
        const r = await apiSave(code, tqId, answersRef.current[tqId] ?? null);
        if (!r.ok) { void finish(true); return; } // срок вышел или запуск закрыт — сдаём то, что сохранено
        if ((ver.current[tqId] ?? 0) === v) { markUnsaved(tqId, false); setNotice(''); return; }
      }
    } catch (e) {
      if (e instanceof ExamApiError && !e.retryable) { markUnsaved(tqId, false); setNotice(e.message); }
      // сеть: остаётся «не сохранено», повтор по таймеру
    } finally {
      flying.current.delete(tqId);
    }
  }, [code, finish]);

  const onAnswer = (tqId: string, a: Answer) => {
    const next = { ...answersRef.current, [tqId]: a };
    answersRef.current = next;
    setAnswers(next);
    ver.current[tqId] = (ver.current[tqId] ?? 0) + 1;
    markUnsaved(tqId, true);
    void send(tqId);
  };

  // Таймер
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const expired = left <= 0;
  useEffect(() => {
    if (!expired) return;
    void finish(true);
    const t = setInterval(() => void finish(true), RETRY_MS); // сдача не прошла (сеть) — повторяем
    return () => clearInterval(t);
  }, [expired, finish]);

  // Повтор неотправленных ответов
  useEffect(() => {
    if (unsaved.size === 0) return;
    const t = setInterval(() => { for (const id of unsavedRef.current) void send(id); }, RETRY_MS);
    return () => clearInterval(t);
  }, [unsaved.size, send]);

  let prevPassage: string | null = null;
  return (
    <div className="exam-app">
      <div className="exam-bar">
        <span className={`timer${left < 60_000 ? ' low' : ''}`}>{formatRemaining(left)}</span>
        <span className="count">
          отвечено {answered} из {total}
          {unsaved.size > 0 && <span className="unsaved"> · не сохранено: {unsaved.size}</span>}
        </span>
        <button type="button" className="exam-btn small" disabled={submitting} onClick={() => setConfirm(true)}>Сдать</button>
      </div>

      {notice && <div className="exam-card lost">{notice}</div>}

      {questions.map((q, i) => {
        const snap = q.snapshot;
        const node = (
          <ExamQuestion
            key={q.tqId} snap={snap} n={i + 1} lang={lang} prevPassageId={prevPassage}
            answer={answers[q.tqId]} unsaved={unsaved.has(q.tqId)} onAnswer={(a) => onAnswer(q.tqId, a)}
          />
        );
        prevPassage = snap?.passage?.id ?? null;
        return node;
      })}

      <button type="button" className="exam-btn full" style={{ marginTop: 16 }} disabled={submitting} onClick={() => setConfirm(true)}>Сдать билет</button>

      {confirm && (
        <div className="exam-modal" onClick={() => !submitting && setConfirm(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 18 }}>Сдать билет?</b>
            <div className="hint">
              Отвечено {answered} из {total}.{answered < total ? ' Вопросы без ответа получат 0 баллов.' : ''} После сдачи изменить ответы нельзя.
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
