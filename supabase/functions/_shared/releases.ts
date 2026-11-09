// Обновления («Что нового») в Telegram: видимость пунктов по роли и оформление сообщений.
// Используется ботом (кнопка «Что нового») и функцией release-notify (рассылка о новой версии).

export type ReleaseScope = 'site' | 'bot' | 'app';
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

const SCOPE_TITLES: Record<ReleaseScope, string> = { site: '🌐 Сайт', bot: '🤖 Чат-бот', app: '📱 Мини-приложение' };
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
