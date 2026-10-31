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
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const { saveAs } = await import('file-saver');
  const head = (cols: string[]) => cols.map((c) => ({ value: c, fontWeight: 'bold' as const }));
  const res = [head(['Место', 'Команда', 'Очки']), ...teamsRows.map((t) => [{ value: t.place }, { value: t.name }, { value: t.score }])];
  const rev = [
    head(['Уровень', 'Тема', 'Стоимость', 'Вопрос (рус.)', 'Вопрос (тадж.)', 'Ответ (рус.)', 'Ответ (тадж.)', 'Итог', 'Ответила', 'Ошиблись']),
    ...review.map((r) =>
      [r.round, r.cat, r.v, r.q, r.qt, r.a, r.at, r.res === 'ok' ? 'Верно' : 'Никто не ответил', r.team, r.wrong.join(', ')].map((value) => ({
        value: typeof value === 'number' ? value : String(value ?? ''),
      })),
    ),
  ];
  const widths = [10, 22, 10, 60, 60, 40, 40, 18, 18, 24].map((width) => ({ width }));
  const blob = await writeExcelFile([
    { data: res, sheet: 'Результаты' },
    { data: rev, sheet: 'Разбор', columns: widths },
  ] as any).toBlob();
  saveAs(blob, `${file}.xlsx`);
  void title;
}

export const standingsRows = (teams: GameTeam[], scores: Record<string, number>) =>
  standings(teams, scores).map((t) => ({ name: t.name, score: t.score, place: t.place }));

export const scoreText = (score: number) => signed(score);
