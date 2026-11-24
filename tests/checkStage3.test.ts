import { afterEach, describe, expect, it } from 'vitest';
import { AUTO_START, autoStep, autoTaken, fingerprint, sameSheet, type AutoState, type Corners } from '../src/tg/check/autosnap';
import { CLOUD_PREFIX, decodeKey, encodeKey, loadCloudKeys, mergeKeys, removeCloudKey, saveCloudKey } from '../src/tg/check/keySync';
import type { CustomKey } from '../src/tg/check/CustomKeys';
import { createOmrClient } from '../src/lib/omr/omrClient';
import { omrRead } from '../src/lib/omr/recognize';
import { OMR_LAYOUTS } from '../src/lib/omr/layouts.generated';
import type { Ok } from '../src/tg/check/logic';
import { render } from './omrRender';

const sheet = (dx = 0): Corners => [[100 + dx, 100], [800 + dx, 100], [100 + dx, 400], [800 + dx, 400]];
const run = (steps: Array<Corners | null>, from: AutoState = AUTO_START) => {
  let s = from;
  const snaps: boolean[] = [];
  for (const c of steps) { const r = autoStep(s, c, 900); s = r.state; snaps.push(r.snap); }
  return { s, snaps };
};

describe('автоснимок', () => {
  it('снимает, когда бланк дважды подряд на месте, и только один раз', () => {
    expect(run([sheet(), sheet(3), sheet(2), sheet(), sheet()]).snaps).toEqual([false, true, false, false, false]);
  });
  it('пока бланк двигают — не снимает', () => {
    expect(run([sheet(0), sheet(90), sheet(180), sheet(270)]).snaps).toEqual([false, false, false, false]);
    expect(run([sheet(0), sheet(90), sheet(92)]).snaps).toEqual([false, false, true]);
  });
  it('следующий лист — после того как прежний убрали; один пропущенный кадр не считается', () => {
    expect(run([sheet(), sheet(), null, sheet(), sheet()]).snaps).toEqual([false, true, false, false, false]);
    expect(run([sheet(), sheet(), null, null, sheet(), sheet()]).snaps).toEqual([false, true, false, false, false, true]);
  });
  it('после снимка кнопкой тот же лист сам не снимается', () => {
    const { s } = run([sheet()]);
    expect(run([sheet(), sheet(), sheet()], autoTaken(s)).snaps).toEqual([false, false, false]);
  });
  it('тот же лист узнаётся по ответам, другой — нет', () => {
    const read = (seed: number, deg: number) => omrRead(render(OMR_LAYOUTS.chem, seed, deg).img, OMR_LAYOUTS.chem) as Ok;
    const a = read(31, 2), b = read(31, -4), c = read(32, 2);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(sameSheet(a, b)).toBe(true);
    expect(sameSheet(a, c)).toBe(false);
    expect(sameSheet(undefined, a)).toBe(false);
  });
});

const key = (id: string, o: Partial<CustomKey> = {}): CustomKey => ({ id, name: 'Ключ ' + id, comp: { test: 8, matching: 2, open: 2 }, layouts: ['chemphys'], keys: {}, ...o });

describe('ключи на всех устройствах', () => {
  it('новый ключ отправляется, чужой добавляется, удалённый на другом устройстве убирается', () => {
    const r = mergeKeys([key('new'), key('gone', { synced: true, updatedAt: 5 })], [key('other', { updatedAt: 9 })]);
    expect(r.list.map((k) => k.id)).toEqual(['new', 'other']);
    expect(r.push.map((k) => k.id)).toEqual(['new']);
    expect(r.list[1].synced).toBe(true);
  });
  it('побеждает более поздняя правка', () => {
    const r = mergeKeys([key('a', { name: 'тут новее', updatedAt: 20, synced: true }), key('b', { name: 'старое', updatedAt: 1 })], [key('a', { name: 'там', updatedAt: 10 }), key('b', { name: 'там новее', updatedAt: 2 })]);
    expect(r.list.map((k) => k.name)).toEqual(['тут новее', 'там новее']);
    expect(r.push.map((k) => k.id)).toEqual(['a']);
  });
  it('ключи, созданные до этой версии (без времени), не теряются', () => {
    expect(mergeKeys([key('old')], []).push.map((k) => k.id)).toEqual(['old']);
    expect(mergeKeys([key('old')], [key('old')]).list).toHaveLength(1);
  });
  it('пока облако читалось: созданный ключ не пропадает, удалённый не возвращается', () => {
    const made = key('made', { synced: true, updatedAt: 7 });
    const known = new Set(['old']);
    const r = mergeKeys([made], [key('removed', { updatedAt: 1 })], { known, removed: new Set(['removed']) });
    expect(r.list.map((k) => k.id)).toEqual(['made']);
    expect(mergeKeys([key('old', { synced: true })], [key('x')], { known, removed: new Set() }).list.map((k) => k.id)).toEqual(['x']);
  });
  it('облако пустое (очистили, сбой) — ключи с устройства не пропадают, а отправляются заново', () => {
    const r = mergeKeys([key('a', { synced: true }), key('b', { synced: true })], []);
    expect(r.list.map((k) => [k.id, k.synced])).toEqual([['a', false], ['b', false]]);
    expect(r.push.map((k) => k.id)).toEqual(['a', 'b']);
  });
  it('запись и чтение; не помещается или испорчено — null', () => {
    const k = key('a', { synced: true, updatedAt: 3 });
    const back = decodeKey(encodeKey(k)!);
    expect(back).toEqual({ ...k, synced: undefined });
    expect(encodeKey(key('b', { name: 'ы'.repeat(3000) }))).toBeNull();
    expect(decodeKey('{')).toBeNull();
    expect(decodeKey('{"id":1}')).toBeNull();
  });
  it('самый большой ключ (4 варианта × 27 заданий) помещается', () => {
    const t = { tests: Array(20).fill('A'), matching: Array(4).fill(['1', '2', '3', '4']), open: Array(7).fill('12345') };
    expect(encodeKey(key('max', { name: 'ы'.repeat(60), comp: { test: 20, matching: 4, open: 7 }, keys: { 1: t, 2: t, 3: t, 4: t } as CustomKey['keys'] }))).not.toBeNull();
  });
});

