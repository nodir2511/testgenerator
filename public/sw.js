// Служебный сценарий сайта: при слабой связи или без неё сайт открывается из памяти браузера.
// Обычный JS-файл (не входит в сборку), как theme-init.js. Правила:
//  - страница сайта: сначала сеть; если она не ответила за NET_WAIT_MS — сохранённая копия, а свежая докачивается в фоне;
//  - /assets/* (имена с хэшем, содержимое не меняется): из памяти, иначе из сети с сохранением;
//  - всё остальное (база, /tg, /version.json, файлы) идёт мимо — как без сценария.
// Обновление: сайт сам сверяет /version.json и перезагружается (src/lib/autoUpdate.ts), перед этим просит обновить копию страницы.
const SHELL = 'examiner-shell-v1';
const ASSETS = 'examiner-assets-v1';
const NET_WAIT_MS = 1500;
const MAX_ASSETS = 250;

self.addEventListener('install', (event) => {
  event.waitUntil(refreshShell().catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== SHELL && name !== ASSETS) await caches.delete(name);
    await self.clients.claim();
  })());
});

/** Скачивает свежую страницу сайта и кладёт её в память; возвращает ответ */
async function refreshShell() {
  const res = await fetch('/', { cache: 'no-store' });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || res.redirected || !type.includes('text/html')) throw new Error('страница не получена');
  const cache = await caches.open(SHELL);
  await cache.put('/', res.clone());
  return res;
}

/** Старые файлы прошлых версий: оставляем последние MAX_ASSETS */
async function trimAssets() {
  const cache = await caches.open(ASSETS);
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(req);
}

async function shellResponse(event) {
  const cache = await caches.open(SHELL);
  const saved = await cache.match('/');
  const fresh = refreshShell();
  if (!saved) return fresh.catch(() => fetch(event.request));
  // Свежая страница докачается, даже если ответим сохранённой
  event.waitUntil(fresh.catch(() => undefined));
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NET_WAIT_MS));
  const quick = await Promise.race([fresh.catch(() => null), timeout]);
  return quick || saved;
}

async function assetResponse(request) {
  const cache = await caches.open(ASSETS);
  const saved = await cache.match(request);
  if (saved) return saved;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') await cache.put(request, res.clone()).catch(() => undefined);
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    const p = url.pathname;
    // мини-приложение и билет ученика — своя страница (tg.html); адрес с расширением — это файл, а не страница сайта
    if (p === '/tg' || p.startsWith('/tg/') || /\.[a-z0-9]+$/i.test(p)) return;
    event.respondWith(shellResponse(event));
    return;
  }
  if (url.pathname.startsWith('/assets/')) event.respondWith(assetResponse(req));
});

self.addEventListener('message', (event) => {
  if (event.data !== 'refresh-shell') return;
  const port = event.ports && event.ports[0];
  const reply = (ok) => { if (port) port.postMessage({ ok }); };
  event.waitUntil(refreshShell().then(() => trimAssets()).then(() => reply(true), () => reply(false)));
});
