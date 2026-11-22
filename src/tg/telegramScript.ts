// Подключает telegram-web-app.js, если Telegram ещё не внедрил объект WebApp. Не падает, если скрипт не загрузился.
export function loadTelegramScript(): Promise<void> {
  if ((window as unknown as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp) return Promise.resolve();
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}
