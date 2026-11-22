import React, { useCallback, useEffect, useState } from 'react';
import { ExamApiError, apiOpen, apiReview, apiStart, waitTelegram, type OpenResponse } from './api';
import { ExamTicket } from './ExamTicket';
import { langName } from '../lib/examView';
import { ReviewQuestion } from './ExamQuestion';
import { nameOk, reviewFailureKind, reviewMistakes, type Lang, type ReviewItem } from './examLogic';
import './exam.css';

// Страница ученика /tg/exam?c=КОД[&review=1]: билет внутри Telegram. Отдельный экран, к мини-приложению преподавателя отношения не имеет.

type Screen =
  | { kind: 'loading' }
  | { kind: 'message'; title: string; text?: string; retry?: boolean; onRetry?: () => void; back?: Screen }
  | { kind: 'view'; view: OpenResponse }
  | { kind: 'result'; score: number; max: number; review: boolean; lang: Lang; title: string; note?: string }
  | { kind: 'review'; lang: Lang; title: string; items: ReviewItem[]; back?: Screen };

const params = new URLSearchParams(window.location.search);
const CODE = (params.get('c') ?? '').trim().toUpperCase();
const WANT_REVIEW = params.get('review') === '1';

function Message({ title, text, onRetry, onBack }: { title: string; text?: string; onRetry?: () => void; onBack?: () => void }) {
  return (
    <div className="exam-app exam-center">
      <div className="big">{title}</div>
      {text && <div className="hint">{text}</div>}
      {onRetry && <button type="button" className="exam-btn" onClick={onRetry}>Повторить</button>}
      {onBack && <button type="button" className="exam-btn ghost" onClick={onBack}>Назад к результату</button>}
    </div>
  );
}

function NameForm({ view, onStart }: { view: OpenResponse; onStart: (name: string, lang: Lang) => Promise<void> }) {
  const [name, setName] = useState('');
  const [lang, setLang] = useState<Lang>('ru');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!nameOk(name) || busy) return;
    setBusy(true); setErr('');
    try { await onStart(name.replace(/\s+/g, ' ').trim(), lang); } catch (e) { setErr(e instanceof Error ? e.message : 'Ошибка'); setBusy(false); }
  };
  return (
    <div className="exam-app">
      <h1>{view.title || 'Билет'}</h1>
      <div className="hint">{view.subject ? `${view.subject}. ` : ''}На прохождение {view.minutes} минут, попытка одна. Таймер пойдёт после нажатия «Начать».</div>
      <div className="exam-card">
        <label htmlFor="exam-name" style={{ fontWeight: 700 }}>Фамилия и имя</label>
        <input
          id="exam-name" className="exam-input" style={{ marginTop: 8 }} value={name} maxLength={80} autoComplete="name"
          placeholder="Например, Расулов Алишер" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
        <div role="radiogroup" aria-label="Язык билета" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {(['ru', 'tg'] as const).map((l) => (
            <button
              key={l} type="button" role="radio" aria-checked={lang === l}
              className={lang === l ? 'exam-btn full' : 'exam-btn ghost full'} onClick={() => setLang(l)}
            >{langName(l)}</button>
          ))}
        </div>
        {err && <div style={{ color: 'var(--bad)', marginTop: 8 }}>{err}</div>}
        <button type="button" className="exam-btn full" style={{ marginTop: 12 }} disabled={!nameOk(name) || busy} onClick={() => void submit()}>
          {busy ? 'Начинаем…' : 'Начать билет'}
        </button>
      </div>
    </div>
  );
}

function ReviewScreen({ title, lang, items, onBack }: { title: string; lang: Lang; items: ReviewItem[]; onBack?: () => void }) {
  const mistakes = reviewMistakes(items);
  let prev: string | null = null;
  return (
    <div className="exam-app">
      {onBack && <button type="button" className="exam-btn ghost" onClick={onBack}>Назад к результату</button>}
      <h1>Разбор{title ? `: ${title}` : ''}</h1>
      {mistakes.length === 0 && <div className="exam-card"><b>Ошибок нет</b></div>}
      {mistakes.map(({ n, item }) => {
        const node = <ReviewQuestion key={item.tqId} snap={item.snapshot} n={n} lang={lang} prevPassageId={prev} answer={item.answer} points={item.points} max={item.max} />;
        prev = item.snapshot?.passage?.id ?? null;
        return node;
      })}
    </div>
  );
}

const errText = (e: unknown) => (e instanceof ExamApiError ? e.message : 'Что-то пошло не так. Повторите.');

