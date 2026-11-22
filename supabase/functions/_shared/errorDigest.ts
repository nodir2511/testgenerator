// Сводка ошибок сайта для главного админа в Telegram: какие периоды пора отправить, группировка
// одинаковых ошибок и текст сообщения. Чистая логика без импортов — её напрямую проверяют тесты
// (tests/errorDigest.test.ts). Используется функцией error-digest.

export type DigestPeriod = 'day' | 'week' | 'month' | 'year';
export interface DuePeriod { period: DigestPeriod; key: string; from: Date; to: Date }

export interface ErrorRow {
  created_at: string;
  message: string;
  url?: string | null;
  app_version?: string | null;
  user_id?: string | null;
}
export interface ErrorGroup { message: string; count: number; lastAt: string; url: string | null; game: boolean }
export interface ErrorSummary { total: number; site: number; game: number; users: number; groups: ErrorGroup[] }

/** Душанбе: UTC+5 круглый год, перехода на летнее время нет */
const TZ_MS = 5 * 3600_000;
const DAY_MS = 24 * 3600_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Полночь по Душанбе для календарной даты (месяц с нуля; переполнение дней и месяцев допустимо) → момент в UTC */
const localMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - TZ_MS);

/** Календарная дата по Душанбе для момента времени (поля читать через getUTC*) */
const localDate = (at: Date) => new Date(at.getTime() + TZ_MS);

const ymd = (local: Date) => `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;

/**
 * Какие сводки пора отправить в момент now (календарь по Душанбе):
 * сутки — каждый день за вчера; неделя — в понедельник за прошлую (пн–вс);
 * месяц — 1-го числа за прошлый; год — 1 января за прошлый.
 * key — устойчивое имя периода (защита от повторной отправки), from/to — границы в UTC, to не включается.
 */
export function duePeriods(now: Date): DuePeriod[] {
  const local = localDate(now);
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  const today = localMidnight(y, m, d);
  const out: DuePeriod[] = [];

  const yesterday = localMidnight(y, m, d - 1);
  out.push({ period: 'day', key: `day:${ymd(localDate(yesterday))}`, from: yesterday, to: today });

  if (local.getUTCDay() === 1) {
    const monday = localMidnight(y, m, d - 7);
    out.push({ period: 'week', key: `week:${ymd(localDate(monday))}`, from: monday, to: today });
  }
  if (d === 1) {
    const first = localMidnight(y, m - 1, 1);
    out.push({ period: 'month', key: `month:${ymd(localDate(first)).slice(0, 7)}`, from: first, to: today });
  }
  if (d === 1 && m === 0) {
    out.push({ period: 'year', key: `year:${y - 1}`, from: localMidnight(y - 1, 0, 1), to: today });
  }
  return out;
}

const MESSAGE_LIMIT = 120;

/** Ошибка игры «Приём пациента»: пометка в тексте или версия 'game' */
const isGame = (r: ErrorRow) => r.app_version === 'game' || r.message.trimStart().startsWith('[игра');

/**
 * Приводит текст ошибки к виду, одинаковому для одной и той же ошибки:
 * uuid, хэши, имена файлов сборки и числа заменяются на «…», длина — до ~120 знаков.
 */
export function normalizeMessage(message: string): string {
  const s = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…')
    // файлы сборки: Bank-BxY3kQ2a.js → Bank-….js
    .replace(/-[A-Za-z0-9_-]{8,}\.(js|mjs|css)\b/g, '-….$1')
    // шестнадцатеричные хэши (от 8 знаков, хотя бы с одной цифрой)
    .replace(/\b(?=[a-f]*\d)[0-9a-f]{8,}\b/gi, '…')
    .replace(/\d+/g, '…')
    // «12:34:56», «1.5», «10, 20» — одно многоточие
    .replace(/…(?:[.,:;/ -]*…)+/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > MESSAGE_LIMIT ? s.slice(0, MESSAGE_LIMIT) + '…' : s;
}

/** Считает ошибки и склеивает одинаковые; группы — по убыванию числа, при равенстве — сначала свежие */
export function summarize(rows: ErrorRow[]): ErrorSummary {
  const groups = new Map<string, ErrorGroup>();
  const users = new Set<string>();
  let game = 0;
  for (const r of rows) {
    const g = isGame(r);
    if (g) game++;
    if (r.user_id) users.add(r.user_id);
    const message = normalizeMessage(r.message ?? '');
    const key = `${g ? 'g' : 's'}|${message}`;
    const cur = groups.get(key);
    if (!cur) {
      groups.set(key, { message, count: 1, lastAt: r.created_at, url: r.url ?? null, game: g });
    } else {
      cur.count++;
      if (Date.parse(r.created_at) > Date.parse(cur.lastAt)) { cur.lastAt = r.created_at; cur.url = r.url ?? null; }
    }
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || Date.parse(b.lastAt) - Date.parse(a.lastAt));
  return { total: rows.length, site: rows.length - game, game, users: users.size, groups: sorted };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** 1 вид, 2 вида, 5 видов */
function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 100, b = n % 10;
  if (a >= 11 && a <= 14) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** Заголовок сводки: период по-русски, даты по Душанбе */
function digestTitle(period: DigestPeriod, range: { from: Date; to: Date }): string {
  const a = localDate(range.from);
  const b = localDate(new Date(range.to.getTime() - DAY_MS)); // последний день периода
  const dm = (x: Date) => `${pad(x.getUTCDate())}.${pad(x.getUTCMonth() + 1)}`;
  const full = (x: Date) => `${dm(x)}.${x.getUTCFullYear()}`;
  if (period === 'day') return `Ошибки сайта за сутки · ${full(a)}`;
  if (period === 'month') return `Ошибки сайта за месяц · ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  if (period === 'year') return `Ошибки сайта за ${a.getUTCFullYear()} год`;
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `Ошибки сайта за неделю · ${full(a)}–${full(b)}`;
  if (a.getUTCMonth() !== b.getUTCMonth()) return `Ошибки сайта за неделю · ${dm(a)}–${full(b)}`;
  return `Ошибки сайта за неделю · ${pad(a.getUTCDate())}–${full(b)}`;
}

