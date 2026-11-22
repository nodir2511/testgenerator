import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { SiteTip } from '../lib/tips';

export const tipsKey = (userId: string | undefined) => ['site-tip', userId] as const;

/**
 * Подсказки «А вы знали?», которые можно показать пользователю (RPC next_site_tips: от новых к старым,
 * без показанных и без подсказок версий с ещё не закрытым окном «Что нового»). Какую показать — решает TipPopup.
 * Подсказки — необязательная мелочь: ошибки не показываются пользователю.
 */
export function useTips(enabled: boolean) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const tipsQ = useQuery({
    queryKey: tipsKey(user?.id),
    enabled: !!user && enabled,
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('next_site_tips');
      // Функции в базе ещё нет (site_tips.sql не применён) или другая ошибка — просто без подсказок
      if (error) {
        if (error.code !== 'PGRST202') console.warn('Подсказки не загрузились', error.message);
        return [] as SiteTip[];
      }
      return (data ?? []) as SiteTip[];
    },
  });

  // Отметка «показано» — в момент показа, чтобы подсказка не повторилась, даже если её не закрыли
  const seen = useMutation({
    mutationFn: async (tipId: string) => {
      if (!user) return;
      const { error } = await supabase
        .from('site_tip_seen')
        .upsert({ user_id: user.id, tip_id: tipId }, { onConflict: 'user_id,tip_id', ignoreDuplicates: true });
      if (error) console.warn('Не удалось отметить подсказку показанной', error.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: tipsKey(user?.id) }),
  });

  return { tips: tipsQ.data ?? [], markSeen: seen.mutate };
}
