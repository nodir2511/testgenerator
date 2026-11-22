// Подсказки «А вы знали?»: когда показывать, какую выбрать и где поставить карточку со стрелкой.
// Здесь только чистая логика; показ — src/components/TipPopup.tsx, данные — src/hooks/useTip.ts.

/** Подсказка из public.site_tips (функция next_site_tips) */
export interface SiteTip {
  id: string;
  version: string;
  text: string;
  /** Ключ якоря: элемент с атрибутом data-tip="<ключ>" */
  target: string;
  /** Раздел сайта (TabType), где живёт якорь; «Показать» переводит туда */
  tab: string | null;
  min_rank: number;
  subject_id?: string | null;
  released_at: string;
}

/** Не раньше чем через столько после входа */
export const TIP_START_DELAY_MS = 8_000;
/** Не чаще одной подсказки за столько */
export const TIP_GAP_MS = 24 * 60 * 60 * 1000;
/** Как часто искать якорь на экране, пока подсказка не показана */
export const TIP_POLL_MS = 2_000;

export interface TipGate {
  now: number;
  /** Когда пользователь вошёл (смонтировался компонент подсказок) */
  startedAt: number;
  /** Когда в последний раз показывали подсказку этому пользователю (localStorage) */
  lastShownAt: number | null;
  /** В этот заход подсказка уже была */
  sessionShown: boolean;
  /** Открыто окно «Что нового» */
  newsOpen: boolean;
  /** Окно «Что нового» уже показывали в этот заход: второй всплывающий блок подряд — лишний */
  newsShownThisSession: boolean;
  /** Открыто любое другое модальное окно, форма вопроса или меню «Ещё» */
  modalOpen: boolean;
  /** Текущий раздел */
  tab: string;
  /** Режим «только игра» (роль game_teacher) */
  gameOnly: boolean;
}

/** Можно ли сейчас показать подсказку (без учёта того, есть ли её якорь на экране) */
export function shouldShowTip(g: TipGate): boolean {
  if (g.gameOnly || g.sessionShown || g.newsOpen || g.newsShownThisSession || g.modalOpen) return false;
  if (g.tab === 'releases') return false;
  if (g.now - g.startedAt < TIP_START_DELAY_MS) return false;
  if (g.lastShownAt != null) {
    const since = g.now - g.lastShownAt;
    // Время из будущего — сбитые часы: не блокируем подсказки навсегда
    if (since >= 0 && since < TIP_GAP_MS) return false;
  }
  return true;
}

/** Ключ якоря пункта меню раздела: saved_tickets → nav-saved-tickets */
export function tipKeyOfTab(tab: string): string {
  return `nav-${tab.replace(/_/g, '-')}`;
}

/** Какие якоря подходят для ключа: у пункта меню запасной — кнопка «Ещё» нижнего меню на телефоне */
export function anchorKeys(target: string): string[] {
  return target.startsWith('nav-') && target !== 'nav-more' ? [target, 'nav-more'] : [target];
}

/** Первая (самая новая) подсказка, у которой виден якорь; подсказки уже упорядочены сервером от новых к старым */
export function pickTip(tips: SiteTip[], isVisible: (key: string) => boolean): SiteTip | null {
  return tips.find((t) => anchorKeys(t.target).some(isVisible)) ?? null;
}

/** Кнопка «Показать»: раздел задан, доступен пользователю и мы сейчас не в нём */
export function showTabButton(tip: SiteTip, currentTab: string, canOpen: (tab: string) => boolean): boolean {
  return !!tip.tab && tip.tab !== currentTab && canOpen(tip.tab);
}

// ── Размещение карточки ────────────────────────────────────────────────────────────────────

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Viewport { width: number; height: number; safeTop?: number; safeBottom?: number }
export interface Point { x: number; y: number }
export type TipSide = 'top' | 'bottom' | 'left' | 'right';
export interface TipPlacement {
  /** С какой стороны якоря стоит карточка */
  side: TipSide;
  /** Левый верхний угол карточки */
  x: number;
  y: number;
  /** Ширина карточки (на узком экране меньше желаемой) */
  width: number;
  /** Стрелка: от края карточки к подсвеченному месту */
  arrow: { from: Point; to: Point };
}

