import { ReleaseRank, SiteRelease, SiteReleaseItem, UserRole } from '../types/database';

export const RANK_LABELS: Record<ReleaseRank, string> = {
  1: 'Все пользователи',
  2: 'Администраторы по предметам и выше',
  3: 'Администраторы и выше',
  4: 'Только главный админ',
};

export const KIND_LABELS = { new: 'Новое', fixed: 'Исправлено', improved: 'Улучшено' } as const;

/** Уровень пользователя; совпадает с public.my_rank() в БД (преподаватели — одинаковый уровень) */
export function rankOf(role: UserRole | undefined, isOwner: boolean): ReleaseRank {
  if (isOwner) return 4;
  if (role === 'admin') return 3;
  if (role === 'subject_admin') return 2;
  return 1;
}

/** Пункты, доступные уровню (сервер уже фильтрует; проверка нужна для главного админа и защиты от рассинхрона) */
export function visibleItems(items: SiteReleaseItem[], rank: ReleaseRank): SiteReleaseItem[] {
  return items.filter((i) => i.min_rank <= rank).sort((a, b) => a.order_index - b.order_index);
}

/** Версии, у которых есть хотя бы один доступный пункт, от новых к старым */
export function visibleReleases(releases: SiteRelease[], rank: ReleaseRank): SiteRelease[] {
  return releases
    .map((r) => ({ ...r, site_release_items: visibleItems(r.site_release_items ?? [], rank) }))
    .filter((r) => r.site_release_items.length > 0)
    .sort((a, b) => b.released_at.localeCompare(a.released_at));
}

export function unreadReleases(releases: SiteRelease[], readIds: Set<string>): SiteRelease[] {
  return releases.filter((r) => !readIds.has(r.id));
}
