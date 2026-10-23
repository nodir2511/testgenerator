import { describe, expect, it } from 'vitest';
import { compareSemver, rankOf, unreadReleases, visibleItems, visibleReleases } from '../src/lib/releases';
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

describe('compareSemver', () => {
  it('корректно сравнивает семантические версии', () => {
    expect(compareSemver('0.23.1', '0.23.0')).toBeGreaterThan(0);
    expect(compareSemver('0.23.0', '0.20.4')).toBeGreaterThan(0);
    expect(compareSemver('0.20.4', '0.20.4')).toBe(0);
    expect(compareSemver('0.20.0', '0.21.0')).toBeLessThan(0);
    expect(compareSemver('v0.23.1', '0.23.0')).toBeGreaterThan(0);
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

  it('сортирует версии по SemVer даже если дата более старой версии позже по времени', () => {
    const list = [
      release('0.20.4', '2026-10-24T18:00:00Z', [item('x', 1)]),
      release('0.23.1', '2026-10-23T21:27:00Z', [item('y', 1)]),
      release('0.22.0', '2026-10-23T21:10:00Z', [item('z', 1)]),
    ];
    const res = visibleReleases(list, 1);
    expect(res.map((r) => r.version)).toEqual(['0.23.1', '0.22.0', '0.20.4']);
  });

  it('определяет непрочитанные версии', () => {
    const list = [release('a', '2026-02-01T00:00:00Z', [item('x', 1)]), release('b', '2026-01-01T00:00:00Z', [item('y', 1)])];
    expect(unreadReleases(list, new Set(['b'])).map((r) => r.id)).toEqual(['a']);
  });
});

describe('файлы миграций релизов (SQL)', () => {
  it('все пункты релизов используют допустимый kind: new, fixed, improved', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.join(process.cwd(), 'supabase', 'sql', 'releases');
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    const validKinds = new Set(['new', 'fixed', 'improved']);
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      const matches = sql.matchAll(/'kind'\s*,\s*'([^']+)'/g);
      for (const m of matches) {
        expect(validKinds.has(m[1]), `${f}: неизвестный kind "${m[1]}" (разрешены: new, fixed, improved)`).toBe(true);
      }
    }
  });
});