/** Отступ выреза вокруг якоря */
export const TIP_HOLE_PAD = 6;
/** Расстояние от выреза до карточки — место для стрелки */
const GAP = 44;
/** Поля у краёв экрана */
const MARGIN = 8;

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));

/** Куда поставить карточку размером card рядом с якорем anchor, чтобы она целиком была в экране */
export function placeTip(anchor: Rect, viewport: Viewport, card: { width: number; height: number }): TipPlacement {
  const vw = viewport.width, vh = viewport.height;
  const safeTop = viewport.safeTop ?? 0, safeBottom = viewport.safeBottom ?? 0;
  const w = Math.min(card.width, vw - 2 * MARGIN);
  const h = card.height;
  const hole = { l: anchor.left - TIP_HOLE_PAD, t: anchor.top - TIP_HOLE_PAD, r: anchor.right + TIP_HOLE_PAD, b: anchor.bottom + TIP_HOLE_PAD };
  const cx = (anchor.left + anchor.right) / 2, cy = (anchor.top + anchor.bottom) / 2;
  const minX = MARGIN, maxX = vw - MARGIN - w;
  const minY = safeTop + MARGIN, maxY = vh - safeBottom - MARGIN - h;

  const below = maxY - (hole.b + GAP);
  const above = hole.t - GAP - h - minY;
  const right = maxX - (hole.r + GAP);
  const left = hole.l - GAP - w - minX;

  let side: TipSide;
  if (below >= 0) side = 'bottom';
  else if (above >= 0) side = 'top';
  else if (right >= 0 && maxY >= minY) side = 'right';
  else if (left >= 0 && maxY >= minY) side = 'left';
  else side = below >= above ? 'bottom' : 'top';

  let x: number, y: number, from: Point, to: Point;
  if (side === 'bottom' || side === 'top') {
    x = clamp(cx - w / 2, minX, maxX);
    y = clamp(side === 'bottom' ? hole.b + GAP : hole.t - GAP - h, minY, maxY);
    const fx = clamp(cx, x + 16, x + w - 16);
    const tx = clamp(fx, anchor.left, anchor.right);
    if (side === 'bottom') {
      from = { x: fx, y };
      to = { x: tx, y: Math.min(hole.b + 2, y - 12) };
    } else {
      from = { x: fx, y: y + h };
      to = { x: tx, y: Math.max(hole.t - 2, y + h + 12) };
    }
  } else {
    y = clamp(cy - h / 2, minY, maxY);
    x = clamp(side === 'right' ? hole.r + GAP : hole.l - GAP - w, minX, maxX);
    const fy = clamp(cy, y + 16, y + h - 16);
    const ty = clamp(fy, anchor.top, anchor.bottom);
    if (side === 'right') {
      from = { x, y: fy };
      to = { x: Math.min(hole.r + 2, x - 12), y: ty };
    } else {
      from = { x: x + w, y: fy };
      to = { x: Math.max(hole.l - 2, x + w + 12), y: ty };
    }
  }
  return { side, x, y, width: w, arrow: { from, to } };
}

// ── Хранилище: «когда показывали» и «уже было в этот заход» ────────────────────────────────

const lastKey = (userId: string) => `examiner_tip_last:${userId}`;
const SESSION_KEY = 'examiner_tip_session_shown';
let shownInMemory = false;

const local = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
const session = (): Storage | null => { try { return window.sessionStorage; } catch { return null; } };

export function readLastShown(userId: string, storage: Storage | null = local()): number | null {
  try {
    const v = storage?.getItem(lastKey(userId));
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeLastShown(userId: string, at: number, storage: Storage | null = local()): void {
  try { storage?.setItem(lastKey(userId), String(at)); } catch { /* приватный режим: хватит отметки в базе */ }
}

/** Подсказка уже была в этот заход (флаг в памяти и sessionStorage — переживает перезагрузку вкладки) */
export function readSessionShown(storage: Storage | null = session()): boolean {
  if (shownInMemory) return true;
  try { return storage?.getItem(SESSION_KEY) === '1'; } catch { return false; }
}

export function writeSessionShown(storage: Storage | null = session()): void {
  shownInMemory = true;
  try { storage?.setItem(SESSION_KEY, '1'); } catch { /* хватит флага в памяти */ }
}
