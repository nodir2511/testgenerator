import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Download, Trash2 } from 'lucide-react';
import { scoreAnswers } from '../../../supabase/functions/_shared/omrScore';
import { exportOmrChecksToExcel } from '../../lib/omr/exportExcel';
import { filterChecks, groupByDay, parseDetails, percent, tone, wrongList, type SavedCheck } from './logic';
import { CompareLegend, SheetGrid } from './Sheet';
import { confirmDialog } from './telegram';

export type Api = <T>(action: string, payload?: Record<string, unknown>) => Promise<T>;

/** Сервер ещё не знает нового действия (сайт обновился раньше функции) — говорим по-человечески */
const friendly = (e: unknown, what: string) => new Error(/Неизвестное действие/.test((e as Error).message) ? `${what} пока не работает: сервер ещё обновляется. Попробуйте через несколько минут.` : (e as Error).message);

export function Results({ api, onError, onOpen }: { api: Api; onError: (e: unknown) => void; onOpen: (r: SavedCheck) => void }) {
  const [rows, setRows] = useState<SavedCheck[] | null>(null);
  const [q, setQ] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false;
    api<{ checks: SavedCheck[] }>('check_list').then((r) => { if (!off) setRows(r.checks); }).catch((e) => { if (!off) { setFailed(true); onError(e); } });
    return () => { off = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => filterChecks(rows ?? [], q), [rows, q]);
  const groups = useMemo(() => groupByDay(shown, new Date()), [shown]);

  return (
    <>
      <h1>Результаты</h1>
      {!rows && !failed && <div className="ck-loading" aria-label="Загрузка"><i /><i /><i /></div>}
      {rows?.length === 0 && <p className="ck-p">Здесь появятся сохранённые работы. Вернитесь назад и проверьте первый бланк.</p>}
      {!!rows?.length && (
        <>
          <button className="tg-btn-secondary" onClick={() => void exportOmrChecksToExcel(shown, 'Результаты').catch(() => onError(new Error('Не удалось сохранить файл Excel. Попробуйте ещё раз.')))}>
            <Download size={18} aria-hidden="true" />Скачать в Excel{q.trim() ? ` (${shown.length})` : ''}
          </button>
          <label className="tg-field" style={{ marginTop: 14 }}><span>Поиск</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="имя, вариант или дата" /></label>
          {!shown.length && <p className="ck-p">Ничего не найдено.</p>}
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="ck-section">{g.label}<small>{g.rows.length}</small></h2>
              <div className="ck-list">
                {g.rows.map((r) => (
                  <button key={r.id} className="ck-item" onClick={() => onOpen(r)}>
                    <span className="tg-grow">{r.student || 'Без имени'}<span className="ck-sub">{new Date(r.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}{r.ticket_number ? `, вариант ${r.ticket_number}` : ''}</span></span>
                    <span className={`pts ck-${tone(r.score, r.max_score)}`}>{r.score} из {r.max_score}<small>{percent(r.score, r.max_score)} %</small></span>
                    <ChevronRight size={18} className="tg-chev" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  );
}

export function ResultDetail({ api, row, onError, onDeleted }: { api: Api; row: SavedCheck; onError: (e: unknown) => void; onDeleted: () => void }) {
  const [check, setCheck] = useState<(SavedCheck & { details?: unknown }) | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let off = false;
    api<{ check: SavedCheck & { details?: unknown } }>('check_get', { id: row.id })
      .then((r) => { if (!off) setCheck(r.check); })
      .catch((e) => { if (!off) { setFailed(true); onError(friendly(e, 'Разбор работы')); } });
    return () => { off = true; };
  }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = useMemo(() => parseDetails(check?.details), [check]);
  const wrong = useMemo(() => (d ? wrongList(scoreAnswers(d.key, d.answers)) : []), [d]);

  async function remove() {
    if (!(await confirmDialog(`Удалить результат «${row.student || 'Без имени'}»? Вернуть его нельзя.`))) return;
    setBusy(true);
    try { await api('check_delete', { id: row.id }); onDeleted(); } catch (e) { onError(friendly(e, 'Удаление')); setBusy(false); }
  }

  return (
    <>
      <h1>{row.student || 'Без имени'}</h1>
      <p className="ck-p">{new Date(row.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}{row.ticket_number ? `, вариант ${row.ticket_number}` : ''}</p>
      <div className="ck-card">
        <div className={`ck-score ck-${tone(row.score, row.max_score)}`}>{row.score} <small>из {row.max_score}, {percent(row.score, row.max_score)} %</small></div>
        {d && <p className="ck-sub">{wrong.length ? `Ошибки и пропуски: ${wrong.join(', ')}` : 'Все ответы верны'}</p>}
      </div>
      {!check && !failed && <div className="ck-loading" aria-label="Загрузка"><i /><i /></div>}
      {check && !d && <p className="ck-p">Подробности этой работы не сохранились, есть только балл.</p>}
      {d && (
        <div className="ck-card">
          <CompareLegend />
          <SheetGrid comp={{ test: d.key.tests.length, matching: d.key.matching.length, open: d.key.open.length }} answers={d.answers} compare={d.key} />
        </div>
      )}
      <button className="ck-text danger" disabled={busy} onClick={() => void remove()}><Trash2 size={18} aria-hidden="true" />Удалить результат</button>
    </>
  );
}