export default function ExamApp() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });

  useEffect(() => {
    document.body.classList.add('exam-body');
    return () => document.body.classList.remove('exam-body');
  }, []);

  // back — экран результата: с него пришли (или к нему возвращаем, если разбор недоступен)
  const showReview = useCallback(async (lang: Lang, title: string, back: Extract<Screen, { kind: 'result' }>) => {
    try {
      const r = await apiReview(CODE);
      setScreen({ kind: 'review', lang, title, items: r.questions, back });
    } catch (e) {
      const kind = reviewFailureKind(e);
      if (kind === 'not_ready') {
        setScreen({ ...back, review: false, note: 'Разбор пока не отправлен: он появится, когда преподаватель его отправит.' });
      } else if (kind === 'retry') {
        setScreen({ kind: 'message', title: 'Не удалось загрузить разбор', text: errText(e), onRetry: () => { setScreen({ kind: 'loading' }); void showReview(lang, title, back); }, back });
      } else {
        setScreen({ kind: 'message', title: 'Разбор недоступен', text: errText(e), back });
      }
    }
  }, []);

  const apply = useCallback((view: OpenResponse) => {
    if (view.state === 'finished') {
      const result: Extract<Screen, { kind: 'result' }> = { kind: 'result', score: view.attempt.score, max: view.attempt.max, review: view.attempt.review, lang: view.lang, title: view.title };
      if (WANT_REVIEW) { void showReview(view.lang, view.title, result); return; }
      setScreen(result);
      return;
    }
    setScreen({ kind: 'view', view });
  }, [showReview]);

  const load = useCallback(async () => {
    setScreen({ kind: 'loading' });
    const app = await waitTelegram();
    if (!app?.initData) { setScreen({ kind: 'message', title: 'Откройте ссылку в Telegram', text: 'Билет проходят внутри Telegram: нажмите на ссылку от преподавателя в боте.' }); return; }
    app.ready(); app.expand();
    if (!CODE) { setScreen({ kind: 'message', title: 'Неверная ссылка', text: 'В ссылке нет кода билета. Попросите преподавателя прислать ссылку заново.' }); return; }
    try {
      apply(await apiOpen(CODE));
    } catch (e) {
      const notFound = e instanceof ExamApiError && e.status === 404;
      setScreen({ kind: 'message', title: notFound ? 'Билет не найден' : 'Не удалось открыть билет', text: errText(e), retry: e instanceof ExamApiError && e.retryable });
    }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  const onFinished = useCallback(async (r: { score: number; max: number }, lang: Lang, title: string) => {
    let review = false;
    try { const v = await apiOpen(CODE); if (v.state === 'finished') review = v.attempt.review; } catch { /* не критично */ }
    setScreen({ kind: 'result', score: r.score, max: r.max, review, lang, title });
  }, []);

  switch (screen.kind) {
    case 'loading':
      return <Message title="Загрузка…" />;
    case 'message':
      return <Message title={screen.title} text={screen.text} onRetry={screen.onRetry ?? (screen.retry ? () => void load() : undefined)} onBack={screen.back ? () => setScreen(screen.back!) : undefined} />;
    case 'result':
      return (
        <div className="exam-app exam-center">
          <div className="hint">Билет сдан</div>
          <div className="big">Вы набрали {screen.score} из {screen.max}</div>
          {screen.note && <div className="hint">{screen.note}</div>}
          {screen.review
            ? <button type="button" className="exam-btn" onClick={() => void showReview(screen.lang, screen.title, screen)}>Посмотреть разбор</button>
            : !screen.note && <div className="hint">Разбор ошибок появится, когда преподаватель его отправит.</div>}
        </div>
      );
    case 'review':
      return <ReviewScreen title={screen.title} lang={screen.lang} items={screen.items} onBack={screen.back ? () => setScreen(screen.back!) : undefined} />;
    case 'view': {
      const v = screen.view;
      if (v.state === 'closed') return <Message title="Приём ответов закрыт" text="Билет по этой ссылке закрыт. Спросите новую ссылку у преподавателя." />;
      if (v.state === 'new') {
        return <NameForm view={v} onStart={async (name, lang) => {
          const next = await apiStart(CODE, name, lang);
          if (next.state === 'closed') { setScreen({ kind: 'view', view: next }); return; }
          apply(next);
        }} />;
      }
      if (v.state === 'running') {
        return (
          <ExamTicket
            code={CODE} lang={v.lang} deadline={v.attempt.deadline}
            questions={v.attempt.questions} initialAnswers={v.attempt.answers}
            onFinished={(r) => void onFinished(r, v.lang, v.title)}
          />
        );
      }
      return null;
    }
  }
}
