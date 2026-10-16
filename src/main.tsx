import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import App from './App';
import ErrorToaster from './components/ErrorToaster';
import { notifyError, notifySuccess } from './lib/errors';
import './index.css';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => notifyError(error, (query.meta?.action as string) || 'Не удалось загрузить данные'),
  }),
  mutationCache: new MutationCache({
    onSuccess: (_data, _vars, _ctx, mutation) => {
      const msg = mutation.meta?.success;
      if (typeof msg === 'string') notifySuccess(msg);
    },
    onError: (error, _vars, _ctx, mutation) => notifyError(error, (mutation.meta?.action as string) || 'Не удалось сохранить изменения'),
  }),
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // 5 минут
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

// Своя игра: /game — ведущий, /game/screen/КОД — проектор, /play/КОД — команда
const path = window.location.pathname;
const screenMatch = path.match(/^[/]game[/]screen[/]([A-Za-z0-9]+)/);
const playMatch = path.match(/^[/]play[/]([A-Za-z0-9]+)/);
const GameHostPage = React.lazy(() => import('./game/GameHost').then((m) => ({ default: m.GameHost })));
const GameScreenPage = React.lazy(() => import('./game/GameScreen').then((m) => ({ default: m.GameScreen })));
const GamePlayPage = React.lazy(() => import('./game/GamePlay').then((m) => ({ default: m.GamePlay })));
if (screenMatch || playMatch || path === '/play' || path === '/play/' || path === '/game' || path.startsWith('/game/')) {
  const code = (screenMatch || playMatch)?.[1]?.toUpperCase() ?? '';
  root.render(
    <React.StrictMode>
      <AuthProvider>
        <React.Suspense fallback={null}>
          {screenMatch ? <GameScreenPage code={code} /> : path.startsWith('/play') ? <GamePlayPage code={code} /> : <GameHostPage />}
        </React.Suspense>
      </AuthProvider>
    </React.StrictMode>
  );
} else // /tg — Telegram Mini App: лёгкая страница без входа через Supabase Auth
if (window.location.pathname === '/tg' || window.location.pathname.startsWith('/tg/')) {
  const TgApp = React.lazy(() => import('./tg/TgApp'));
  root.render(
    <React.StrictMode>
      <React.Suspense fallback={null}>
        <TgApp />
      </React.Suspense>
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
          <ErrorToaster />
        </AuthProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
}
