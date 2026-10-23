import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, TG_LIMITS, checkSettings, fitSettings, shortName } from '../../supabase/functions/_shared/ticketing';
import './tg.css';

// Telegram Mini App: сбор билетов. Данные и генерация — через Edge Function tg-app,
// подлинность пользователя подтверждается подписью initData.

interface Counts { test: number; matching: number; open: number }
interface TopicRow { id: string; name: string; counts: Counts }
interface ChapterRow { id: string; name: string; counts: Counts; topics: TopicRow[] }
interface Subject { id: string; name: string }
interface Limits { perType: number; tickets: number; total?: number; perDay: number | null }
interface HistoryBatch {
  id: string; title: string; created_at: string; subject_id: string;
  generation_params: {
    chapter_ids?: string[]; topic_ids?: string[]; ticket_count?: number;
    test_count?: number; matching_count?: number; open_count?: number;
    requested?: { test: number; matching: number; open: number };
    shuffle_options?: boolean; shuffle_matching?: boolean; lang?: Lang;
  };
  subject?: { name: string } | null;
}
interface Result { missingAnswers: number; keySent: boolean }
type Step = 'subject' | 'chapters' | 'topics' | 'counts' | 'final' | 'done';
type Lang = 'ru' | 'tg' | 'both';

interface WebApp {
  initData: string;
  ready(): void;
  expand(): void;
  close(): void;
  HapticFeedback?: { impactOccurred(s: string): void; notificationOccurred(s: string): void };
  MainButton: {
    setText(t: string): void; show(): void; hide(): void; enable(): void; disable(): void;
    showProgress(leaveActive?: boolean): void; hideProgress(): void;
    onClick(cb: () => void): void; offClick(cb: () => void): void;
  };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  onEvent?(e: string, cb: () => void): void;
  CloudStorage?: {
    getItem(key: string, cb: (err: unknown, value?: string) => void): void;
    setItem(key: string, value: string, cb?: (err: unknown) => void): void;
  };
}
const wa = (): WebApp | undefined => (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tg-app`;

class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function api<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tg-Init-Data': wa()?.initData ?? '' },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new ApiError('network', 'Нет связи с сервером. Проверьте интернет и повторите.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'error', data.message || data.error || `Ошибка ${res.status}`);
  return data as T;
}

// Дерево предмета на время сессии: повторный выбор предмета мгновенный, сбрасывается после генерации
const treeCache = new Map<string, Promise<ChapterRow[]>>();
function loadTree(subjectId: string): Promise<ChapterRow[]> {
  let p = treeCache.get(subjectId);
  if (!p) {
    p = api<{ chapters: ChapterRow[] }>('tree', { subjectId }).then((r) => r.chapters);
    treeCache.set(subjectId, p);
    p.catch(() => treeCache.delete(subjectId));
  }
  return p;
}

const total = (c: Counts) => c.test + c.matching + c.open;
const sum = (items: Counts[]): Counts => items.reduce((a, c) => ({ test: a.test + c.test, matching: a.matching + c.matching, open: a.open + c.open }), { test: 0, matching: 0, open: 0 });
const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// Последние настройки: облако Telegram (между устройствами), запасной вариант — localStorage
const PREFS_KEY = 'tg_prefs_v1';
interface Prefs { nums: { test: string; matching: string; open: string; tickets: string }; lang: Lang; title: string; shuffleOptions: boolean; shuffleMatching: boolean }

async function loadPrefs(): Promise<Partial<Prefs>> {
  let raw: string | null = null;
  const cs = wa()?.CloudStorage;
  if (cs) {
    raw = await new Promise<string | null>((resolve) => {
      const t = setTimeout(() => resolve(null), 1500);
      try { cs.getItem(PREFS_KEY, (e, v) => { clearTimeout(t); resolve(e ? null : v || null); }); } catch { clearTimeout(t); resolve(null); }
    });
  }
  if (!raw) { try { raw = localStorage.getItem(PREFS_KEY); } catch { /* недоступно */ } }
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function savePrefs(p: Prefs) {
  const raw = JSON.stringify(p);
  try { wa()?.CloudStorage?.setItem(PREFS_KEY, raw); } catch { /* ignore */ }
  try { localStorage.setItem(PREFS_KEY, raw); } catch { /* ignore */ }
}

function loadTelegramScript(): Promise<void> {
  if (wa()) return Promise.resolve();
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

// На некоторых мобильных клиентах Telegram initData может внедряться в WebView с задержкой в несколько миллисекунд
async function getTelegramAppWithRetry(maxWaitMs = 800): Promise<WebApp | undefined> {
  await loadTelegramScript();
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const app = wa();
    if (app?.initData) return app;
    await new Promise((r) => setTimeout(r, 60));
  }
  return wa();
}

function subjectIcon(name: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('хим')) return '🧪';
  if (n.includes('физ')) return '⚡';
  if (n.includes('биол')) return '🧬';
  if (n.includes('тадж') || n.includes('тоҷик') || n.includes('забон')) return '📖';
  if (n.includes('мат') || n.includes('алгебр') || n.includes('геом')) return '📐';
  if (n.includes('геогр')) return '🌍';
  if (n.includes('истор') || n.includes('таърих')) return '🏛️';
  if (n.includes('информ') || n.includes('комп')) return '💻';
  if (n.includes('англ') || n.includes('рус')) return '🌐';
  return '📚';
}

export default function TgApp() {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<{ code: string; message: string } | null>(null);
  const [name, setName] = useState('');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [step, setStep] = useState<Step>('subject');
  const [subject, setSubject] = useState<Subject | null>(null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [chapterIds, setChapterIds] = useState<string[]>([]);
  const [topicSel, setTopicSel] = useState<string[]>([]);
  const [nums, setNums] = useState({ test: '10', matching: '2', open: '3', tickets: '2' });
  const [lang, setLang] = useState<Lang>('ru');
  const [title, setTitle] = useState(DEFAULT_SETTINGS.title);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [shuffleMatching, setShuffleMatching] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [limits, setLimits] = useState<Limits>({ ...TG_LIMITS });
  const [history, setHistory] = useState<HistoryBatch[]>([]);
  const [result, setResult] = useState<Result | null>(null);

  // ---- загрузка ----
  useEffect(() => {
    (async () => {
      const app = await getTelegramAppWithRetry();
      app?.ready();
      app?.expand();
      if (!app?.initData) {
        setFatal({ code: 'bad_init_data', message: 'Откройте это приложение из Telegram — через бота.' });
        return;
      }
      try {
        const me = await api<{ name: string; subjects: Subject[]; limits: Limits }>('me');
        setName(me.name);
        setSubjects(me.subjects);
        // Админ без дневного лимита: perDay приходит как null (Infinity в JSON)
        setLimits({ ...me.limits, perDay: me.limits.perDay ?? null, total: me.limits.total ?? undefined });
        const prefs = await loadPrefs();
        if (prefs.nums) setNums((cur) => ({ ...cur, ...prefs.nums }));
        if (prefs.lang) setLang(prefs.lang);
        if (prefs.title) setTitle(prefs.title);
        if (typeof prefs.shuffleOptions === 'boolean') setShuffleOptions(prefs.shuffleOptions);
        if (typeof prefs.shuffleMatching === 'boolean') setShuffleMatching(prefs.shuffleMatching);
        api<{ batches: HistoryBatch[] }>('history').then((h) => {
          setHistory(h.batches);
          const last = h.batches.find((b) => me.subjects.some((s) => s.id === b.subject_id));
          if (last && me.subjects.length > 1) void loadTree(last.subject_id).catch(() => {});
        }).catch(() => {});
        // Остальные предметы грузятся в фоне, пока пользователь выбирает
        if (me.subjects.length > 1) me.subjects.forEach((s) => void loadTree(s.id).catch(() => {}));
        if (me.subjects.length === 1) await pickSubject(me.subjects[0], true);
        setReady(true);
      } catch (e) {
        const err = e as ApiError;
        setFatal({ code: err.code, message: err.message });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickSubject(s: Subject, auto = false, preset?: HistoryBatch) {
    setBusy(true);
    setError('');
    try {
      const ch = await loadTree(s.id);
      setSubject(s);
      setChapters(ch);
      if (preset) {
        // «Повторить»: те же главы, темы и настройки
        const p = preset.generation_params;
        const known = new Set(ch.flatMap((c) => c.topics.map((t) => t.id)));
        const chIds = (p.chapter_ids ?? []).filter((id) => ch.some((c) => c.id === id));
        const r = p.requested ?? { test: p.test_count ?? 0, matching: p.matching_count ?? 0, open: p.open_count ?? 0 };
        setChapterIds(chIds);
        setTopicSel((p.topic_ids ?? []).filter((id) => known.has(id)));
        setNums({ test: String(r.test), matching: String(r.matching), open: String(r.open), tickets: String(p.ticket_count ?? 2) });
        setTitle(preset.title || DEFAULT_SETTINGS.title);
        if (p.lang) setLang(p.lang);
        if (typeof p.shuffle_options === 'boolean') setShuffleOptions(p.shuffle_options);
        if (typeof p.shuffle_matching === 'boolean') setShuffleMatching(p.shuffle_matching);
        setStep(chIds.length ? 'counts' : 'chapters');
      } else {
        setChapterIds([]);
        setTopicSel([]);
        setStep('chapters');
      }
    } catch (e) {
      if (auto) throw e;
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ---- расчёты ----
  const selectedChapters = useMemo(() => chapters.filter((c) => chapterIds.includes(c.id)), [chapters, chapterIds]);

  // Итоговый набор тем: у главы без отметок берутся все её темы; ни одной отметки — [] (все вопросы глав)
  const topicIds = useMemo(() => {
    const ids: string[] = [];
    let any = false;
    for (const ch of selectedChapters) {
      const sel = ch.topics.filter((t) => topicSel.includes(t.id));
      if (sel.length) any = true;
      ids.push(...(sel.length ? sel : ch.topics).map((t) => t.id));
    }
    return any ? ids : [];
  }, [selectedChapters, topicSel]);

  const pool: Counts = useMemo(() => {
    if (topicIds.length) return sum(selectedChapters.flatMap((c) => c.topics).filter((t) => topicIds.includes(t.id)).map((t) => t.counts));
    return sum(selectedChapters.map((c) => c.counts));
  }, [selectedChapters, topicIds]);

  const settings = useMemo(() => ({
    testCount: parseInt(nums.test, 10) || 0,
    matchingCount: parseInt(nums.matching, 10) || 0,
    openCount: parseInt(nums.open, 10) || 0,
    ticketCount: parseInt(nums.tickets, 10) || 0,
    shuffleOptions, shuffleMatching,
    title: title.trim() || DEFAULT_SETTINGS.title,
  }), [nums, shuffleOptions, shuffleMatching, title]);

  const settingsError = checkSettings(settings, limits);
  const fit = useMemo(() => fitSettings({ total: total(pool), ...pool }, settings), [pool, settings]);

  // Светофор пула вопросов в Telegram (Traffic Light)
  const healthStats = useMemo(() => {
    const testPer = settings.testCount;
    const matchingPer = settings.matchingCount;
    const openPer = settings.openCount;
    const tickets = settings.ticketCount;

    if (testPer + matchingPer + openPer === 0 || tickets <= 0) return null;

    const maxTestVariants = testPer > 0 ? Math.floor(pool.test / testPer) : Infinity;
    const maxMatchingVariants = matchingPer > 0 ? Math.floor(pool.matching / matchingPer) : Infinity;
    const maxOpenVariants = openPer > 0 ? Math.floor(pool.open / openPer) : Infinity;

    const safeVariants = Math.min(maxTestVariants, maxMatchingVariants, maxOpenVariants);
    const effectiveSafe = safeVariants === Infinity ? 0 : safeVariants;

    const bottlenecks: string[] = [];
    if (testPer > 0 && maxTestVariants < tickets) {
      bottlenecks.push(`тестовых (хватит на ${maxTestVariants})`);
    }
    if (matchingPer > 0 && maxMatchingVariants < tickets) {
      bottlenecks.push(`соответствий (хватит на ${maxMatchingVariants})`);
    }
    if (openPer > 0 && maxOpenVariants < tickets) {
      bottlenecks.push(`открытых (хватит на ${maxOpenVariants})`);
    }

    if (effectiveSafe >= tickets) {
      return {
        status: 'green' as const,
        title: `Отлично: хватает на ${effectiveSafe} вар. без повторов`,
        desc: `Вы запросили ${tickets} вар. Все вопросы будут уникальными.`,
      };
    } else if (effectiveSafe > 0) {
      return {
        status: 'yellow' as const,
        title: `Внимание: без повторов хватит на ${effectiveSafe} вар.`,
        desc: `Узкое место: ${bottlenecks.join(', ')}. Вопросы начнут повторяться.`,
      };
    } else {
      return {
        status: 'red' as const,
        title: `Недостаточно вопросов в выбранных темах`,
        desc: bottlenecks.length ? `Дефицит: ${bottlenecks.join(', ')}.` : 'Нет вопросов требуемых типов.',
      };
    }
  }, [pool, settings]);

  // Навигатор шагов (Step Indicator / Breadcrumbs)
  const stepsList: Array<{ id: Step; label: string }> = useMemo(() => {
    return subjects.length > 1
      ? [
          { id: 'subject', label: 'Предмет' },
          { id: 'chapters', label: 'Главы' },
          { id: 'topics', label: 'Темы' },
          { id: 'counts', label: 'Состав билета' },
          { id: 'final', label: 'Параметры' },
        ]
      : [
          { id: 'chapters', label: 'Главы' },
          { id: 'topics', label: 'Темы' },
          { id: 'counts', label: 'Состав билета' },
          { id: 'final', label: 'Параметры' },
        ];
  }, [subjects.length]);

  const curStepIdx = stepsList.findIndex((s) => s.id === step);

  // ---- навигация ----
  const back = useCallback(() => {
    setError('');
    setStep((s) => {
      if (s === 'chapters') return subjects.length > 1 ? 'subject' : s;
      if (s === 'topics') return 'chapters';
      if (s === 'counts') return 'topics';
      if (s === 'final') return 'counts';
      return s;
    });
  }, [subjects.length]);

  const submit = useCallback(async () => {
    if (!subject) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<Result>('generate', {
        subjectId: subject.id, chapterIds, topicIds, lang,
        settings,
      });
      wa()?.HapticFeedback?.notificationOccurred('success');
      savePrefs({ nums, lang, title, shuffleOptions, shuffleMatching });
      treeCache.clear();
      setResult(r);
      setStep('done');
    } catch (e) {
      wa()?.HapticFeedback?.notificationOccurred('error');
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [subject, chapterIds, topicIds, lang, settings, nums, title, shuffleOptions, shuffleMatching]);

  // Прислать файл набора из истории ещё раз (в лимит генераций не засчитывается)
  const resend = useCallback(async (b: HistoryBatch) => {
    setBusy(true);
    setError('');
    try {
      const r = await api<Result>('resend', { batchId: b.id, lang: b.generation_params.lang ?? 'ru' });
      wa()?.HapticFeedback?.notificationOccurred('success');
      setResult(r);
      setStep('done');
    } catch (e) {
      wa()?.HapticFeedback?.notificationOccurred('error');
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const next = useCallback(() => {
    setError('');
    if (step === 'chapters') {
      if (!chapterIds.length) return setError('Выберите хотя бы одну главу');
      setStep('topics');
    } else if (step === 'topics') {
      setStep('counts');
    } else if (step === 'counts') {
      if (settingsError) return setError(settingsError);
      if (fit.error) return setError(fit.error);
      setStep('final');
    } else if (step === 'final') {
      void submit();
    } else if (step === 'done') {
      wa()?.close();
    }
  }, [step, chapterIds.length, settingsError, fit.error, submit]);

  // Кнопки Telegram: MainButton ведёт вперёд, BackButton — назад
  const nextRef = useRef(next);
  nextRef.current = next;
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    const app = wa();
    if (!app) return;
    const onMain = () => nextRef.current();
    const onBack = () => backRef.current();
    app.MainButton.onClick(onMain);
    app.BackButton.onClick(onBack);
    return () => {
      app.MainButton.offClick(onMain);
      app.BackButton.offClick(onBack);
    };
  }, []);

  useEffect(() => {
    const app = wa();
    if (!app || !ready) return;
    const labels: Partial<Record<Step, string>> = {
      chapters: 'Далее', topics: 'Далее', counts: 'Далее', final: 'Создать и отправить', done: 'Закрыть',
    };
    const label = labels[step];
    if (!label) app.MainButton.hide();
    else {
      app.MainButton.setText(label);
      app.MainButton.show();
      const blocked = (step === 'chapters' && !chapterIds.length) || (step === 'counts' && (!!settingsError || !!fit.error));
      if (blocked || busy) app.MainButton.disable(); else app.MainButton.enable();
    }
    if (busy) app.MainButton.showProgress(true); else app.MainButton.hideProgress();
    const canBack = (step === 'chapters' && subjects.length > 1) || step === 'topics' || step === 'counts' || step === 'final';
    if (canBack) app.BackButton.show(); else app.BackButton.hide();
  }, [step, ready, busy, chapterIds.length, settingsError, fit.error, subjects.length]);

  // ---- экраны ----
  if (fatal) {
    const isBadInit = fatal.code === 'bad_init_data';
    const isNotLinked = fatal.code === 'not_linked';
    return (
      <Shell>
        <div className="tg-card" style={{ textAlign: 'center', padding: '32px 16px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>
            {isNotLinked ? '🔐' : isBadInit ? '📱' : '⚠️'}
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
            {isNotLinked ? 'Нужна привязка аккаунта' : isBadInit ? 'Вход через Telegram' : 'Не удалось войти'}
          </h1>
          <p style={{ color: 'var(--tg-theme-hint-color, #64748b)', fontSize: '14px', lineHeight: 1.5, marginBottom: '24px' }}>
            {isBadInit
              ? 'Чтобы открыть конструктор билетов, перейдите в чат с ботом и нажмите синюю кнопку «🚀 Конструктор» в левом нижнем углу или отправьте команду /app.'
              : fatal.message}
          </p>
          <a
            href="https://t.me/testgenerrepbot"
            className="tg-btn tg-btn-primary"
            style={{ display: 'inline-block', textDecoration: 'none', padding: '12px 24px', borderRadius: '12px', fontWeight: 600 }}
          >
            💬 Открыть чат с ботом
          </a>
        </div>
      </Shell>
    );
  }
  if (!ready) return <Shell><p className="tg-hint">Загрузка…</p></Shell>;

  const count = (c: Counts) => `${c.test} / ${c.matching} / ${c.open}`;

  return (
    <Shell>
      {step !== 'done' && curStepIdx !== -1 && (
        <div className="tg-nav">
          <div className="tg-nav-head">
            <span className="tg-nav-badge">Шаг {curStepIdx + 1} из {stepsList.length}</span>
            <span className="tg-nav-title">{stepsList[curStepIdx].label}</span>
          </div>
          <div className="tg-progress-track">
            <div
              className="tg-progress-fill"
              style={{ width: `${Math.round(((curStepIdx + 1) / stepsList.length) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {error && <div className="tg-error" role="alert">{error}</div>}

      {step === 'subject' && (
        <>
          <h1>Предмет</h1>
          <p className="tg-hint">{name ? `Вы вошли как ${name}.` : ''} Выберите предмет.</p>
          <Recent history={history} subjects={subjects} busy={busy} onRepeat={(b) => pickSubject(subjects.find((s) => s.id === b.subject_id)!, false, b)} onResend={resend} />
          {subjects.map((s) => (
            <button
              key={s.id}
              className="tg-row tg-subject-row"
              disabled={busy}
              onClick={() => {
                wa()?.HapticFeedback?.impactOccurred('light');
                pickSubject(s);
              }}
            >
              <span className="tg-subject-icon">{subjectIcon(s.name)}</span>
              <span className="tg-grow" style={{ fontWeight: 600 }}>{shortName(s.name, 80)}</span>
              <span className="tg-chev">›</span>
            </button>
          ))}
        </>
      )}

      {step === 'chapters' && (
        <>
          <h1>Главы</h1>
          <p className="tg-hint">{shortName(subject?.name ?? '', 60)} · цифры: тесты / соответствия / открытые</p>
          <Recent history={history} subjects={subjects} busy={busy} onRepeat={(b) => pickSubject(subjects.find((s) => s.id === b.subject_id)!, false, b)} onResend={resend} />
          <div className="tg-actions">
            <button className="tg-link" onClick={() => setChapterIds(chapters.map((c) => c.id))}>Все</button>
            <button className="tg-link" onClick={() => setChapterIds([])}>Сбросить</button>
          </div>
          {chapters.map((c) => (
            <label key={c.id} className={`tg-row tg-check ${chapterIds.includes(c.id) ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={chapterIds.includes(c.id)}
                onChange={() => {
                  wa()?.HapticFeedback?.impactOccurred('light');
                  setChapterIds(toggle(chapterIds, c.id));
                }}
              />
              <span className="tg-grow">{shortName(c.name, 80)}</span>
              <span className="tg-badge">{count(c.counts)}</span>
            </label>
          ))}
        </>
      )}

      {step === 'topics' && (
        <>
          <h1>Темы</h1>
          <p className="tg-hint">Ничего не отмечено в главе — берутся все её темы.</p>
          {selectedChapters.map((c) => (
            <section key={c.id}>
              <h2>{shortName(c.name, 70)}</h2>
              {c.topics.length > 0 && (
                <div className="tg-actions">
                  <button className="tg-link" onClick={() => setTopicSel([...topicSel.filter((id) => !c.topics.some((t) => t.id === id)), ...c.topics.map((t) => t.id)])}>Выбрать все</button>
                  <button className="tg-link" onClick={() => setTopicSel(topicSel.filter((id) => !c.topics.some((t) => t.id === id)))}>Снять выделение</button>
                </div>
              )}
              {c.topics.length === 0 && <p className="tg-hint">В главе нет тем — берутся все вопросы главы.</p>}
              {c.topics.map((t, i) => (
                <label key={t.id} className={`tg-row tg-check ${topicSel.includes(t.id) ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={topicSel.includes(t.id)}
                    onChange={() => {
                      wa()?.HapticFeedback?.impactOccurred('light');
                      setTopicSel(toggle(topicSel, t.id));
                    }}
                  />
                  <span className="tg-grow">{i + 1}. {shortName(t.name, 80)}</span>
                  <span className="tg-badge">{count(t.counts)}</span>
                </label>
              ))}
            </section>
          ))}
          <p className="tg-pool">В пуле: тестов {pool.test}, соответствий {pool.matching}, открытых {pool.open}</p>
        </>
      )}

      {step === 'counts' && (
        <>
          <h1>Состав билета</h1>

          {/* Быстрые пресеты стандартов */}
          <div className="tg-presets">
            <div className="tg-presets-head">
              <span>Быстрый стандарт:</span>
              <span style={{ fontWeight: 500, opacity: 0.65 }}>1 тап</span>
            </div>
            <div className="tg-presets-grid">
              <button
                type="button"
                className={`tg-preset-btn ${nums.test === '18' && nums.matching === '2' && nums.open === '7' ? 'on' : ''}`}
                onClick={() => {
                  wa()?.HapticFeedback?.impactOccurred('medium');
                  setNums((cur) => ({ ...cur, test: '18', matching: '2', open: '7' }));
                }}
              >
                <span className="tg-preset-title">🧪 Физ / Хим</span>
                <span className="tg-preset-sub">18 + 2 + 7 (27 в.)</span>
              </button>
              <button
                type="button"
                className={`tg-preset-btn ${nums.test === '20' && nums.matching === '4' && nums.open === '2' ? 'on' : ''}`}
                onClick={() => {
                  wa()?.HapticFeedback?.impactOccurred('medium');
                  setNums((cur) => ({ ...cur, test: '20', matching: '4', open: '2' }));
                }}
              >
                <span className="tg-preset-title">🧬 Био / Гос</span>
                <span className="tg-preset-sub">20 + 4 + 2 (26 в.)</span>
              </button>
            </div>
          </div>

          <Stepper label="Тесты" value={nums.test} have={pool.test} max={limits.perType} min={0} onChange={(v) => setNums({ ...nums, test: v })} />
          <Stepper label="Соответствия" value={nums.matching} have={pool.matching} max={limits.perType} min={0} onChange={(v) => setNums({ ...nums, matching: v })} />
          <Stepper label="Открытые" value={nums.open} have={pool.open} max={limits.perType} min={0} onChange={(v) => setNums({ ...nums, open: v })} />
          <Stepper label="Вариантов (билетов)" value={nums.tickets} max={limits.tickets} min={1} onChange={(v) => setNums({ ...nums, tickets: v })} />
          <div className="tg-chips">
            {(limits.tickets <= 4 ? [1, 2, 4] : [1, 2, 4, 10, 20, 50])
              .filter((n) => n <= limits.tickets)
              .map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`tg-chip ${nums.tickets === String(n) ? 'on' : ''}`}
                  onClick={() => {
                    wa()?.HapticFeedback?.impactOccurred('light');
                    setNums({ ...nums, tickets: String(n) });
                  }}
                >
                  {n} вар.
                </button>
              ))}
          </div>

          {/* Светофор пула вопросов (Traffic Light) */}
          {healthStats && (
            <div className={`tg-health ${healthStats.status}`}>
              <div className="tg-health-dot" />
              <div>
                <div className="tg-health-title">{healthStats.title}</div>
                <div className="tg-health-desc">{healthStats.desc}</div>
              </div>
            </div>
          )}

          <p className="tg-hint">Лимиты: до {limits.tickets} вариантов за раз{limits.total ? `, до ${limits.total} вопросов в билете` : ''}.</p>
          {settingsError && <div className="tg-warn">{settingsError}</div>}
          {!settingsError && fit.error && <div className="tg-warn">{fit.error}</div>}
          {!settingsError && !fit.error && fit.notes.length > 0 && (
            <div className="tg-warn">
              Вопросов не хватает — возьмём сколько есть:
              <ul>{fit.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          )}
        </>
      )}

      {step === 'final' && (
        <>
          <h1>Язык и параметры</h1>
          <div className="tg-seg">
            {([['ru', 'Русский'], ['tg', 'Тоҷикӣ'], ['both', 'Оба']] as Array<[Lang, string]>).map(([v, l]) => (
              <button
                key={v}
                type="button"
                className={lang === v ? 'on' : ''}
                onClick={() => {
                  wa()?.HapticFeedback?.impactOccurred('light');
                  setLang(v);
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <label className="tg-field">
            <span>Название</span>
            <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="tg-row tg-check">
            <input
              type="checkbox"
              checked={shuffleOptions}
              onChange={(e) => {
                wa()?.HapticFeedback?.impactOccurred('light');
                setShuffleOptions(e.target.checked);
              }}
            />
            <span className="tg-grow">Перемешать варианты ответов</span>
          </label>
          <label className="tg-row tg-check">
            <input
              type="checkbox"
              checked={shuffleMatching}
              onChange={(e) => {
                wa()?.HapticFeedback?.impactOccurred('light');
                setShuffleMatching(e.target.checked);
              }}
            />
            <span className="tg-grow">Перемешать соответствия</span>
          </label>
          <p className="tg-hint">
            Тестов {fit.settings.testCount}, соответствий {fit.settings.matchingCount}, открытых {fit.settings.openCount} · билетов {settings.ticketCount}.
            Файл придёт в чат с ботом.{limits.perDay ? ` Лимит: ${limits.perDay} генераций в сутки.` : ''}
          </p>
        </>
      )}

      {step === 'done' && (
        <div className="tg-card">
          <div className="tg-done-hero">
            <div className="tg-done-icon">✓</div>
            <h1 className="tg-done-title">Билеты готовы!</h1>
            <p className="tg-done-sub">
              Файл с билетами {result?.keySent ? 'и ключи ответов ' : ''}успешно сформированы и отправлены в ваш чат с ботом.
            </p>
          </div>

          <div className="tg-done-summary">
            {subject && (
              <div className="tg-done-row">
                <span className="tg-done-label">Предмет</span>
                <span className="tg-done-val">{subjectIcon(subject.name)} {subject.name}</span>
              </div>
            )}
            <div className="tg-done-row">
              <span className="tg-done-label">Вариантов</span>
              <span className="tg-done-val">{settings.ticketCount}</span>
            </div>
            <div className="tg-done-row">
              <span className="tg-done-label">Вопросов в билете</span>
              <span className="tg-done-val">
                {fit.settings.testCount + fit.settings.matchingCount + fit.settings.openCount} ({fit.settings.testCount} тест, {fit.settings.matchingCount} соотв., {fit.settings.openCount} откр.)
              </span>
            </div>
            <div className="tg-done-row">
              <span className="tg-done-label">Язык</span>
              <span className="tg-done-val">{lang === 'ru' ? 'Русский' : lang === 'tg' ? 'Тоҷикӣ' : 'RU + TJ'}</span>
            </div>
          </div>

          {!!result?.missingAnswers && (
            <div className="tg-warn">
              В базе нет верного ответа у вопросов: {result.missingAnswers}. В ключах эти клетки отмечены красным.
            </div>
          )}

          <button
            type="button"
            className="tg-btn-primary"
            onClick={() => {
              wa()?.HapticFeedback?.impactOccurred('medium');
              wa()?.close();
            }}
          >
            💬 Открыть чат с ботом
          </button>

          <button
            type="button"
            className="tg-btn-secondary"
            onClick={() => {
              wa()?.HapticFeedback?.impactOccurred('light');
              setResult(null);
              setStep(subjects.length > 1 ? 'subject' : 'chapters');
            }}
          >
            🔄 Создать ещё один набор
          </button>
        </div>
      )}
    </Shell>
  );
}

function Recent(p: { history: HistoryBatch[]; subjects: Subject[]; busy: boolean; onRepeat: (b: HistoryBatch) => void; onResend: (b: HistoryBatch) => void }) {
  const items = p.history.filter((b) => p.subjects.some((s) => s.id === b.subject_id)).slice(0, 4);
  if (!items.length) return null;
  return (
    <section>
      <h2>Повторить прошлый набор</h2>
      {items.map((b) => {
        const subjName = b.subject?.name ?? '';
        return (
          <React.Fragment key={b.id}>
            <button
              type="button"
              className="tg-row"
              disabled={p.busy}
              onClick={() => {
                wa()?.HapticFeedback?.impactOccurred('light');
                p.onRepeat(b);
              }}
            >
              <span className="tg-subject-icon">{subjectIcon(subjName)}</span>
              <span className="tg-grow">
                {shortName(b.title, 50)}
                <span className="tg-sub">
                  {new Date(b.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {b.generation_params.ticket_count ?? '?'} шт. · {shortName(subjName, 30)}
                </span>
              </span>
              <span className="tg-chev">↻</span>
            </button>
            <button
              type="button"
              className="tg-link"
              disabled={p.busy}
              onClick={() => {
                wa()?.HapticFeedback?.impactOccurred('light');
                p.onResend(b);
              }}
            >
              Прислать файл ещё раз
            </button>
          </React.Fragment>
        );
      })}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.body.classList.add('tg-body');
    return () => document.body.classList.remove('tg-body');
  }, []);
  return <main className="tg-app">{children}</main>;
}

function Stepper(p: { label: string; value: string; have?: number; min: number; max: number; onChange: (v: string) => void }) {
  const n = parseInt(p.value, 10);
  const set = (v: number) => {
    wa()?.HapticFeedback?.impactOccurred('light');
    p.onChange(String(Math.min(p.max, Math.max(p.min, v))));
  };
  const short = p.have !== undefined && Number.isFinite(n) && n > p.have;
  return (
    <div className="tg-step">
      <div className="tg-step-head">
        <span>{p.label}</span>
        {p.have !== undefined && <span className={`tg-badge ${short ? 'warn' : ''}`}>В пуле: {p.have}</span>}
      </div>
      <div className="tg-stepper">
        <button type="button" onClick={() => set((Number.isFinite(n) ? n : 0) - 1)} aria-label="Меньше">−</button>
        <input
          inputMode="numeric"
          value={p.value}
          onChange={(e) => p.onChange(e.target.value.replace(/\D/g, '').slice(0, 3))}
          onBlur={() => set(Number.isFinite(n) ? n : p.min)}
        />
        <button type="button" onClick={() => set((Number.isFinite(n) ? n : 0) + 1)} aria-label="Больше">+</button>
      </div>
    </div>
  );
}
