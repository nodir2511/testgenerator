import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { rankOf, unreadReleases, visibleReleases } from '../lib/releases';
import { SiteRelease } from '../types/database';

/** Обновления сайта, доступные роли пользователя, и отметки «прочитано» */
export function useReleases() {
  const { user, profile, isOwner } = useAuth();
  const qc = useQueryClient();
  const rank = rankOf(profile?.role, isOwner);

  const releasesQ = useQuery({
    queryKey: ['site-releases', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_releases')
        .select('*, site_release_items(*)')
        .order('released_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SiteRelease[];
    },
    meta: { action: 'Не удалось загрузить историю обновлений' },
  });

  const readsQ = useQuery({
    queryKey: ['site-release-reads', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('site_release_reads').select('release_id');
      if (error) throw error;
      return (data ?? []).map((r: { release_id: string }) => r.release_id);
    },
  });

  const releases = useMemo(() => visibleReleases(releasesQ.data ?? [], rank), [releasesQ.data, rank]);
  const unread = useMemo(
    () => (readsQ.data ? unreadReleases(releases, new Set(readsQ.data)) : []),
    [releases, readsQ.data],
  );

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!user || ids.length === 0) return;
      const { error } = await supabase
        .from('site_release_reads')
        .upsert(ids.map((release_id) => ({ user_id: user.id, release_id })), { onConflict: 'user_id,release_id', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['site-release-reads'] }),
    meta: { action: 'Не удалось отметить обновления прочитанными' },
  });

  return { releases, unread, rank, isLoading: releasesQ.isLoading, markRead: markRead.mutate };
}
