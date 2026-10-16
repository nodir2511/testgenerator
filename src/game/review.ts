import type { GameRound } from './content';
import type { GameBoard, GameTeam } from './api';
import { signed, standings } from './api';

/** Строка разбора: что спрашивали и чем закончился вопрос (хранится в game_results.review, видит только ведущий) */
export interface ReviewRow {
  round: string;
  cat: string;
  v: number;
  q: string;
  qt: string;
  a: string;
  at: string;
  /** ok — ответили верно, none — никто не ответил */
  res: 'ok' | 'none';
  team: string;
  wrong: string[];
}

const plain = (s: string) => s.replace(/_\{([^}]+)\}/g, '$1').replace(/_(\d+)/g, '$1').replace(/\^([^^]+)\^/g, '^$1');

export function buildReview(board: GameBoard, pack: GameRound[], teams: GameTeam[]): ReviewRow[] {
  const name = (n: number) => teams.find((t) => t.n === n)?.name ?? `№${n}`;
  return board.log.map((e) => {
    const r = pack.find((x) => x.id === e.r);
    const c = r?.cats[e.ci];
    const item = c?.qs[e.qi];
    return {
      round: r?.tab ?? e.r,
      cat: c?.name ?? '',
      v: e.v,
      q: plain(item?.q ?? ''),
      qt: plain(item?.qt ?? ''),
      a: plain(item?.a ?? ''),
      at: plain(item?.at ?? ''),
      res: e.res,
      team: e.n != null ? name(e.n) : '',
      wrong: e.wrong.map(name),
    };
  });
}

export const resultText = (r: ReviewRow) =>
  (r.res === 'ok' ? `Верно: ${r.team}` : 'Никто не ответил') + (r.wrong.length ? `; ошиблись: ${r.wrong.join(', ')}` : '');

/** Excel: лист «Результаты» (места) и лист «Разбор» (вопросы с итогом) */
export async function exportXlsx(title: string, teamsRows: { name: string; score: number; place: number }[], review: ReviewRow[], file: string) {
  const XLSX = await import('xlsx');
  const { saveAs } = await import('file-saver');
  const wb = XLSX.utils.book_new();
  const res = [['Место', 'Команда', 'Очки'], ...teamsRows.map((t) => [t.place, t.name, t.score])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(res), 'Результаты');
  const rev = [
    ['Уровень', 'Тема', 'Стоимость', 'Вопрос (рус.)', 'Вопрос (тадж.)', 'Ответ (рус.)', 'Ответ (тадж.)', 'Итог', 'Ответила', 'Ошиблись'],
    ...review.map((r) => [r.round, r.cat, r.v, r.q, r.qt, r.a, r.at, r.res === 'ok' ? 'Верно' : 'Никто не ответил', r.team, r.wrong.join(', ')]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rev);
  ws['!cols'] = [{ wch: 10 }, { wch: 22 }, { wch: 10 }, { wch: 60 }, { wch: 60 }, { wch: 40 }, { wch: 40 }, { wch: 18 }, { wch: 18 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Разбор');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveAs(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${file}.xlsx`);
  void title;
}

export const standingsRows = (teams: GameTeam[], scores: Record<string, number>) =>
  standings(teams, scores).map((t) => ({ name: t.name, score: t.score, place: t.place }));

export const scoreText = (score: number) => signed(score);
