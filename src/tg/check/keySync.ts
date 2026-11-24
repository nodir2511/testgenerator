// Свои ключи на всех устройствах: хранилище Telegram (CloudStorage) конкретного пользователя и этого бота.
// Таблиц и запросов к серверу нет. Вне Telegram и на старых клиентах ключи остаются на устройстве.
import type { CustomKey } from './CustomKeys';
import { tgAtLeast, wa, type TgWebApp } from './telegram';

export const CLOUD_PREFIX = 'omr_key_';
/** Предел одного значения в CloudStorage */
export const CLOUD_LIMIT = 4096;

type Storage = NonNullable<TgWebApp['CloudStorage']>;
const storage = (): Storage | null => { const a = wa(); return a?.CloudStorage && tgAtLeast('6.9', a) ? a.CloudStorage : null; };
export const cloudAvailable = () => !!storage();

const isKey = (v: unknown): v is CustomKey => {
  const k = v as CustomKey | null;
  return !!k && typeof k.id === 'string' && typeof k.name === 'string' && Array.isArray(k.layouts) && !!k.comp && typeof k.comp.test === 'number' && !!k.keys && typeof k.keys === 'object';
};

/** Ключ для хранилища: без служебной пометки synced; null — не помещается */
export function encodeKey(k: CustomKey): string | null {
  const { synced: _, ...rest } = k;
  const s = JSON.stringify(rest);
  // предел считается в байтах: кириллица в названии занимает два
  return new TextEncoder().encode(s).length <= CLOUD_LIMIT ? s : null;
}
export function decodeKey(raw: string): CustomKey | null {
  try { const v = JSON.parse(raw); return isKey(v) ? v : null; } catch { return null; }
}

/**
 * Сводит ключи устройства с облаком. Побеждает более поздняя правка. Ключа нет в облаке: если он уже там был (synced) —
 * его удалили на другом устройстве, убираем; если не был — отправляем.
 * during — что было, пока облако читалось: known — ключи, уже лежавшие в облаке до чтения, removed — удалённые тем временем здесь.
 */
export function mergeKeys(local: CustomKey[], cloud: CustomKey[], during?: { known: Set<string>; removed: Set<string> }): { list: CustomKey[]; push: CustomKey[] } {
  const byId = new Map(cloud.filter((k) => !during?.removed.has(k.id)).map((k) => [k.id, k]));
  const list: CustomKey[] = [], push: CustomKey[] = [];
  for (const l of local) {
    const c = byId.get(l.id);
    byId.delete(l.id);
    if (!c) {
      // Облако совсем пустое — скорее его очистили, чем удалили все ключи: ключи с устройства не выбрасываем
      const gone = l.synced && (!during || during.known.has(l.id));
      if (gone && cloud.length) continue;
      list.push(gone ? { ...l, synced: false } : l);
      if (gone || !l.synced) push.push(l);
    } else if ((l.updatedAt ?? 0) > (c.updatedAt ?? 0)) {
      list.push({ ...l, synced: false });
      push.push(l);
    } else list.push({ ...c, synced: true });
  }
  for (const c of byId.values()) list.push({ ...c, synced: true });
  return { list, push };
}

/** Ключи из облака; null — прочитать не удалось (тогда ничего не меняем) */
export function loadCloudKeys(): Promise<CustomKey[] | null> {
  const s = storage();
  if (!s) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    const done = (v: CustomKey[] | null) => { clearTimeout(timer); resolve(v); };
    try {
      s.getKeys((err, keys) => {
        if (err || !keys) return done(null);
        const mine = keys.filter((k) => k.startsWith(CLOUD_PREFIX));
        if (!mine.length) return done([]);
        s.getItems(mine, (e2, values) => {
          if (e2 || !values) return done(null);
          const out = mine.map((k) => (values[k] ? decodeKey(values[k]) : null));
          // Значение есть, но не читается (новая версия, обрыв) — не считаем ключ удалённым
          if (out.some((x) => !x)) return done(null);
          done(out as CustomKey[]);
        });
      });
    } catch { done(null); }
  });
}

/** true — записано в облако */
export function saveCloudKey(k: CustomKey): Promise<boolean> {
  const s = storage(), v = encodeKey(k);
  if (!s || v === null) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    try { s.setItem(CLOUD_PREFIX + k.id, v, (err, ok) => { clearTimeout(timer); resolve(!err && ok !== false); }); } catch { clearTimeout(timer); resolve(false); }
  });
}

export function removeCloudKey(id: string): Promise<boolean> {
  const s = storage();
  if (!s) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    try { s.removeItem(CLOUD_PREFIX + id, (err) => { clearTimeout(timer); resolve(!err); }); } catch { clearTimeout(timer); resolve(false); }
  });
}
