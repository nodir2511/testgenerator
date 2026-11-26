// Лёгкий вход для Telegram: /tg (мини-приложение преподавателя) и /tg/exam (билет ученика).
// Клиент базы, библиотека запросов и код сайта сюда не входят — страница на телефоне открывается быстрее.
// На сервере /tg отдаёт tg.html (vercel.json); при локальной разработке те же страницы открывает main.tsx.
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './dark.css';

const path = window.location.pathname;
const isExam = path === '/tg/exam' || path === '/tg/exam/';
const Page = React.lazy(() => (isExam ? import('./exam/ExamApp') : import('./tg/TgApp')));

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      <Page />
    </React.Suspense>
  </React.StrictMode>
);

// Отчёты об ошибках нужны клиенту базы: подключаем их после показа страницы, чтобы не задерживать её
const later = () => { void import('./lib/errorReporter').then((m) => m.installGlobalErrorReporting()).catch(() => undefined); };
window.setTimeout(later, 4000);
