// Тема оформления применяется до отрисовки страницы, чтобы не мигать белым. Внешний файл: CSP (script-src 'self') запрещает встроенные скрипты.
// Игра (/game, /play) и Telegram Mini App (/tg) имеют свою тему и этот выбор не используют.
(function () {
  try {
    if (/^\/(game|play|tg)(\/|$)/.test(location.pathname)) return;
    var pref = localStorage.getItem('examiner_theme') || 'light';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) {
      document.documentElement.classList.add('dark');
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', '#0b1324');
    }
  } catch (e) { /* память браузера недоступна — остаётся светлая тема */ }
})();
