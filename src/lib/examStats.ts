import { scoreAttempt, type ExamAnswers, type ExamQuestion } from '../../supabase/functions/_shared/exam';
import { finishedInSession } from './examView';

// Разбор по вопросам и ведомость для Excel. Чистые функции: без обращений к базе.

export interface StatTicket {
  id: string;
  ticket_number?: number | null;
  questions: Array<{ id: string; question_id: string | null; question_snapshot: any }>;
}
export interface StatAttempt { ticket_id: string; answers: Record<string, unknown>; finished_at: string | null }
export interface SheetAttempt extends StatAttempt {
  student_name?: string | null;
  tg_username?: string | null;
  tg_name?: string | null;
  score?: number | null;
  max_score?: number | null;
  /** Уходы со страницы билета: сколько раз и сколько всего миллисекунд */
  away_count?: number | null;
  away_ms?: number | null;
}

export interface QuestionStat {
  questionId: string | null;
  label: string;
  type: string;
  /** Сколько сданных работ с этим вопросом ответили на него хоть как-то */
  answered: number;
  /** Сколько сданных работ содержали этот вопрос */
  total: number;
  /** Сколько получили за него все баллы */
  correct: number;
  /** Средняя доля набранных баллов, 0..1 */
  avgShare: number;
  wrongTop?: { text: string; count: number };
}

const isEmpty = (snap: any) => !snap || snap.empty === true;
const plain = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/\s+/g, ' ').trim();
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const labelOf = (snap: any) => clip(plain(String(snap.content_ru || snap.content || ''))) || '(без текста)';
const optText = (o: any) => plain(String(o?.text_ru || o?.text || ''));

interface Acc {
  questionId: string | null;
  label: string;
  type: string;
  answered: number;
  total: number;
  correct: number;
  share: number;
  wrong: Map<string, number>;
}

/** sessionStartAt — session_start_at запуска: попытки, закрытые до старта (в ожидании), в разбор не входят */
export function questionStats(tickets: StatTicket[], attempts: StatAttempt[], sessionStartAt: string | null): QuestionStat[] {
  const byTicket = new Map(tickets.map((t) => [t.id, t]));
  const groups = new Map<string, Acc>();

  for (const a of attempts) {
    if (!finishedInSession(a.finished_at, sessionStartAt)) continue;
    const t = byTicket.get(a.ticket_id);
    if (!t) continue;
    const answers = (a.answers ?? {}) as ExamAnswers;
    const qs: ExamQuestion[] = t.questions.map((q) => ({ tqId: q.id, snapshot: q.question_snapshot }));
    const { items } = scoreAttempt(qs, answers);
    t.questions.forEach((q, i) => {
      const snap = q.question_snapshot;
      if (isEmpty(snap)) return;
      const it = items[i];
      const key = q.question_id ?? `tq:${q.id}`;
      let g = groups.get(key);
      if (!g) {
        g = { questionId: q.question_id, label: labelOf(snap), type: String(snap.type ?? 'test'), answered: 0, total: 0, correct: 0, share: 0, wrong: new Map() };
        groups.set(key, g);
      }
      g.total++;
      if (it.answered) g.answered++;
      if (it.max > 0) {
        g.share += it.points / it.max;
        if (it.points >= it.max) g.correct++;
      }
      if (g.type === 'test' && it.answered && it.points < it.max) {
        const chosen = (snap.options ?? []).find((o: any) => o.id === answers[q.id]);
        if (chosen) {
          const text = optText(chosen);
          g.wrong.set(text, (g.wrong.get(text) ?? 0) + 1);
        }
      }
    });
  }

  const out: QuestionStat[] = [...groups.values()].map((g) => {
    const top = [...g.wrong.entries()].sort((x, y) => y[1] - x[1])[0];
    const s: QuestionStat = {
      questionId: g.questionId, label: g.label, type: g.type,
      answered: g.answered, total: g.total, correct: g.correct,
      avgShare: g.total ? g.share / g.total : 0,
    };
    if (top) s.wrongTop = { text: top[0], count: top[1] };
    return s;
  });
  return out.sort((a, b) => a.avgShare - b.avgShare || b.total - a.total || a.label.localeCompare(b.label, 'ru'));
}

export const SHEET_HEADER = ['Имя', 'Аккаунт', 'Вариант', 'Баллы', 'Максимум', '%', 'Статус', 'Уходил, раз', 'Вне страницы, с'];

/**
 * Строки ведомости для write-excel-file: заголовок и по строке на каждую попытку. Баллы — сохранённые, иначе пересчёт по снимкам.
 * Закрытые до старта сессии (sessionStartAt) — «не начал», без баллов.
 */
export function attemptsSheet(attempts: SheetAttempt[], tickets: StatTicket[], sessionStartAt: string | null): Array<Array<{ value: string | number }>> {
  const byTicket = new Map(tickets.map((t) => [t.id, t]));
  const rows: Array<Array<{ value: string | number }>> = [SHEET_HEADER.map((value) => ({ value }))];
  for (const a of attempts) {
    const t = byTicket.get(a.ticket_id);
    const done = finishedInSession(a.finished_at, sessionStartAt);
    const status = done ? 'сдал' : a.finished_at ? 'не начал' : 'не сдал';
    let score: number | null = done ? (a.score ?? null) : null;
    let max: number | null = done ? (a.max_score ?? null) : null;
    if (done && (score == null || max == null) && t) {
      const r = scoreAttempt(t.questions.map((q) => ({ tqId: q.id, snapshot: q.question_snapshot })), (a.answers ?? {}) as ExamAnswers);
      score = r.score;
      max = r.max;
    }
    const pct = score != null && max ? Math.round((score / max) * 100) : '';
    rows.push([
      { value: a.student_name ?? '' },
      { value: a.tg_username ? `@${a.tg_username}` : (a.tg_name ?? '') },
      { value: t?.ticket_number ?? '' },
      { value: score ?? '' },
      { value: max ?? '' },
      { value: pct },
      { value: status },
      { value: a.away_count ?? 0 },
      { value: Math.round((a.away_ms ?? 0) / 1000) },
    ]);
  }
  return rows;
}
