import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from 'lucide-react';
import { FormattedText } from './FormulaEditor';
import { isEmptySnapshot, TYPE_LABEL } from '../lib/questionSwap';

// Предпросмотр билета справа: открывается по нажатию на вариант, ширину можно тянуть мышью или развернуть на весь экран.
// Показывает снимок вопроса так же, как он попадёт в Word (варианты A–D, соответствие A–D ↔ 1–5).

export interface PreviewTicket {
  id: string;
  ticket_number: number;
  questions: Array<{ id: string; question_snapshot: any }>;
}

const MIN_W = 360;
const DEFAULT_W = 560;
const DOCK_FROM = 1280; // с этой ширины окна страница сдвигается, а не перекрывается
const LS_W = 'examiner_preview_w';
const LS_LANG = 'examiner_preview_lang';
const LS_KEYS = 'examiner_preview_answers';

const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* память недоступна */ } };

type Lang = 'ru' | 'tg';
const pickText = (o: any, lang: Lang, prefix: 'content' | 'text' = 'text'): string => {
  if (!o) return '';
  const ru = prefix === 'content' ? o.content_ru : o.text_ru;
  const tg = prefix === 'content' ? o.content_tg : o.text_tg;
  const base = o[prefix] ?? '';
  return (lang === 'tg' ? tg || base : ru || base) || '';
};
const byOrder = (a: any, b: any) => (a.order_index || 0) - (b.order_index || 0);
const OPTION_LETTERS = 'ABCDEFGH';

