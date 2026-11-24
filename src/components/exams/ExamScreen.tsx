import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Loader2, Maximize, Minimize } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { examAttemptsKey, examLinkKey, examUrl, fetchAttempts, fetchExamLink, fetchServerNow } from '../../lib/examLinks';
import { awayNowList, screenCounts, screenPhase, type AwayNow, type ScreenCounts, type ScreenPhase } from '../../lib/examScreen';
import { formatRemaining, serverOffset } from '../../exam/examLogic';
import { EXAM_POLL_MS } from '../../../supabase/functions/_shared/exam';

// Экран для показа классу (проектор, телевизор): /exam/screen/КОД. Открывает преподаватель в браузере, где он вошёл на сайт;
// данные читаются под его правами (RLS: автор запуска или главный админ), поэтому ученику по этому адресу ничего не видно.
// Только показ: начинает и закрывает запуск преподаватель в разделе «Билеты классу».

const CLOCK_SYNC_MS = 60_000;

function Center({ title, text, busy }: { title: string; text?: string; busy?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3 p-8 text-center">
      {busy && <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />}
      <div className="text-3xl font-extrabold text-slate-900">{title}</div>
      {text && <div className="text-lg text-slate-600 max-w-2xl">{text}</div>}
    </div>
  );
}

/** Не даёт экрану погаснуть, пока страница открыта */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let dead = false;
    const take = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (!wl || document.visibilityState !== 'visible') return;
        const l = await wl.request('screen');
        if (dead) { void l.release(); return; }
        lock = l;
      } catch { /* не поддерживается или запрещено */ }
    };
    void take();
    const onVisible = () => { if (document.visibilityState === 'visible') void take(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { dead = true; document.removeEventListener('visibilitychange', onVisible); lock?.release().catch(() => undefined); };
  }, []);
}

