import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { notifyError } from '../lib/errors';
import { findPairs } from '../lib/duplicates';
import { ANY_LABELS, bankDupDoc, bankIssues, loadBankQuestions, snippet, type AnyIssue, type BankQ } from '../lib/bankScan';
import { Badge, Button, Card, EmptyState, Hint, PageHeader } from './ui';
import type { Subject } from '../types/database';

// Раздел «Качество банка» (только главный админ): ошибки в вопросах и возможные дубли внутри предмета.
// Всё считается в браузере, без внешних сервисов. Ничего не меняет: только показывает, где смотреть.

interface Scan {
  total: number;
  byId: Map<string, BankQ>;
  issues: Array<{ q: BankQ; codes: AnyIssue[] }>;
  pairs: Array<{ a: string; b: string; score: number; exact: boolean; answerDiffers: boolean }>;
  at: number;
}

const TYPE_LABEL: Record<string, string> = { test: 'Тест', matching: 'Соответствие', open: 'Открытый' };
const LEVELS = [
  { v: 0.95, label: 'Строго', hint: 'почти одинаковые' },
  { v: 0.85, label: 'Обычно', hint: '' },
  { v: 0.75, label: 'Широко', hint: 'больше ложных' },
];
const SHOW = 100;

const Where: React.FC<{ q: BankQ }> = ({ q }) => (
  <span className="text-xs text-slate-600">{TYPE_LABEL[q.type] ?? q.type} · {q.chapter?.name} · {q.topic?.name}{q.num ? ` · №${q.num}` : ''}</span>
);

