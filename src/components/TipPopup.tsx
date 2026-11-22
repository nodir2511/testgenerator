import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTips } from '../hooks/useTip';
import {
  TIP_HOLE_PAD,
  TIP_POLL_MS,
  anchorKeys,
  pickTip,
  placeTip,
  readLastShown,
  readSessionShown,
  shouldShowTip,
  showTabButton,
  writeLastShown,
  writeSessionShown,
  type Rect,
  type SiteTip,
  type TipPlacement,
} from '../lib/tips';

// Подсказка «А вы знали?»: затемняет экран, оставляет «окно» вокруг места новой функции (якорь data-tip="…")
// и ведёт к нему стрелку от карточки. Правила показа и размещение — src/lib/tips.ts.
// Клики: вырез над якорем ничем не закрыт — якорь нажимается как обычно, а подсказка при этом закрывается;
// клик по затемнению, «Понятно», крестик и Esc тоже закрывают. Фокус подсказка не забирает.

/** Элемент действительно виден: есть размер, не скрыт стилями и не внутри скрытого родителя */
function isShown(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const anyEl = el as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  if (anyEl.checkVisibility && !anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  return getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"], [inert]');
}

/** Первый видимый элемент с этим ключом (пункт меню есть и в боковом, и в мобильном меню) */
function findAnchor(key: string): HTMLElement | null {
  const list = document.querySelectorAll<HTMLElement>(`[data-tip="${CSS.escape(key)}"]`);
  for (const el of Array.from(list)) if (isShown(el)) return el;
  return null;
}

const inViewport = (r: DOMRect) => r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** Отступы безопасной зоны (вырез и полоска «домой» на телефоне) */
function safeArea(): { top: number; bottom: number } {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const res = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return res;
}

export interface TipPopupProps {
  currentTab: string;
  canOpenTab: (tab: string) => boolean;
  goTab: (tab: string) => void;
  /** Открыто окно «Что нового» */
  newsOpen: boolean;
  /** Окно «Что нового» показывали в этот заход */
  newsShownThisSession: boolean;
  /** Открыта форма вопроса, меню «Ещё» и т. п. */
  blocked: boolean;
  gameOnly: boolean;
}

export const TipPopup: React.FC<TipPopupProps> = ({ currentTab, canOpenTab, goTab, newsOpen, newsShownThisSession, blocked, gameOnly }) => {
  const { user } = useAuth();
  const { tips, markSeen } = useTips(!gameOnly);
  const startedAt = useRef(Date.now());
  const [active, setActive] = useState<{ tip: SiteTip; el: HTMLElement } | null>(null);

  // Свежие значения для таймера
  const live = useRef({ tips, currentTab, newsOpen, newsShownThisSession, blocked, gameOnly, active });
  live.current = { tips, currentTab, newsOpen, newsShownThisSession, blocked, gameOnly, active };

  useEffect(() => {
    if (!user) return;
    const check = () => {
      const s = live.current;
      if (s.active || s.tips.length === 0) return;
      const now = Date.now();
      const allowed = shouldShowTip({
        now,
        startedAt: startedAt.current,
        lastShownAt: readLastShown(user.id),
        sessionShown: readSessionShown(),
        newsOpen: s.newsOpen,
        newsShownThisSession: s.newsShownThisSession,
        modalOpen: s.blocked || !!document.querySelector('[aria-modal="true"]'),
        tab: s.currentTab,
        gameOnly: s.gameOnly,
      });
      if (!allowed) return;
      const tip = pickTip(s.tips, (k) => !!findAnchor(k));
      if (!tip) return; // якоря нет на экране — подождём, показанной не отмечаем
      const el = anchorKeys(tip.target).map(findAnchor).find(Boolean) as HTMLElement;
      writeSessionShown();
      writeLastShown(user.id, now);
      markSeen(tip.id);
      if (!inViewport(el.getBoundingClientRect())) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      setActive({ tip, el });
    };
    // Смена раздела — проверяем вскоре после отрисовки, дальше — раз в ~2 с
    const first = window.setTimeout(check, 400);
    const timer = window.setInterval(check, TIP_POLL_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [user, currentTab, markSeen]);

  if (!active) return null;
  return (
    <TipOverlay
      key={active.tip.id}
      tip={active.tip}
      anchor={active.el}
      showTab={showTabButton(active.tip, currentTab, canOpenTab)}
      onShowTab={() => { if (active.tip.tab) goTab(active.tip.tab); setActive(null); }}
      onClose={() => setActive(null)}
    />
  );
};

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });

/** Затемнение с вырезом, рамка, стрелка и карточка */
export const TipOverlay: React.FC<{
  tip: SiteTip;
  anchor: HTMLElement;
  showTab: boolean;
  onShowTab: () => void;
  onClose: () => void;
}> = ({ tip, anchor, showTab, onShowTab, onClose }) => {
  const card = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect>(() => toRect(anchor.getBoundingClientRect()));
  const [vp, setVp] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null);
  const [entered, setEntered] = useState(false);
  const safe = useRef<{ top: number; bottom: number }>({ top: 0, bottom: 0 });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => { safe.current = safeArea(); }, []);

  // Пересчёт позиции: прокрутка, размер окна, размер якоря и карточки; якорь пропал — подсказка закрывается
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!anchor.isConnected || !isShown(anchor)) { closeRef.current(); return; }
      setRect(toRect(anchor.getBoundingClientRect()));
      setVp({ width: window.innerWidth, height: window.innerHeight });
      if (card.current) setCardSize({ width: 340, height: card.current.offsetHeight });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(anchor);
    if (card.current) ro?.observe(card.current);
    // Смена раздела и прочие перестройки страницы не дают событий прокрутки — проверяем и по таймеру
    const timer = window.setInterval(schedule, 400);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      window.clearInterval(timer);
    };
  }, [anchor]);

  // Esc и нажатие на сам якорь закрывают подсказку (нажатие на якорь при этом срабатывает как обычно)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    const onDown = (e: PointerEvent) => { if (e.target instanceof Node && anchor.contains(e.target)) closeRef.current(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [anchor]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const place: TipPlacement | null = cardSize
    ? placeTip(rect, { ...vp, safeTop: safe.current.top, safeBottom: safe.current.bottom }, cardSize)
    : null;
  const hole = { left: rect.left - TIP_HOLE_PAD, top: rect.top - TIP_HOLE_PAD, width: rect.width + 2 * TIP_HOLE_PAD, height: rect.height + 2 * TIP_HOLE_PAD };
  const holeRight = hole.left + hole.width, holeBottom = hole.top + hole.height;

  // Стрелка с лёгким изгибом: контрольная точка сдвинута поперёк линии
  let arrowPath = '';
  if (place) {
    const { from, to } = place.arrow;
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(18, len * 0.25);
    const cx = (from.x + to.x) / 2 - (dy / len) * bend, cy = (from.y + to.y) / 2 + (dx / len) * bend;
    arrowPath = `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
  }

  const titleId = `tip-title-${tip.id}`;
  const textId = `tip-text-${tip.id}`;
  const catcher = 'absolute pointer-events-auto';

  return createPortal(
    <div className="fixed inset-0 z-[60] pointer-events-none" data-tip-overlay="">
      {/* Затемнение вокруг выреза ловит клики («Понятно»); сам вырез клики пропускает к якорю */}
      <div className={catcher} style={{ left: 0, top: 0, right: 0, height: Math.max(0, hole.top) }} onClick={onClose} aria-hidden />
      <div className={catcher} style={{ left: 0, top: holeBottom, right: 0, bottom: 0 }} onClick={onClose} aria-hidden />
      <div className={catcher} style={{ left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height }} onClick={onClose} aria-hidden />
      <div className={catcher} style={{ left: holeRight, top: hole.top, right: 0, height: hole.height }} onClick={onClose} aria-hidden />

      <div
        className="absolute rounded-xl shadow-[0_0_0_9999px_rgba(15,23,42,0.55)] dark:shadow-[0_0_0_9999px_rgba(0,0,0,0.72)]"
        style={hole}
        aria-hidden
      />
      <div
        className="absolute rounded-xl border-2 border-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.35)] motion-safe:animate-pulse"
        style={hole}
        aria-hidden
      />

      {place && (
        <svg className="absolute inset-0 w-full h-full overflow-visible text-amber-400" aria-hidden>
          <defs>
            <marker id={`tip-arrow-${tip.id}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <path d={arrowPath} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" markerEnd={`url(#tip-arrow-${tip.id})`} />
        </svg>
      )}

      <div
        ref={card}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={textId}
        className={`absolute pointer-events-auto bg-white rounded-2xl border border-amber-200 shadow-xl p-4 motion-safe:transition motion-safe:duration-150 ${entered && place ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
        style={place ? { left: place.x, top: place.y, width: place.width } : { left: 8, top: 8, width: Math.min(340, vp.width - 16), visibility: 'hidden' }}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="font-bold text-slate-900 text-sm">💡 А вы знали?</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-2 w-9 h-9 shrink-0 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center"
            aria-label="Закрыть подсказку"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p id={textId} role="status" className="mt-1 text-sm text-slate-700 leading-snug">{tip.text}</p>
        <div className="mt-3 flex items-center justify-end gap-2">
          {showTab && (
            <button type="button" onClick={onShowTab} className="px-3 min-h-[40px] rounded-xl text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
              Показать
            </button>
          )}
          <button type="button" onClick={onClose} className="px-4 min-h-[40px] rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">
            Понятно
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
