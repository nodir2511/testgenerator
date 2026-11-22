import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyInitData } from '../supabase/functions/_shared/tgInitData';

const TOKEN = '123:test';
const signed = (fields: Record<string, string>, token = TOKEN) => {
  const p = new URLSearchParams(fields);
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
};
const now = () => String(Math.floor(Date.now() / 1000));
const user = JSON.stringify({ id: 42, first_name: 'Али', last_name: 'Алиев', username: 'ali' });

describe('verifyInitData', () => {
  it('верная подпись → пользователь с именем и ником', async () => {
    expect(await verifyInitData(signed({ auth_date: now(), user }), TOKEN, 3600))
      .toEqual({ id: 42, first_name: 'Али', last_name: 'Алиев', username: 'ali' });
  });
  it('чужой или пустой токен, испорченная подпись → null', async () => {
    const raw = signed({ auth_date: now(), user });
    expect(await verifyInitData(raw, 'other', 3600)).toBeNull();
    expect(await verifyInitData(raw, '', 3600)).toBeNull();
    expect(await verifyInitData(raw.replace(/hash=(.)/, (_m, c) => `hash=${c === '0' ? '1' : '0'}`), TOKEN, 3600)).toBeNull();
    expect(await verifyInitData('', TOKEN, 3600)).toBeNull();
  });
  it('старая, будущая, нечисловая или отсутствующая auth_date → null', async () => {
    const old = String(Math.floor(Date.now() / 1000) - 7200);
    const future = String(Math.floor(Date.now() / 1000) + 3600);
    expect(await verifyInitData(signed({ auth_date: old, user }), TOKEN, 3600)).toBeNull();
    expect(await verifyInitData(signed({ auth_date: future, user }), TOKEN, 3600)).toBeNull();
    expect(await verifyInitData(signed({ auth_date: 'abc', user }), TOKEN, 3600)).toBeNull();
    expect(await verifyInitData(signed({ auth_date: 'Infinity', user }), TOKEN, 3600)).toBeNull();
    expect(await verifyInitData(signed({ user }), TOKEN, 3600)).toBeNull();
  });
  it('без user или без числового id → null', async () => {
    expect(await verifyInitData(signed({ auth_date: now() }), TOKEN, 3600)).toBeNull();
    expect(await verifyInitData(signed({ auth_date: now(), user: JSON.stringify({ id: '42' }) }), TOKEN, 3600)).toBeNull();
  });
});