const QuestionView: React.FC<{ snap: any; n: number; lang: Lang; showAnswers: boolean; prevPassageId: string | null }> = ({ snap, n, lang, showAnswers, prevPassageId }) => {
  if (isEmptySnapshot(snap)) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 text-red-800 px-3 py-2 text-sm">
        <b>{n}.</b> Пустое место — нужен вопрос ({TYPE_LABEL[snap.type as keyof typeof TYPE_LABEL] ?? snap.type})
      </div>
    );
  }
  const passage = snap.passage && snap.passage.id !== prevPassageId ? snap.passage : null;
  const options = [...(snap.options || [])].sort(byOrder);
  const left = (snap.matching_items || []).filter((m: any) => m.side === 'left').sort(byOrder);
  const right = (snap.matching_items || []).filter((m: any) => m.side === 'right').sort(byOrder);
  const content = pickText(snap, lang, 'content');

  return (
    <div className="space-y-2">
      {passage && (
        <div className="rounded-xl bg-slate-100 border border-slate-200 p-3 text-sm leading-relaxed space-y-1">
          {passage.title && <div className="font-bold text-slate-900">{passage.title}</div>}
          <div className="whitespace-pre-line text-slate-800"><FormattedText text={passage.content || ''} /></div>
        </div>
      )}
      <div className="flex gap-2 text-[15px] leading-relaxed text-slate-900">
        <b className="shrink-0 text-slate-500 tabular-nums">{n}.</b>
        <div className="min-w-0 break-words font-medium">{content ? <FormattedText text={content} /> : <span className="text-slate-500 italic">без условия</span>}</div>
      </div>
      {snap.image_url && <img src={snap.image_url} alt="" loading="lazy" className="max-h-72 max-w-full rounded-xl border border-slate-200 bg-white object-contain" />}

      {snap.type === 'test' && (
        <ul className="grid gap-1.5 sm:grid-cols-2 pl-6 text-sm">
          {options.map((o: any, i: number) => {
            const ok = showAnswers && o.is_correct;
            return (
              <li key={o.id ?? i} className={`flex gap-2 items-start rounded-lg border px-2.5 py-1.5 ${ok ? 'border-success-line bg-success-soft' : 'border-slate-200 bg-white'}`}>
                <b className={`shrink-0 ${ok ? 'text-success' : 'text-slate-500'}`}>{OPTION_LETTERS[i]})</b>
                <span className="min-w-0 break-words space-y-1">
                  {pickText(o, lang) && <span className="block"><FormattedText text={pickText(o, lang)} /></span>}
                  {o.image_url && <img src={o.image_url} alt="" loading="lazy" className="max-h-24 rounded border border-slate-200 bg-white object-contain" />}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {snap.type === 'matching' && (
        <div className="grid grid-cols-2 gap-2 pl-6 text-sm">
          <ul className="space-y-1.5">
            {left.map((l: any, i: number) => {
              const target = right.findIndex((r: any) => r.id === l.correct_match_id);
              return (
                <li key={l.id ?? i} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 break-words">
                  <b className="text-slate-500 mr-1">{OPTION_LETTERS[i]})</b><FormattedText text={pickText(l, lang)} />
                  {l.image_url && <img src={l.image_url} alt="" loading="lazy" className="mt-1 max-h-20 rounded border border-slate-200 bg-white object-contain" />}
                  {showAnswers && target >= 0 && <span className="block text-xs font-semibold text-success mt-0.5">Ответ: {target + 1}</span>}
                </li>
              );
            })}
          </ul>
          <ul className="space-y-1.5">
            {right.map((r: any, i: number) => (
              <li key={r.id ?? i} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 break-words">
                <b className="text-slate-500 mr-1">{i + 1})</b><FormattedText text={pickText(r, lang)} />
                {r.image_url && <img src={r.image_url} alt="" loading="lazy" className="mt-1 max-h-20 rounded border border-slate-200 bg-white object-contain" />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {snap.type === 'open' && showAnswers && snap.correct_numeric_answer != null && snap.correct_numeric_answer !== '' && (
        <p className="pl-6 text-sm font-semibold text-success">Ответ: {String(snap.correct_numeric_answer)}</p>
      )}
    </div>
  );
};

export const TicketPreviewPanel: React.FC<{
  tickets: PreviewTicket[];
  ticketId: string;
  title?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}> = ({ tickets, ticketId, title, onSelect, onClose }) => {
  const index = tickets.findIndex((t) => t.id === ticketId);
  const ticket = tickets[index];
  const [width, setWidth] = useState(() => Math.max(MIN_W, Number(safeGet(LS_W)) || DEFAULT_W));
  const [full, setFull] = useState(false);
  const [lang, setLang] = useState<Lang>(() => (safeGet(LS_LANG) === 'tg' ? 'tg' : 'ru'));
  const [showAnswers, setShowAnswers] = useState(() => safeGet(LS_KEYS) === '1');
  const bodyRef = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Esc закрывает панель, но не мешает окну замены вопроса (оно закрывается своим Esc)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Вариант пропал из набора (например, набор перечитали) — закрываем
  useEffect(() => { if (!ticket) onClose(); }, [ticket, onClose]);

  // Новый вариант — читать с начала
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [ticketId]);

  const panelW = full ? vw : Math.min(width, vw);
  const docked = !full && vw >= DOCK_FROM;
  // Широкий экран: сдвигаем страницу, чтобы панель её не закрывала
  useLayoutEffect(() => {
    if (!docked) return;
    const prev = document.body.style.paddingRight;
    document.body.style.paddingRight = `${panelW}px`;
    return () => { document.body.style.paddingRight = prev; };
  }, [docked, panelW]);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setWidth(Math.min(Math.max(MIN_W, window.innerWidth - ev.clientX), window.innerWidth - 80));
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      setWidth((w) => { safeSet(LS_W, String(Math.round(w))); return w; });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  if (!ticket) return null;
  const hasTg = tickets.some((t) => t.questions.some((q) => q.question_snapshot?.content_tg));
  const effLang: Lang = hasTg ? lang : 'ru';
  const prev = tickets[index - 1];
  const next = tickets[index + 1];

  const btn = 'w-9 h-9 shrink-0 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center';

  return createPortal(
    <aside
      role="complementary"
      aria-label={`Предпросмотр: вариант ${ticket.ticket_number}`}
      style={{ width: panelW }}
      className="fixed inset-y-0 right-0 z-[90] max-w-full flex flex-col bg-white border-l border-slate-200 shadow-2xl"
    >
      {!full && (
        <div
          onPointerDown={startResize}
          onDoubleClick={() => setWidth(DEFAULT_W)}
          title="Потяните, чтобы изменить ширину (двойной щелчок — вернуть)"
          className="absolute left-0 inset-y-0 w-2 -translate-x-1/2 cursor-col-resize hidden sm:block hover:bg-indigo-400/40 active:bg-indigo-500/50 touch-none"
        />
      )}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100">
        <button className={btn} onClick={() => prev && onSelect(prev.id)} disabled={!prev} aria-label="Предыдущий вариант"><ChevronLeft className="w-5 h-5" /></button>
        <div className="min-w-0 flex-1 text-center leading-tight">
          <div className="font-bold text-slate-900 text-sm">Вариант {ticket.ticket_number} <span className="font-normal text-slate-500">· {index + 1} из {tickets.length}</span></div>
          {title && <div className="text-xs text-slate-500 truncate">{title}</div>}
        </div>
        <button className={btn} onClick={() => next && onSelect(next.id)} disabled={!next} aria-label="Следующий вариант"><ChevronRight className="w-5 h-5" /></button>
        <button className={btn} onClick={() => setFull((f) => !f)} aria-label={full ? 'Вернуть размер' : 'Развернуть на весь экран'} title={full ? 'Вернуть размер' : 'На весь экран'}>
          {full ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <button className={btn} onClick={onClose} aria-label="Закрыть предпросмотр"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b border-slate-100 text-sm">
        {hasTg && (
          <div className="flex gap-1 p-0.5 bg-slate-100 rounded-lg" role="group" aria-label="Язык">
            {(['ru', 'tg'] as const).map((l) => (
              <button
                key={l}
                aria-pressed={effLang === l}
                onClick={() => { setLang(l); safeSet(LS_LANG, l); }}
                className={`min-h-[32px] px-3 rounded-md font-semibold ${effLang === l ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-600'}`}
              >{l === 'tg' ? 'TJ' : 'RU'}</button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 min-h-[32px] text-slate-700 cursor-pointer">
          <input type="checkbox" checked={showAnswers} onChange={(e) => { setShowAnswers(e.target.checked); safeSet(LS_KEYS, e.target.checked ? '1' : '0'); }} className="w-4 h-4 accent-indigo-600" />
          Показать ответы
        </label>
      </div>

      <div ref={bodyRef} className="flex-1 overflow-y-auto p-4 space-y-5">
        {ticket.questions.map((tq, i) => (
          <QuestionView
            key={tq.id}
            snap={tq.question_snapshot}
            n={i + 1}
            lang={effLang}
            showAnswers={showAnswers}
            prevPassageId={i > 0 ? ticket.questions[i - 1].question_snapshot?.passage?.id ?? null : null}
          />
        ))}
      </div>
    </aside>,
    document.body,
  );
};
