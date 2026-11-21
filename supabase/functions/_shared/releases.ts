// Обновления («Что нового») в Telegram: видимость пунктов по роли и оформление сообщений.
// Используется ботом (кнопка «Что нового») и функцией release-notify (рассылка о новой версии).

export type ReleaseScope = 'site' | 'bot' | 'app' | 'game';
export interface ReleaseItem { kind: string; scope: ReleaseScope; text: string; min_rank: number; subject_id: string | null }
export interface ReleaseRow { version: string; title: string; items: ReleaseItem[] }

/** Уровень роли: 4 главный админ, 3 админ, 2 админ по предметам, 1 остальные (как public.my_rank) */
export function rankOf(role: string | null | undefined, isOwner: boolean | null | undefined): number {
  if (isOwner) return 4;
  if (role === 'admin') return 3;
  if (role === 'subject_admin') return 2;
  return 1;
}

/** allowed — предметы пользователя; null — доступны все */
export function itemVisible(it: Pick<ReleaseItem, 'min_rank' | 'subject_id'>, rank: number, allowed: string[] | null): boolean {
  return it.min_rank <= rank && (!it.subject_id || allowed === null || allowed.includes(it.subject_id));
}

const SCOPE_TITLES: Record<ReleaseScope, string> = { site: '🌐 Сайт', bot: '🤖 Чат-бот', app: '📱 Мини-приложение', game: '🎮 Игры' };
const SCOPE_ORDER: ReleaseScope[] = ['site', 'bot', 'app'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Строки сообщения (HTML) для списка версий; версии без пунктов пропускаются */
export function releaseLines(releases: ReleaseRow[]): string[] {
  const lines: string[] = [];
  for (const r of releases) {
    if (!r.items.length) continue;
    if (lines.length) lines.push('');
    lines.push(`<b>Версия ${esc(r.version)}</b>${r.title ? ` — ${esc(r.title)}` : ''}`);
    const multi = new Set(r.items.map((i) => i.scope)).size > 1;
    for (const sc of SCOPE_ORDER) {
      const part = r.items.filter((i) => i.scope === sc);
      if (!part.length) continue;
      if (multi) lines.push(`<i>${SCOPE_TITLES[sc]}</i>`);
      for (const i of part) lines.push(`• ${esc(i.text)}`);
    }
  }
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

const NEW_WHERE: Record<ReleaseScope, string> = { site: 'на сайте', bot: 'в боте', app: 'в мини-приложении', game: 'в играх' };

/**
 * Короткая сводка версии для рассылки: заголовок и счётчики —
 * «Новое на сайте (1)», «Улучшения (2)», «Мелкие исправления (3)». Подробности — по /release.
 * Версия без пунктов даёт пустой список.
 */
export function releaseSummary(r: ReleaseRow): string[] {
  if (!r.items.length) return [];
  const lines = [`<b>Версия ${esc(r.version)}</b>${r.title ? ` — ${esc(r.title)}` : ''}`];
  for (const sc of SCOPE_ORDER) {
    const n = r.items.filter((i) => i.kind === 'new' && i.scope === sc).length;
    if (n) lines.push(`🆕 Новое ${NEW_WHERE[sc]} (${n})`);
  }
  const improved = r.items.filter((i) => i.kind === 'improved').length;
  if (improved) lines.push(`✨ Улучшения (${improved})`);
  const fixed = r.items.filter((i) => i.kind === 'fixed').length;
  if (fixed) lines.push(`🔧 Мелкие исправления (${fixed})`);
  return lines;
}

/** Сводки нескольких версий через пустую строку и подсказка внизу */
export function releaseSummaryLines(releases: ReleaseRow[]): string[] {
  const lines: string[] = [];
  for (const r of releases) {
    const part = releaseSummary(r);
    if (!part.length) continue;
    if (lines.length) lines.push('');
    lines.push(...part);
  }
  if (lines.length) {
    const last = releases.filter((r) => r.items.length).map((r) => r.version);
    lines.push('', `Подробнее — кнопки ниже или команда <code>/release ${esc(last[last.length - 1])}</code>`);
  }
  return lines;
}

/** Данные кнопки «описание версии» (callback) и разбор команды /release, «релиз 1.0.0» */
export const RELEASE_CB = 'RL:';
export function parseReleaseCommand(text: string): { version: string | null } | null {
  const m = text.trim().match(/^(?:\/(?:release|realise|relise|релиз)(?:@\w+)?|(?:release|релиз))(?:\s+v?(\S+))?$/i);
  return m ? { version: m[1] ?? null } : null;
}
