import React, { useEffect, useRef, useState } from 'react';
import { EXAM_POLL_MS } from '../../supabase/functions/_shared/exam';
import { apiOpen, getServerOffset, type LobbyResponse, type OpenResponse } from './api';
import { lobbyView, waitText } from './examLogic';

const FAST_POLL_MS = 500; // цифры дошли до нуля, а сервер ещё отвечает «отсчёт»

/** Зал ожидания: крупный номер варианта, опрос сервера, отсчёт 3-2-1 по серверному времени. Когда сервер отдал билет (или закрыл), передаёт ответ наверх. */
export function ExamLobby({ code, initial, onLeave }: { code: string; initial: LobbyResponse; onLeave: (v: OpenResponse) => void }) {
  const [view, setView] = useState<LobbyResponse>(initial);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(Date.now());
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  const viewRef = useRef(view);
  viewRef.current = view;
  const lv = lobbyView(view, getServerOffset() ?? 0, now);
  const fastRef = useRef(false);
  fastRef.current = lv.kind === 'run'; // отсчёт по нашим часам закончился — спрашиваем билет чаще

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      let delay = fastRef.current ? FAST_POLL_MS : EXAM_POLL_MS;
      // идёт отсчёт: спросим сервер ровно к моменту старта, а не через полный интервал
      const startsAt = (viewRef.current.attempt as { startsAt?: string } | undefined)?.startsAt;
      if (viewRef.current.state === 'countdown' && startsAt) {
        const left = Date.parse(startsAt) - (Date.now() + (getServerOffset() ?? 0));
        if (Number.isFinite(left)) delay = Math.min(delay, Math.max(0, left) + 100);
      }
      timer = setTimeout(poll, delay);
    };
    const poll = async () => {
      try {
        const v = await apiOpen(code);
        if (!alive) return;
        setOffline(false);
        if (v.state === 'waiting' || v.state === 'countdown') setView(v);
        else { onLeaveRef.current(v); return; }
      } catch {
        if (alive) setOffline(true); // экран не сбрасываем, пробуем снова
      }
      if (alive) next();
    };
    next();
    return () => { alive = false; clearTimeout(timer); };
  }, [code]);

  return (
    <div className="exam-app exam-lobby" aria-live="polite">
      {lv.kind === 'countdown' ? (
        <div key={lv.digit} className="lobby-count">{lv.digit}</div>
      ) : (
        <>
          <div className="lobby-title">{view.title || 'Билет'}</div>
          <div className="lobby-label">Ваш вариант</div>
          <div className="lobby-digit">{view.attempt?.ticketNumber ?? '—'}</div>
          <div className="lobby-wait">{lv.kind === 'run' ? 'Начинаем!' : waitText(view)}</div>
        </>
      )}
      <div className="lobby-offline">{offline ? 'Нет связи, пробуем снова…' : ''}</div>
    </div>
  );
}
