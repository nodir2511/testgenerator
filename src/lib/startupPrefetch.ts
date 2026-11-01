import type { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Subject } from '../types/database';

export const fetchSubjects = async (): Promise<Subject[]> => {
  const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
  return (data || []) as Subject[];
};

// Модуль вкладки, которую сайт откроет первой (последняя открытая; по умолчанию — генератор)
const TAB_MODULES: Record<string, () => Promise<unknown>> = {
  generator: () => import('../components/TicketGenerator'),
  questions: () => import('../components/QuestionList'),
  saved_tickets: () => import('../components/SavedTicketsView'),
};

/**
 * Ускоряет открытие сайта: пока идёт загрузка профиля, параллельно качается код первой вкладки
 * и список предметов. Выполняется только для вошедшего пользователя (сессия хранится в браузере).
 */
export function prefetchOnStartup(queryClient: QueryClient): void {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session) return;
    let tab = 'generator';
    try { tab = localStorage.getItem('examiner_active_tab') || tab; } catch { /* ignore */ }
    TAB_MODULES[tab]?.().catch(() => {});
    queryClient.prefetchQuery({ queryKey: ['subjects'], queryFn: fetchSubjects }).catch(() => {});
  }).catch(() => {});
}
