// Обновление открытого сайта: когда вышла новая версия, страница перезагружается сама — но только пока человек
// ничего не успел начать (первая проверка после открытия). Позже показываем кнопку, чтобы не потерять набранное.

const TRIED_KEY = 'examiner_auto_update';
const SW_WAIT_MS = 4000;

/** Можно ли перезагрузить страницу без спроса */
export function shouldAutoReload(o: { firstCheck: boolean; newId: string; triedId: string | null }): boolean {
  // для этой версии уже перезагружались, а страница всё ещё старая — второй раз не пробуем (иначе круг перезагрузок)
  return o.firstCheck && o.triedId !== o.newId;
}

export function triedId(): string | null {
  try { return sessionStorage.getItem(TRIED_KEY); } catch { return null; }
}

/** Просит служебный сценарий скачать свежую страницу: без этого перезагрузка может снова взять сохранённую старую */
async function refreshSavedPage(): Promise<void> {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null;
  if (!sw) return;
  await new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    const timer = window.setTimeout(resolve, SW_WAIT_MS);
    ch.port1.onmessage = () => { window.clearTimeout(timer); resolve(); };
    try { sw.postMessage('refresh-shell', [ch.port2]); } catch { window.clearTimeout(timer); resolve(); }
  });
}

/** Перезагружает страницу на новую версию */
export async function reloadToNewVersion(newId: string | null): Promise<void> {
  if (newId) { try { sessionStorage.setItem(TRIED_KEY, newId); } catch { /* память недоступна */ } }
  await refreshSavedPage();
  window.location.reload();
}

/** Включает открытие сайта из памяти браузера (только в выложенной сборке) */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
