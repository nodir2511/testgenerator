import type { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Subject } from '../types/database';
import { persistQueryCache, restoreQueryCache } from './queryPersist';

export const fetchSubjects = async (): Promise<Subject[]> => {
  const { data, error } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
  if (error) throw error; // ошибку показываем, а не выдаём за пустой список
  return (data || []) as Subject[];
};

// Модуль вкладки, которую сайт откроет первой (последняя открытая; по умолчанию — генератор)
const TAB_MODULES: Record<string, () => Promise<unknown>> = {
  generator: () => import('../components/TicketGenerator'),
  questions: () => import('../components/QuestionList'),
  saved_tickets: () => import('../components/SavedTicketsView'),
  cluster: () => import('../components/ClusterExam'),
};

/**
 * Ускоряет открытие сайта: пока идёт загрузка профиля, параллельно качается код первой вкладки
 * и список предметов. Выполняется только для вошедшего пользователя (сессия хранится в браузере).
 * Справочники прошлого визита (queryPersist.ts) возвращаются в память сразу, свежие догружаются в фоне.
 */
export function prefetchOnStartup(queryClient: QueryClient): void {
  let userId: string | null = null;
  persistQueryCache(queryClient, () => userId);
  // Только запоминаем, кто вошёл: долгих действий в этом колбэке быть не должно
  supabase.auth.onAuthStateChange((_event, session) => { userId = session?.user?.id ?? null; });
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session) return;
    userId = session.user.id;
    restoreQueryCache(queryClient, userId);
    let tab = 'generator';
    try { tab = localStorage.getItem('examiner_active_tab') || tab; } catch { /* ignore */ }
    TAB_MODULES[tab]?.().catch(() => {});
    queryClient.prefetchQuery({ queryKey: ['subjects'], queryFn: fetchSubjects }).catch(() => {});
  }).catch(() => {});
}