const ExamScreen: React.FC<{ code: string }> = ({ code }) => {
  const { user, isLoading: authLoading } = useAuth();
  useWakeLock();

  // «Сейчас» по часам сервера: отсчёт и таймер совпадают с тем, что видят ученики
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    const sync = async () => {
      const sentAt = Date.now();
      try {
        const server = await fetchServerNow();
        if (live && server != null) setOffset(serverOffset(server, sentAt, Date.now()));
      } catch { /* остаёмся на часах компьютера */ }
    };
    if (user) void sync();
    const t = setInterval(() => { if (user) void sync(); }, CLOCK_SYNC_MS);
    return () => { live = false; clearInterval(t); };
  }, [user]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const serverNow = now + offset;

  const linkQuery = useQuery({
    queryKey: examLinkKey(code),
    queryFn: () => fetchExamLink(code),
    enabled: Boolean(user),
    staleTime: 0,
    refetchInterval: (q) => (q.state.data && screenPhase(q.state.data, Date.now() + offset).kind === 'ended' ? false : EXAM_POLL_MS),
  });
  const link = linkQuery.data ?? null;
  const phase = link ? screenPhase(link, serverNow) : null;
  const ended = phase?.kind === 'ended';

  const attemptsQuery = useQuery({
    queryKey: examAttemptsKey(code),
    queryFn: () => fetchAttempts(code),
    enabled: Boolean(user && link),
    staleTime: 0,
    refetchInterval: ended ? false : EXAM_POLL_MS,
  });
  const attempts = attemptsQuery.data ?? [];

  const url = examUrl(code);
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!url) return;
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 640 }).then((d) => { if (live) setQr(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [url]);

  const [fs, setFs] = useState(false);
  useEffect(() => {
    const on = () => setFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  useEffect(() => {
    const prev = document.title;
    document.title = 'Билеты классу — экран';
    return () => { document.title = prev; };
  }, []);

  if (authLoading) return <Center title="Загрузка…" busy />;
  if (!user) return <Center title="Войдите на сайт" text="Экран открывается в браузере, где вы вошли на сайт: откройте раздел «Билеты классу» и нажмите «На экран» у нужного запуска." />;
  if (linkQuery.isLoading) return <Center title="Загрузка…" busy />;
  if (!link || !phase) {
    return linkQuery.isError
      ? <Center title="Нет связи с сервером" text="Проверьте интернет: экран обновится сам." />
      : <Center title="Запуск не найден" text="Запуск удалён или создан другим преподавателем. Откройте экран кнопкой «На экран» в разделе «Билеты классу»." />;
  }

  return (
    <ExamScreenView
      title={link.batch?.title ?? 'Билет'}
      subject={link.batch?.subject?.name ?? ''}
      phase={phase}
      counts={screenCounts(attempts, link, serverNow)}
      away={awayNowList(attempts, serverNow)}
      names={attempts.map((a) => ({ id: a.id, name: a.student_name }))}
      started={Boolean(link.session_start_at)}
      qr={qr}
      url={url}
      offline={linkQuery.isError || attemptsQuery.isError}
      fs={fs}
      onToggleFs={toggleFs}
    />
  );
};

export interface ExamScreenViewProps {
  title: string;
  subject: string;
  phase: ScreenPhase;
  counts: ScreenCounts;
  /** Кто сейчас не на странице билета */
  away: AwayNow[];
  /** Вошедшие ученики по порядку входа */
  names: Array<{ id: string; name: string }>;
  /** Сессия была начата (для экрана «закрыт») */
  started: boolean;
  qr: string;
  url: string;
  offline: boolean;
  fs: boolean;
  onToggleFs: () => void;
}

/** Сам экран: только показ по готовым данным */
export const ExamScreenView: React.FC<ExamScreenViewProps> = ({ title, subject, phase, counts, away, names, started, qr, url, offline, fs, onToggleFs }) => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-slate-200 bg-white">
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-extrabold truncate">{title}</div>
          {subject && <div className="text-base text-slate-600 truncate">{subject}</div>}
        </div>
        {offline && <div className="text-base font-semibold text-rose-700">Нет связи — данные могли устареть</div>}
        <button
          type="button" onClick={onToggleFs} aria-label={fs ? 'Выйти из полного экрана' : 'Во весь экран'}
          className="min-h-[44px] px-4 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          {fs ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          {fs ? 'Свернуть' : 'Во весь экран'}
        </button>
      </header>

      {phase.kind === 'waiting' && (
        <main className="flex-1 grid lg:grid-cols-2 gap-8 p-8 items-center">
          <section className="flex flex-col items-center gap-4 text-center">
            {qr && <img src={qr} alt="QR-код ссылки на билет" className="w-[min(60vh,38vw)] min-w-[220px] rounded-3xl border border-slate-200 bg-white p-3" />}
            <div className="text-2xl font-bold">Наведите камеру на QR-код и откройте билет в Telegram</div>
            {url && <code className="text-lg text-slate-600 break-all">{url.replace(/^https:\/\//, '')}</code>}
          </section>
          <section className="self-stretch flex flex-col gap-4">
            <div className="text-4xl font-extrabold">Вошли: <span className="text-indigo-700 tabular-nums">{counts.joined}</span></div>
            {counts.joined === 0
              ? <div className="text-xl text-slate-500">Пока никого. Имена появятся здесь, как только ученики войдут.</div>
              : (
                <ul className="flex flex-wrap gap-2 content-start overflow-y-auto">
                  {names.map((a) => (
                    <li key={a.id} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xl font-semibold">{a.name}</li>
                  ))}
                </ul>
              )}
            <div className="mt-auto text-lg text-slate-600">Ждём начала: время назначит преподаватель.</div>
          </section>
        </main>
      )}

      {(phase.kind === 'soon' || phase.kind === 'countdown') && (
        <main className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
          <div className="text-4xl font-extrabold">{phase.kind === 'soon' ? 'Скоро начнём…' : 'Начинаем!'}</div>
          {phase.kind === 'countdown' && (
            <div key={phase.digit} className="text-[40vh] leading-none font-extrabold text-indigo-600 tabular-nums">{phase.digit}</div>
          )}
        </main>
      )}

      {phase.kind === 'running' && (
        <main className="flex-1 grid lg:grid-cols-[3fr_2fr] gap-8 p-8">
          <section className="flex flex-col items-center justify-center gap-4 text-center">
            <div className="text-2xl font-semibold text-slate-600">Осталось</div>
            <div
              role="timer"
              className={`text-[min(22vw,38vh)] leading-none font-extrabold tabular-nums ${phase.leftMs < 60_000 ? 'text-rose-600' : 'text-slate-900'}`}
            >{formatRemaining(phase.leftMs)}</div>
            <div className="text-3xl font-bold">Сдали <span className="tabular-nums">{counts.finished}</span> из <span className="tabular-nums">{counts.joined}</span></div>
          </section>
          <section className="flex flex-col gap-4 min-h-0">
            {away.length === 0 ? (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-2xl font-bold text-emerald-800">Все на странице билета</div>
            ) : (
              <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 flex flex-col gap-3 min-h-0">
                <div className="text-2xl font-extrabold text-rose-700">Не на странице билета: <span className="tabular-nums">{away.length}</span></div>
                <ul className="flex flex-col gap-2 overflow-y-auto">
                  {away.map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-4 text-2xl font-semibold text-rose-900">
                      <span className="truncate">{a.name}</span>
                      <span className="tabular-nums">{a.clock}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {qr && (
              <div className="mt-auto flex items-center gap-4 text-lg text-slate-600">
                <img src={qr} alt="QR-код ссылки на билет" className="w-28 h-28 rounded-xl border border-slate-200 bg-white p-1" />
                <span>Опоздали? Войдите по QR-коду: время общее для всех.</span>
              </div>
            )}
          </section>
        </main>
      )}

      {phase.kind === 'ended' && (
        <main className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="text-[min(10vw,16vh)] leading-none font-extrabold">{phase.reason === 'time' ? 'Время вышло' : 'Билет закрыт'}</div>
          {started
            ? <div className="text-4xl font-bold text-slate-700">Работы приняты: <span className="tabular-nums">{counts.accepted}</span> из <span className="tabular-nums">{counts.joined}</span></div>
            : <div className="text-2xl text-slate-600">Запуск закрыт до начала.</div>}
        </main>
      )}
    </div>
  );
};

export default ExamScreen;