describe('хранилище Telegram', () => {
  const g = globalThis as unknown as { window?: unknown };
  afterEach(() => { delete g.window; });
  const mount = (data: Record<string, string>, o: { err?: boolean; version?: boolean } = {}) => {
    g.window = { Telegram: { WebApp: { isVersionAtLeast: () => o.version !== false, CloudStorage: {
      getKeys: (cb: (e: unknown, k?: string[]) => void) => (o.err ? cb('ERR') : cb(null, Object.keys(data))),
      getItems: (ks: string[], cb: (e: unknown, v?: Record<string, string>) => void) => cb(null, Object.fromEntries(ks.map((k) => [k, data[k] ?? '']))),
      setItem: (k: string, v: string, cb: (e: unknown, ok?: boolean) => void) => { data[k] = v; cb(null, true); },
      removeItem: (k: string, cb: (e: unknown) => void) => { delete data[k]; cb(null); },
    } } } };
  };
  it('читает только свои записи, пишет и удаляет', async () => {
    const data: Record<string, string> = { чужое: '1' };
    mount(data);
    expect(await loadCloudKeys()).toEqual([]);
    expect(await saveCloudKey(key('a'))).toBe(true);
    expect((await loadCloudKeys())!.map((k) => k.id)).toEqual(['a']);
    expect(await removeCloudKey('a')).toBe(true);
    expect(Object.keys(data)).toEqual(['чужое']);
  });
  it('сбой чтения, испорченная запись, старый клиент, не Telegram — null: ничего не удаляем', async () => {
    mount({}, { err: true });
    expect(await loadCloudKeys()).toBeNull();
    mount({ [CLOUD_PREFIX + 'a']: '{bad' });
    expect(await loadCloudKeys()).toBeNull();
    mount({}, { version: false });
    expect(await loadCloudKeys()).toBeNull();
    expect(await saveCloudKey(key('a'))).toBe(false);
    delete g.window;
    expect(await loadCloudKeys()).toBeNull();
  });
});

describe('фоновый поток распознавания', () => {
  const img = { w: 1, h: 1, data: new Uint8Array(1) };
  const inline = async (kind: string) => `сам:${kind}`;
  type W = { postMessage: (m: { id: number }) => void; terminate(): void; onmessage: null | ((e: { data: unknown }) => void); onerror: null | ((e: unknown) => void) };
  const make = (post: (w: W, m: { id: number }) => void) => { const w: W = { postMessage: (m) => post(w, m), terminate() {}, onmessage: null, onerror: null }; return () => w as never; };

  it('ответы приходят тому, кто спрашивал, даже не по порядку', async () => {
    const ids: number[] = [];
    let wk: W | null = null;
    const c = createOmrClient(make((w, m) => { wk = w; ids.push(m.id); }), inline);
    const a = c.read(img, []), b = c.probe(img, []);
    wk!.onmessage!({ data: { id: ids[1], out: 'второй' } });
    wk!.onmessage!({ data: { id: ids[0], out: 'первый' } });
    expect([await a, await b]).toEqual(['первый', 'второй']);
  });
  it('поток не создаётся, падает или молчит — считает основной поток', async () => {
    expect(await createOmrClient(() => { throw new Error('нет'); }, inline).read(img, [])).toBe('сам:read');
    expect(await createOmrClient(make((w) => { setTimeout(() => w.onerror!('x'), 0); }), inline).read(img, [])).toBe('сам:read');
    const silent = createOmrClient(make(() => {}), inline, 20);
    expect(await silent.probe(img, [])).toBe('сам:probe');
    expect(await silent.read(img, [])).toBe('сам:read');
  });
  it('ошибка распознавания в потоке доходит до вызвавшего', async () => {
    const c = createOmrClient(make((w, m) => { setTimeout(() => w.onmessage!({ data: { id: m.id, fail: 'сломалось' } }), 0); }), inline);
    await expect(c.read(img, [])).rejects.toThrow('сломалось');
  });
});
