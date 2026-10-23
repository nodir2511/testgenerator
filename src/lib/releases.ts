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

/** Сравнение версий SemVer (например, 0.23.1 > 0.20.4) */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((part) => {
        const n = parseInt(part, 10);
        return isNaN(n) ? 0 : n;
      });

  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** Сортировка релизов от новых к старым: по SemVer, а при равенстве или не-semver — по дате */
export function compareReleaseOrder(a: SiteRelease, b: SiteRelease): number {
  const isSemver = (v: string) => /^\s*v?\d+(\.\d+)*/i.test(v);
  if (isSemver(a.version) && isSemver(b.version)) {
    const cmp = compareSemver(b.version, a.version);
    if (cmp !== 0) return cmp;
  }
  return b.released_at.localeCompare(a.released_at);
}

/** Версии, у которых есть хотя бы один доступный пункт, от новых к старым */
export function visibleReleases(releases: SiteRelease[], rank: ReleaseRank): SiteRelease[] {
  return releases
    .map((r) => ({ ...r, site_release_items: visibleItems(r.site_release_items ?? [], rank) }))
    .filter((r) => r.site_release_items.length > 0)
    .sort(compareReleaseOrder);
}

export function unreadReleases(releases: SiteRelease[], readIds: Set<string>): SiteRelease[] {
  return releases.filter((r) => !readIds.has(r.id));
}
