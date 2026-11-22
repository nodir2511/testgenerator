// Проверка подписи Telegram initData (мини-приложение и страница экзамена).
// Общая для tg-app и tg-exam: подпись — HMAC-SHA256 по токену бота, ключ — HMAC('WebAppData', токен).
// Модуль без импортов. Саму строку initData и токен не логировать.

export interface TgInitUser { id: number; first_name?: string; last_name?: string; username?: string }

const enc = new TextEncoder();
async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const str = (v: unknown, max: number) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);

/** Пользователь из подписанной initData или null (нет подписи, подпись неверна, данные старше maxAgeSec). */
export async function verifyInitData(raw: string, botToken: string, maxAgeSec: number): Promise<TgInitUser | null> {
  // Пустой токен дал бы ключ, который может вычислить кто угодно
  if (!botToken) return null;
  if (!raw || raw.length > 4096) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const expected = hex(await hmac(secret, check));
  if (expected.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return null;
  // Нечисловая auth_date дала бы NaN, а NaN не меньше и не больше границ — проверка прошла бы
  const authDate = Number(params.get('auth_date'));
  if (!params.get('auth_date') || !Number.isFinite(authDate)) return null;
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (!(age >= -300 && age <= maxAgeSec)) return null;
  try {
    const u = JSON.parse(params.get('user') || '');
    if (typeof u?.id !== 'number') return null;
    return { id: u.id, first_name: str(u.first_name, 64), last_name: str(u.last_name, 64), username: str(u.username, 64) };
  } catch {
    return null;
  }
}