/**
 * Строки сообщения (HTML для Telegram): заголовок, счётчики, самые частые ошибки.
 * top — сколько видов ошибок показать (по умолчанию 10); note — примечание последней строкой.
 */
export function digestText(
  period: DigestPeriod,
  range: { from: Date; to: Date },
  summary: ErrorSummary,
  opts?: { top?: number; note?: string },
): string[] {
  const lines = [`<b>${esc(digestTitle(period, range))}</b>`];
  if (!summary.total) {
    lines.push('Ошибок не было');
  } else {
    const top = opts?.top ?? 10;
    lines.push(`Всего: ${summary.total} · сайт: ${summary.site} · игра: ${summary.game}`);
    lines.push(`Затронуто пользователей: ${summary.users}`);
    lines.push('');
    for (const g of summary.groups.slice(0, top)) {
      lines.push(`×${g.count} · ${g.game ? 'игра · ' : ''}${esc(g.message)}`);
    }
    const rest = summary.groups.length - top;
    if (rest > 0) lines.push(`и ещё ${rest} ${plural(rest, 'вид', 'вида', 'видов')}`);
  }
  if (opts?.note) lines.push(`<i>${esc(opts.note)}</i>`);
  return lines;
}

/** Делит строки на сообщения не длиннее limit (в Telegram предел 4096 знаков) */
export function chunkLines(lines: string[], limit = 3800): string[] {
  const out: string[] = [];
  let cur = '';
  for (const l of lines) {
    const line = l.length > limit ? l.slice(0, limit - 1) + '…' : l;
    if (cur && cur.length + line.length + 1 > limit) { out.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}
