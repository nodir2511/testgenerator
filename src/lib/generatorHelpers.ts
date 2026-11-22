// Вспомогательная логика генератора билетов: лимиты, стандартный состав, склонения, чтение настроек из localStorage
import { LIMITS } from '../../supabase/functions/_shared/ticketing';

// Администратору на сайте можно до 50 вариантов; обычным пользователям — те же лимиты, что в Telegram (их же проверяет база)
export const ADMIN_SITE_LIMITS = { ...LIMITS, tickets: 50 };

// Стандартный состав билета по предмету: подставляется сам при выборе предмета
// reading / cloze — сколько текстов (по 8 вопросов) входит в число тестовых; у английского 1 + 1
export const STANDARDS: Array<{ match: string[]; test: number; matching: number; open: number; reading?: number; cloze?: number }> = [
  { match: ['хим', 'физ', 'матем'], test: 18, matching: 2, open: 7 },
  { match: ['англ', 'инглис', 'english'], test: 20, matching: 4, open: 2, reading: 1, cloze: 1 },
  { match: ['био', 'тадж', 'тоҷик', 'гос', 'истор', 'таърих', 'право', 'ҳуқуқ'], test: 20, matching: 4, open: 2 },
];
// Английский — предмет на одном языке: скачивание без выбора RU/TJ
export const isEnglishName = (name?: string | null) => /англ|инглис|english/i.test(name || '');
export const standardFor = (name?: string) => {
  const n = (name || '').toLowerCase();
  return STANDARDS.find((s) => s.match.some((m) => n.includes(m))) ?? null;
};

export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

// Начало суток по Душанбе (UTC+5) — так же считает дневной лимит база
export const dushanbeDayStart = () => {
  const off = 5 * 3600_000;
  return Math.floor((Date.now() + off) / 86400_000) * 86400_000 - off;
};
export const formatWait = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export const getStorageJSON = <T,>(key: string, fallback: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch {
    return fallback;
  }
};
export const getStorageString = (key: string, fallback: string): string => {
  return localStorage.getItem(key) ?? fallback;
};
export const getStorageNumber = (key: string, fallback: number): number => {
  const val = localStorage.getItem(key);
  if (!val) return fallback;
  const num = Number(val);
  return isNaN(num) ? fallback : num;
};
export const getStorageBool = (key: string, fallback: boolean): boolean => {
  const val = localStorage.getItem(key);
  if (val === null) return fallback;
  return val === 'true';
};
