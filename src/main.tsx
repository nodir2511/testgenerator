import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import App from './App';
import ErrorToaster from './components/ErrorToaster';
import { notifyError } from './lib/errors';
import './index.css';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => notifyError(error, (query.meta?.action as string) || 'Не удалось загрузить данные'),
  }),
  mutationCache: new MutationCache({
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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
        <ErrorToaster />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