export const QualityView: React.FC = () => {
  const [subjectId, setSubjectId] = useState('');
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(0.85);
  const [code, setCode] = useState<AnyIssue | 'all'>('all');

  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Subject[];
    },
  });
  React.useEffect(() => { if (!subjectId && subjects.length) setSubjectId(subjects[0].id); }, [subjects, subjectId]);
  React.useEffect(() => { setScan(null); setCode('all'); }, [subjectId]);

  const run = async () => {
    if (!subjectId || busy) return;
    setBusy(true);
    try {
      const qs = await loadBankQuestions(subjectId);
      // Дать браузеру перерисоваться перед тяжёлым расчётом
      await new Promise((r) => setTimeout(r, 30));
      const issues = qs.map((q) => ({ q, codes: bankIssues(q) })).filter((x) => x.codes.length > 0);
      const pairs = findPairs(qs.map(bankDupDoc), { threshold: 0.75 }).sort((x, y) => Number(y.answerDiffers) - Number(x.answerDiffers) || y.score - x.score);
      setScan({ total: qs.length, byId: new Map(qs.map((q) => [q.id, q])), issues, pairs, at: Date.now() });
    } catch (e) {
      notifyError(e, 'Не удалось проверить банк');
    } finally {
      setBusy(false);
    }
  };

  const counts = React.useMemo(() => {
    const m = new Map<AnyIssue, number>();
    scan?.issues.forEach((x) => x.codes.forEach((c) => m.set(c, (m.get(c) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [scan]);
  const shownIssues = scan ? scan.issues.filter((x) => code === 'all' || x.codes.includes(code)) : [];
  const shownPairs = scan ? scan.pairs.filter((p) => p.score >= level) : [];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ShieldCheck}
        title="Качество банка"
        description={<>Поиск ошибок в вопросах и повторов внутри предмета. <Hint label="Что проверяется">Ошибки: нет правильного ответа, не по стандарту, пустой текст или вариант, одинаковые варианты, сломанные теги оформления, неверная ссылка на картинку. Дубли: одинаковые и почти одинаковые вопросы (по русскому и таджикскому тексту). Если вопрос тот же, а правильный ответ разный, пара помечается отдельно: это не повтор, а противоречие, и такие пары идут первыми. Смысловые перефразировки не находятся. Раздел ничего не меняет.</Hint></>}
      />
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          aria-label="Предмет"
          className="min-h-[44px] text-base px-3 border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:w-72"
        >
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Button variant="primary" onClick={run} disabled={busy || !subjectId} className="sm:w-auto">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Проверяю…</> : scan ? 'Проверить заново' : 'Проверить банк'}
        </Button>
      </div>

      {!scan && !busy && <EmptyState title="Выберите предмет и нажмите «Проверить банк»" description="Проверка занимает несколько секунд и ничего не меняет в вопросах." />}

      {scan && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([['Проверено вопросов', scan.total], ['С замечаниями', scan.issues.length], ['Пар-дублей', scan.pairs.filter((p) => p.score >= 0.85 && !p.answerDiffers).length], ['Ответы расходятся', scan.pairs.filter((p) => p.score >= 0.85 && p.answerDiffers).length]] as const).map(([l, v]) => (
              <Card key={l} padding="none" className="p-3.5">
                <div className="text-sm font-semibold text-slate-600 leading-tight">{l}</div>
                <div className="text-3xl font-bold text-slate-900 mt-1 tabular-nums">{v}</div>
              </Card>
            ))}
          </div>

          <Card as="section" padding="none" className="p-4">
            <h3 className="font-bold text-slate-900 text-base">Ошибки в вопросах</h3>
            {scan.issues.length === 0 ? (
              <p className="text-sm text-slate-600 mt-2">Замечаний нет.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mt-3" role="radiogroup" aria-label="Тип замечания">
                  {[['all' as const, scan.issues.length] as const, ...counts].map(([c, n]) => (
                    <button
                      key={c}
                      role="radio"
                      aria-checked={code === c}
                      onClick={() => setCode(c)}
                      className={`min-h-[36px] px-3 rounded-xl text-sm font-semibold border transition ${code === c ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300'}`}
                    >
                      {c === 'all' ? 'Все' : ANY_LABELS[c]} · {n}
                    </button>
                  ))}
                </div>
                <ul className="mt-3 divide-y divide-slate-100">
                  {shownIssues.slice(0, SHOW).map(({ q, codes }) => (
                    <li key={q.id} className="py-2.5">
                      <div className="text-sm text-slate-900">{snippet(q.content)}</div>
                      <div className="mt-0.5"><Where q={q} /></div>
                      <div className="mt-1 flex flex-wrap gap-1.5">{codes.map((c) => <Badge key={c} tone="warning">{ANY_LABELS[c]}</Badge>)}</div>
                    </li>
                  ))}
                </ul>
                {shownIssues.length > SHOW && <p className="text-sm text-slate-600 mt-2">Показаны первые {SHOW} из {shownIssues.length}. Выберите тип замечания, чтобы сузить список.</p>}
              </>
            )}
          </Card>

          <Card as="section" padding="none" className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="font-bold text-slate-900 text-base">Возможные дубли ({shownPairs.length})</h3>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl" role="radiogroup" aria-label="Строгость поиска">
                {LEVELS.map((l) => (
                  <button
                    key={l.v}
                    role="radio"
                    aria-checked={level === l.v}
                    onClick={() => setLevel(l.v)}
                    title={l.hint}
                    className={`min-h-[40px] px-3 rounded-lg text-sm font-semibold transition ${level === l.v ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            {shownPairs.length === 0 ? (
              <p className="text-sm text-slate-600 mt-2">Похожих вопросов не найдено.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {shownPairs.slice(0, SHOW).map((p) => {
                  const a = scan.byId.get(p.a), b = scan.byId.get(p.b);
                  if (!a || !b) return null;
                  return (
                    <li key={`${p.a}-${p.b}`} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        {p.answerDiffers
                          ? <Badge tone="danger">Вопрос тот же, ответы разные — одна запись неверна</Badge>
                          : <Badge tone={p.exact ? 'danger' : 'warning'}>{p.exact ? 'Точный дубль' : `Похожи на ${Math.round(p.score * 100)}%`}</Badge>}
                      </div>
                      {[a, b].map((q) => (
                        <div key={q.id} className="py-1">
                          <div className="text-sm text-slate-900">{snippet(q.content)}</div>
                          <Where q={q} />
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}
            {shownPairs.length > SHOW && <p className="text-sm text-slate-600 mt-2">Показаны первые {SHOW}. Выберите режим «Строго», чтобы увидеть самые явные.</p>}
          </Card>
        </>
      )}
    </div>
  );
};
