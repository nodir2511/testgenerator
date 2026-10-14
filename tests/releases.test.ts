import { describe, expect, it } from 'vitest';
import { rankOf, unreadReleases, visibleItems, visibleReleases } from '../src/lib/releases';
import { ReleaseRank, SiteRelease, SiteReleaseItem } from '../src/types/database';

const item = (id: string, min_rank: ReleaseRank, order_index = 0): SiteReleaseItem =>
  ({ id, release_id: 'r', kind: 'new', text: id, min_rank, order_index });
const release = (id: string, released_at: string, items: SiteReleaseItem[]): SiteRelease =>
  ({ id, version: id, title: '', released_at, site_release_items: items });

describe('rankOf', () => {
  it('сопоставляет роли с уровнями', () => {
    expect(rankOf('admin', true)).toBe(4);
    expect(rankOf('admin', false)).toBe(3);
    expect(rankOf('subject_admin', false)).toBe(2);
    expect(rankOf('user', false)).toBe(1);
    expect(rankOf('subject_teacher', false)).toBe(1);
    expect(rankOf(undefined, false)).toBe(1);
  });
});

describe('видимость обновлений', () => {
  const items = [item('all', 1, 0), item('subj', 2, 1), item('admin', 3, 2), item('owner', 4, 3)];

  it('показывает пункты своего уровня и ниже', () => {
    expect(visibleItems(items, 1).map((i) => i.id)).toEqual(['all']);
    expect(visibleItems(items, 2).map((i) => i.id)).toEqual(['all', 'subj']);
    expect(visibleItems(items, 3).map((i) => i.id)).toEqual(['all', 'subj', 'admin']);
    expect(visibleItems(items, 4).map((i) => i.id)).toEqual(['all', 'subj', 'admin', 'owner']);
  });

  it('скрывает версии без доступных пунктов и сортирует от новых к старым', () => {
    const list = [
      release('old', '2026-01-01T00:00:00Z', [item('a', 1)]),
      release('adminOnly', '2026-05-01T00:00:00Z', [item('b', 3)]),
      release('new', '2026-09-01T00:00:00Z', [item('c', 1), item('d', 3)]),
    ];
    const forTeacher = visibleReleases(list, 1);
    expect(forTeacher.map((r) => r.id)).toEqual(['new', 'old']);
    expect(forTeacher[0].site_release_items.map((i) => i.id)).toEqual(['c']);
    expect(visibleReleases(list, 3).map((r) => r.id)).toEqual(['new', 'adminOnly', 'old']);
  });

  it('определяет непрочитанные версии', () => {
    const list = [release('a', '2026-02-01T00:00:00Z', [item('x', 1)]), release('b', '2026-01-01T00:00:00Z', [item('y', 1)])];
    expect(unreadReleases(list, new Set(['b'])).map((r) => r.id)).toEqual(['a']);
  });
});
