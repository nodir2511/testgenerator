import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { notifyError, notifyInfo, withUndo } from '../lib/errors';
import { findPairs } from '../lib/duplicates';
import { ANY_LABELS, bankDupDoc, bankIssues, loadBankQuestions, snippet, type AnyIssue, type BankQ } from '../lib/bankScan';
import { compactQuestion, readScanCache, subjectFingerprint, writeScanCache, type CompactQ } from '../lib/scanCache';
import { Badge, Button, Card, EmptyState, Hint, PageHeader } from './ui';
import type { Subject } from '../types/database';

// Раздел «Качество банка» (только главный админ): ошибки в вопросах и возможные дубли внутри предмета.
// Всё считается в браузере, без внешних сервисов. Ничего не меняет: только показывает, где смотреть.

interface Scan {
  total: number;
  /** Только вопросы из замечаний и пар (для показа), в сжатом виде */
  byId: Map<string, CompactQ>;
  issues: Array<{ q: CompactQ; codes: AnyIssue[] }>;
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
const linked = (x: CompactQ, y: CompactQ) => !!(x.linked_ids?.includes(y.id) || y.linked_ids?.includes(x.id));
const pairKey = (x: string, y: string) => (x < y ? [x, y] : [y, x]) as [string, string];
const keyOf = (x: string, y: string) => pairKey(x, y).join('|');

const Where: React.FC<{ q: CompactQ }> = ({ q }) => (
  <span className="text-xs text-slate-600">{TYPE_LABEL[q.type] ?? q.type} · {q.chapter?.name} · {q.topic?.name}{q.num ? ` · №${q.num}` : ''}</span>
);

export const QualityView: React.FC = () => {
  const [subjectId, setSubjectId] = useState('');
  const [rawScan, setScan] = useState<Scan | null>(null);
  // Вопросы, которые удалили в этой проверке (сразу скрываются, в базе удаляются через 5 секунд, если не отменить)
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const scan = React.useMemo<Scan | null>(() => rawScan && (hidden.size === 0 ? rawScan : {
    ...rawScan,
    total: rawScan.total - hidden.size,
    issues: rawScan.issues.filter((x) => !hidden.has(x.q.id)),
    pairs: rawScan.pairs.filter((p) => !hidden.has(p.a) && !hidden.has(p.b)),
  }), [rawScan, hidden]);
  const [busy, setBusy] = useState(false);
  // Сверка результата с базой: проверяется, менялся ли банк с момента проверки
  const [fresh, setFresh] = useState<'checking' | 'fresh' | 'stale' | null>(null);
  const latest = React.useRef({ scan: null as Scan | null, fresh: null as typeof fresh });
  latest.current = { scan: rawScan, fresh };
  const [level, setLevel] = useState(0.85);
  const [code, setCode] = useState<AnyIssue | 'all'>('all');
  const [pairKind, setPairKind] = useState<'dups' | 'answers' | 'approved'>('dups');
  // Одобренные пары («не дубль»), ключ — id двух вопросов по возрастанию; хранятся в duplicate_dismissals
  const [approved, setApproved] = useState<Set<string>>(new Set());

  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Subject[];
    },
  });
  React.useEffect(() => { if (!subjectId && subjects.length) setSubjectId(subjects[0].id); }, [subjects, subjectId]);
  const loadApproved = async () => {
    const dis = await supabase.from('duplicate_dismissals').select('a, b').limit(10000);
    // Нет таблицы (SQL ещё не применён) — работаем без одобренных пар
    setApproved(new Set(dis.error ? [] : (dis.data ?? []).map((r: { a: string; b: string }) => `${r.a}|${r.b}`)));
  };
  // При выборе предмета сразу показываем сохранённую проверку и сверяем её с базой
  React.useEffect(() => {
    setScan(null); setHidden(new Set()); setCode('all'); setFresh(null);
    if (!subjectId) return;
    const c = readScanCache(subjectId);
    if (!c) return;
    let cancelled = false;
    setScan({ total: c.total, byId: new Map(c.questions.map((q) => [q.id, q])), issues: c.issues.flatMap((x) => { const q = c.questions.find((y) => y.id === x.id); return q ? [{ q, codes: x.codes }] : []; }), pairs: c.pairs, at: c.at });
    setFresh('checking');
    void loadApproved();
    subjectFingerprint(subjectId).then((fp) => { if (!cancelled) setFresh(fp === c.fingerprint ? 'fresh' : 'stale'); }).catch(() => { if (!cancelled) setFresh('stale'); });
    return () => { cancelled = true; };
  }, [subjectId]);

  const saveCache = (sid: string, s: Scan, fingerprint: string) => writeScanCache(sid, {
    v: 1, at: s.at, fingerprint, total: s.total,
    questions: [...s.byId.values()],
    issues: s.issues.map((x) => ({ id: x.q.id, codes: x.codes })),
    pairs: s.pairs,
  });
  // После своего действия (удаление, связь) результат остаётся актуальным: обновляем отпечаток, если до этого он совпадал
  const keepCacheFresh = async () => {
    const cur = latest.current;
    if (!subjectId || !cur.scan || cur.fresh !== 'fresh') return;
    try { saveCache(subjectId, cur.scan, await subjectFingerprint(subjectId)); } catch { /* не страшно: просто будет предложена перепроверка */ }
  };

  const run = async () => {
    if (!subjectId || busy) return;
    setBusy(true);
    setHidden(new Set());
    try {
      // Отпечаток снимаем до загрузки: если банк изменят во время проверки, это будет видно при следующем входе
      const fingerprint = await subjectFingerprint(subjectId).catch(() => '');
      const qs = await loadBankQuestions(subjectId);
      // Дать браузеру перерисоваться перед тяжёлым расчётом
      await new Promise((r) => setTimeout(r, 30));
      const issues = qs.map((q) => ({ q, codes: bankIssues(q) })).filter((x) => x.codes.length > 0);
      const pairs = findPairs(qs.map(bankDupDoc), { threshold: 0.75 });
      await loadApproved();
      const need = new Set<string>([...issues.map((x) => x.q.id), ...pairs.flatMap((p) => [p.a, p.b])]);
      const byId = new Map(qs.filter((q) => need.has(q.id)).map((q) => [q.id, compactQuestion(q)]));
      const next: Scan = {
        total: qs.length, byId, at: Date.now(), pairs,
        issues: issues.map((x) => ({ q: byId.get(x.q.id)!, codes: x.codes })),
      };
      setScan(next);
      if (fingerprint) { saveCache(subjectId, next, fingerprint); setFresh('fresh'); } else setFresh(null);
    } catch (e) {
      notifyError(e, 'Не удалось проверить банк');
    } finally {
      setBusy(false);
    }
  };

  const setPair = async (x: string, y: string, on: boolean, silent = false): Promise<boolean> => {
    const [a, b] = pairKey(x, y);
    const { error } = on
      ? await supabase.from('duplicate_dismissals').upsert({ a, b }, { onConflict: 'a,b', ignoreDuplicates: true })
      : await supabase.from('duplicate_dismissals').delete().eq('a', a).eq('b', b);
    if (error) { notifyError(error, 'Не удалось сохранить. Применён ли supabase/sql/duplicate_dismissals.sql?'); return false; }
    setApproved((prev) => { const n = new Set(prev); if (on) n.add(`${a}|${b}`); else n.delete(`${a}|${b}`); return n; });
    if (!silent) notifyInfo(on ? 'Пара одобрена и больше не показывается' : 'Пара возвращена в список');
    return true;
  };

  // Удалить вопрос в корзину: сразу скрывается, в базе удаляется через 5 секунд, пока можно отменить (как в банке вопросов)
  const removeQuestion = (id: string) => {
    setHidden((prev) => new Set(prev).add(id));
    const unhide = () => setHidden((prev) => { const n = new Set(prev); n.delete(id); return n; });
    withUndo('Вопрос удалён', () => {
      void (async () => {
        const { data, error } = await supabase.from('questions').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', id).select('id');
        if (error || !data || data.length === 0) {
          unhide();
          notifyError(error ?? new Error('Вопрос не удалён: нет прав или он не найден'), 'Не удалось удалить вопрос');
          return;
        }
        // Из сохранённого результата вопрос тоже убираем
        const cur = latest.current.scan;
        if (cur && subjectId) {
          const trimmed: Scan = { ...cur, total: cur.total - 1, issues: cur.issues.filter((x) => x.q.id !== id), pairs: cur.pairs.filter((p) => p.a !== id && p.b !== id) };
          setScan((prev) => prev && trimmed);
          setHidden((prev) => { const n = new Set(prev); n.delete(id); return n; });
          latest.current = { ...latest.current, scan: trimmed };
          void keepCacheFresh();
        }
      })();
    }, unhide);
  };

  // Связать вопросы: в один билет они больше не попадут (та же связь, что у «теста и открытого вопроса из него»).
  // Связь хранится у второго вопроса пары. Связанная пара сразу одобряется.
  const linkPair = async (p: { a: string; b: string }) => {
    const a = rawScan?.byId.get(p.a), b = rawScan?.byId.get(p.b);
    if (!a || !b) return;
    const next = Array.from(new Set([...(b.linked_ids ?? []), a.id]));
    const { data, error } = await supabase.from('questions').update({ linked_ids: next }).eq('id', b.id).select('id');
    if (error || !data || data.length === 0) { notifyError(error ?? new Error('Связь не сохранена: нет прав'), 'Не удалось связать вопросы'); return; }
    const updated = rawScan ? { ...rawScan, byId: new Map(rawScan.byId).set(b.id, { ...b, linked_ids: next }) } : null;
    setScan(updated);
    latest.current = { ...latest.current, scan: updated };
    void keepCacheFresh();
    if (await setPair(p.a, p.b, true, true)) notifyInfo('Вопросы связаны: в один билет не попадут. Пара одобрена');
  };

  const counts = React.useMemo(() => {
    const m = new Map<AnyIssue, number>();
    scan?.issues.forEach((x) => x.codes.forEach((c) => m.set(c, (m.get(c) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [scan]);
  const shownIssues = scan ? scan.issues.filter((x) => code === 'all' || x.codes.includes(code)) : [];
  const isApproved = (p: { a: string; b: string }) => approved.has(keyOf(p.a, p.b));
  const shownPairs = scan ? scan.pairs.filter((p) => p.score >= level && (pairKind === 'approved' ? isApproved(p) : !isApproved(p) && p.answerDiffers === (pairKind === 'answers'))) : [];
  const approvedCount = scan ? scan.pairs.filter((p) => p.score >= level && isApproved(p)).length : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ShieldCheck}
        title="Качество банка"
        description={<>Поиск ошибок в вопросах и повторов внутри предмета. <Hint label="Что проверяется">Ошибки: нет правильного ответа, не по стандарту, пустой текст или вариант, одинаковые варианты, сломанные теги оформления, неверная ссылка на картинку. Дубли: одинаковые и почти одинаковые вопросы (по русскому и таджикскому тексту). Вопросы с одной формулировкой, но другими вариантами и другим верным ответом («какой из вариантов щёлочь») разными и считаются. «Ответы расходятся» — это когда формулировка и набор вариантов те же, а верный ответ другой: стоит проверить, какая запись верна. Смысловые перефразировки не находятся. Действия с парой: «Не дубль» (или «Так и задумано») одобряет её, и она уходит в «Одобренные», откуда её можно вернуть; «Связать вопросы» делает так, что они не попадают в один билет, и тоже одобряет пару; «Удалить» отправляет вопрос в корзину (5 секунд на отмену).</Hint></>}
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

      {scan && !busy && (
        <p className="text-sm text-slate-600 px-1" role="status">
          Проверено {new Date(scan.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}.{' '}
          {fresh === 'checking' && 'Сверяю с базой…'}
          {fresh === 'fresh' && <span className="text-emerald-700 font-semibold">Банк не менялся с тех пор — результат актуален.</span>}
          {fresh === 'stale' && <span className="text-amber-700 font-semibold">Банк изменился с тех пор — нажмите «Проверить заново», чтобы обновить.</span>}
        </p>
      )}
      {!scan && !busy && <EmptyState title="Выберите предмет и нажмите «Проверить банк»" description="Проверка занимает несколько секунд и ничего не меняет в вопросах." />}

      {scan && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([['Проверено вопросов', scan.total], ['С замечаниями', scan.issues.length], ['Пар-дублей', scan.pairs.filter((p) => p.score >= 0.85 && !p.answerDiffers && !isApproved(p)).length], ['Ответы расходятся', scan.pairs.filter((p) => p.score >= 0.85 && p.answerDiffers && !isApproved(p)).length]] as const).map(([l, v]) => (
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
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl" role="radiogroup" aria-label="Что показывать">
                {([['dups', 'Дубли'], ['answers', 'Ответы расходятся'], ['approved', `Одобренные (${approvedCount})`]] as const).map(([k, l]) => (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={pairKind === k}
                    onClick={() => setPairKind(k)}
                    className={`min-h-[40px] px-3 rounded-lg text-sm font-semibold transition ${pairKind === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
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
              <p className="text-sm text-slate-600 mt-2">{pairKind === 'approved' ? 'Одобренных пар нет.' : pairKind === 'answers' ? 'Таких вопросов не найдено.' : 'Похожих вопросов не найдено.'}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {shownPairs.slice(0, SHOW).map((p) => {
                  const a = scan.byId.get(p.a), b = scan.byId.get(p.b);
                  if (!a || !b) return null;
                  return (
                    <li key={`${p.a}-${p.b}`} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        {p.answerDiffers
                          ? <Badge tone="warning">Те же варианты, но верный ответ другой — проверьте</Badge>
                          : <Badge tone={p.exact ? 'danger' : 'warning'}>{p.exact ? 'Точный дубль' : `Похожи на ${Math.round(p.score * 100)}%`}</Badge>}
                      </div>
                      {[a, b].map((q) => (
                        <div key={q.id} className="py-1 flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-slate-900">{snippet(q.content)}</div>
                            <Where q={q} />
                          </div>
                          {pairKind !== 'approved' && (
                            <Button variant="danger-soft" size="sm" onClick={() => removeQuestion(q.id)} className="shrink-0">Удалить</Button>
                          )}
                        </div>
                      ))}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {pairKind === 'approved' ? (
                          <Button variant="secondary" size="sm" onClick={() => setPair(p.a, p.b, false)}>Вернуть в список</Button>
                        ) : (
                          <>
                            <Button variant="secondary" size="sm" onClick={() => setPair(p.a, p.b, true)}>
                              {p.answerDiffers ? 'Так и задумано' : 'Не дубль'}
                            </Button>
                            {linked(a, b)
                              ? <Badge tone="success">Связаны</Badge>
                              : <Button variant="secondary" size="sm" onClick={() => linkPair(p)}>Связать вопросы</Button>}
                          </>
                        )}
                      </div>
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
