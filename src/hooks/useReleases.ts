import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { gameReleases, rankOf, unreadReleases, visibleReleases, withoutGameItems } from '../lib/releases';
import { SiteRelease } from '../types/database';

/** Обновления сайта, доступные роли пользователя, и отметки «прочитано» */
export function useReleases() {
  const { user, profile, isOwner } = useAuth();
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
  // Пункты раздела «Игры» не попадают в окно «Что нового»; главный админ видит их в списке, чтобы править
  const siteReleases = useMemo(() => withoutGameItems(releases), [releases]);
  const gameNotes = useMemo(() => gameReleases(releases), [releases]);
  const unread = useMemo(
    () => (readsQ.data ? unreadReleases(siteReleases, new Set(readsQ.data)) : []),
    [siteReleases, readsQ.data],
  );

  const markRead = useMarkReleasesRead();

  return { releases: isOwner ? releases : siteReleases, gameNotes, unread, rank, isLoading: releasesQ.isLoading, markRead };
}

/** Отметка «прочитано»; после неё обновляются и история, и счётчик непрочитанных в шапке */
function useMarkReleasesRead() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!user || ids.length === 0) return;
      const { error } = await supabase
        .from('site_release_reads')
        .upsert(ids.map((release_id) => ({ user_id: user.id, release_id })), { onConflict: 'user_id,release_id', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-release-reads'] });
      qc.invalidateQueries({ queryKey: ['site-releases-unread'] });
    },
    meta: { action: 'Не удалось отметить обновления прочитанными' },
  });
  return markRead.mutate;
}

/**
 * Непрочитанные версии для окна «Что нового» и счётчика в шапке. Сайт вызывает это при каждом входе,
 * поэтому читается только непрочитанное (функция базы unread_site_releases), а не вся история версий:
 * её целиком загружает useReleases, когда открыт раздел «Что нового» или «Игры».
 */
export function useUnreadReleases() {
  const { user, profile, isOwner } = useAuth();
  const rank = rankOf(profile?.role, isOwner);

  const unreadQ = useQuery({
    queryKey: ['site-releases-unread', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('unread_site_releases', {}, { get: true })
        .select('*, site_release_items(*)');
      // Функции в базе ещё нет (perf_round1.sql не применён) — окно просто не показывается
      if (error && error.code === 'PGRST202') return [] as SiteRelease[];
      if (error) throw error;
      return (data ?? []) as SiteRelease[];
    },
    meta: { action: 'Не удалось загрузить обновления сайта' },
  });

  const unread = useMemo(() => withoutGameItems(visibleReleases(unreadQ.data ?? [], rank)), [unreadQ.data, rank]);
  const markRead = useMarkReleasesRead();

  return { unread, markRead };
}
