// Шрифт подключается без блокировки отрисовки. Внешний файл, а не onload в разметке: CSP (script-src 'self') запрещает встроенные обработчики.
(function () {
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
  document.head.appendChild(l);
})();
