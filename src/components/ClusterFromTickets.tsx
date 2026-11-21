import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { saveAs } from 'file-saver';
import { CheckCircle2, Download, FileText, Archive, Loader2, AlertTriangle, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { describeError } from '../lib/errors';
import { isClusterBatch } from '../lib/clusterStore';
import { CLUSTER_SLOTS, buildClusterZip, type ClusterSettings } from '../lib/clusterExport';
import { checkSlot, orderByType, snapshotFromPaired, type Snap } from '../lib/clusterTickets';
import type { ParsedArchive } from '../lib/clusterArchive';
import { CustomSelect } from './CustomSelect';
import { Button, Card, Field } from './ui';

// Экзамен-кластер из готовых билетов: для каждого предмета — один билет из «Архива билетов»
// или пара файлов Word (RU + TJ), в том числе сборники не из системы. Собирается только книжка
// (RU и TJ), без ключей; в базу ничего не пишется. Можно взять часть предметов, например химию и биологию.

type Mode = 'archive' | 'zip' | 'file' | 'off';

/** Поле файла: можно перетащить файл сюда или нажать и выбрать (внутри `Field`, поэтому клик по зоне открывает выбор сам) */
const FileDrop: React.FC<{ accept: '.zip' | '.docx'; file: File | null; onFile: (f: File) => void }> = ({ accept, file, onFile }) => {
  const [over, setOver] = useState(false);
  const [bad, setBad] = useState('');
  const take = (f: File | undefined | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(accept)) { setBad(`Нужен файл ${accept}, а это «${f.name}»`); return; }
    setBad('');
    onFile(f);
  };
  return (
    <span
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
      className={`flex flex-col items-center justify-center gap-1 min-h-[76px] px-3 py-3 rounded-xl border-2 border-dashed text-center cursor-pointer transition ${
        over ? 'border-indigo-500 bg-indigo-50' : file ? 'border-emerald-300 bg-emerald-50' : 'border-slate-300 bg-white hover:border-indigo-400'
      }`}
    >
      <input type="file" accept={accept} className="sr-only" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
      <Upload className={`w-5 h-5 pointer-events-none ${file ? 'text-emerald-700' : 'text-slate-500'}`} />
      <span className="text-sm font-semibold text-slate-800 break-all pointer-events-none">
        {file ? file.name : 'Перетащите файл сюда или нажмите, чтобы выбрать'}
      </span>
      {file && <span className="text-xs text-slate-600 pointer-events-none">Чтобы заменить, перетащите другой файл или нажмите</span>}
      {bad && <span role="alert" className="text-xs font-semibold text-red-700">{bad}</span>}
    </span>
  );
};

interface Slot {
  mode: Mode;
  batchId: string;
  ticketNumber: number;
  ruFile: File | null;
  tgFile: File | null;
  /** ZIP архива предмета из обычного генератора (папки «Русский» и «Тоҷикӣ», ключи) */
  zipFile: File | null;
  /** Разобранный архив: все варианты предмета с ответами из ключа */
  archive: ParsedArchive | null;
  /** Вопросы билета в порядке книжки; null — ещё не загружены */
  snaps: Snap[] | null;
  /** Откуда взяты вопросы (для подписи) */
  label: string;
  /** Задания файла, которые не удалось разобрать (в книжку не попали) */
  skipped: string[];
  loading: boolean;
  error: string | null;
}

// Быстрый выбор состава книжки
const PRESETS: Array<{ label: string; kinds: string[] }> = [
  { label: 'Все 4 предмета', kinds: ['taj', 'bio', 'chem', 'phys'] },
  { label: 'Химия + биология (ХБ)', kinds: ['bio', 'chem'] },
];

const emptySlot = (): Slot => ({ mode: 'archive', batchId: '', ticketNumber: 1, ruFile: null, tgFile: null, zipFile: null, archive: null, snaps: null, label: '', skipped: [], loading: false, error: null });

// Наборы предмета из архива (без экзаменов-кластеров), новые сверху
function useBatches(subjectId: string) {
  return useQuery({
    queryKey: ['cluster_ticket_batches', subjectId],
    enabled: Boolean(subjectId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_batches')
        .select('id, title, created_at, generation_params, tickets(count)')
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).filter((b: any) => !isClusterBatch(b)).map((b: any) => ({
        id: b.id as string,
        title: b.title as string,
        date: new Date(b.created_at).toLocaleDateString('ru-RU'),
        count: Number(b.tickets?.[0]?.count ?? b.generation_params?.ticket_count ?? 1),
      }));
    },
  });
}

async function loadArchiveTicket(batchId: string, n: number): Promise<Snap[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('ticket_number, questions:ticket_questions(order_index, question_snapshot)')
    .eq('batch_id', batchId)
    .eq('ticket_number', n)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`В наборе нет билета №${n}`);
  const qs = [...((data as any).questions || [])].sort((a: any, b: any) => a.order_index - b.order_index);
  return qs.map((q: any) => q.question_snapshot).filter((s: any) => s && !s.empty);
}

async function loadFileTicket(ru: File, tg: File, slotIndex: number): Promise<{ snaps: Snap[]; skipped: string[] }> {
  // Разбор Word грузится только когда нужен
  const [{ parseDocxFile }, { pairBilingual }] = await Promise.all([import('../lib/docxImport'), import('../lib/docxPair')]);
  // Соответствия как в сборниках разбираются только здесь (в «Массовом импорте» — выключено)
  const [r, t] = await Promise.all([parseDocxFile(ru, undefined, { matching: true }), parseDocxFile(tg, undefined, { matching: true })]);
  if (!r.questions.length) throw new Error('В русском файле не найдено заданий');
  const pairs = pairBilingual(r.questions, t.questions);
  const skipped: string[] = [];
  const snaps: Snap[] = [];
  pairs.forEach((p, i) => {
    if (p.errors.length) { skipped.push(`№${p.num}: ${p.errors[0]}`); return; }
    if (p.type === 'test' && (!p.options || p.options.length < 2)) { skipped.push(`№${p.num}: меньше двух вариантов ответа`); return; }
    snaps.push(snapshotFromPaired(p, `f${slotIndex}-${i + 1}`));
  });
  return { snaps, skipped };
}

const SlotCard: React.FC<{
  index: number; slot: Slot; subjectId: string; subjects: Array<{ id: string; name: string }>;
  onSubject: (id: string) => void;
  onChange: (patch: Partial<Slot>) => void;
}> = ({ index, slot, subjectId, subjects, onSubject, onChange }) => {
  const def = CLUSTER_SLOTS[index];
  const { data: batches = [], isLoading: batchesLoading } = useBatches(slot.mode === 'archive' ? subjectId : '');
  const batch = batches.find((b) => b.id === slot.batchId);
  const check = slot.snaps ? checkSlot(slot.snaps, def.counts) : null;

  const load = async () => {
    onChange({ loading: true, error: null, archive: null });
    try {
      if (slot.mode === 'archive') {
        if (!slot.batchId) throw new Error('Выберите набор из архива');
        const snaps = orderByType(await loadArchiveTicket(slot.batchId, slot.ticketNumber));
        if (!snaps.length) throw new Error('В билете нет вопросов');
        onChange({ snaps, skipped: [], label: `${batch?.title ?? 'Набор'} · билет №${slot.ticketNumber}`, loading: false });
      } else if (slot.mode === 'zip') {
        if (!slot.zipFile) throw new Error('Выберите ZIP-архив предмета');
        const { parseSubjectArchive } = await import('../lib/clusterArchive');
        const archive = await parseSubjectArchive(slot.zipFile);
        onChange({ archive, snaps: null, skipped: [], label: slot.zipFile.name, loading: false });
      } else {
        if (!slot.ruFile || !slot.tgFile) throw new Error('Выберите оба файла: русский и таджикский');
        const { snaps, skipped } = await loadFileTicket(slot.ruFile, slot.tgFile, index);
        if (!snaps.length) throw new Error('Ни одно задание файла не разобрано');
        onChange({ snaps: orderByType(snaps), skipped, label: slot.ruFile.name, loading: false });
      }
    } catch (e) {
      onChange({ loading: false, snaps: null, archive: null, error: describeError(e, 'Не удалось загрузить билет') });
    }
  };

  const modeBtn = (m: Mode, label: string, Icon?: React.ComponentType<{ className?: string }>) => (
    <button
      type="button"
      onClick={() => onChange({ mode: m, snaps: null, archive: null, error: null, skipped: [] })}
      className={`inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-lg text-sm font-semibold border ${slot.mode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
    >
      {Icon && <Icon className="w-4 h-4" />}<span>{label}</span>
    </button>
  );

  return (
    <div className={`p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-3 ${slot.mode === 'off' ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-slate-800">{index + 1}. {def.name}</span>
        <div className="flex flex-wrap gap-1.5">
          {modeBtn('zip', 'Архив ZIP', Archive)}
          {modeBtn('archive', 'Из архива', Archive)}
          {modeBtn('file', 'Файлы Word', FileText)}
          {modeBtn('off', 'Не включать')}
        </div>
      </div>

      {slot.mode === 'archive' && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.6fr_auto_auto] gap-3 items-end">
          <Field label="Предмет в базе">
            <CustomSelect className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg" value={subjectId} onChange={(v) => { onSubject(v); onChange({ batchId: '', snaps: null }); }}>
              <option value="">— выберите предмет —</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </CustomSelect>
          </Field>
          <Field label="Набор билетов">
            <CustomSelect className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg" value={slot.batchId} disabled={!subjectId} onChange={(v) => onChange({ batchId: v, ticketNumber: 1, snaps: null })}>
              <option value="">{batchesLoading ? 'Загрузка…' : batches.length ? '— выберите набор —' : 'нет наборов'}</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.title} · {b.date} · билетов: {b.count}</option>)}
            </CustomSelect>
          </Field>
          <Field label="Билет №">
            <input
              type="number" min={1} max={batch?.count ?? 99}
              className="w-20 text-sm px-2 py-2 border border-slate-300 rounded-lg text-center"
              value={slot.ticketNumber}
              onChange={(e) => onChange({ ticketNumber: Math.max(1, Math.min(batch?.count ?? 99, Number(e.target.value) || 1)), snaps: null })}
            />
          </Field>
          <Button variant="primary" size="sm" loading={slot.loading} disabled={!slot.batchId} onClick={load}>Взять билет</Button>
        </div>
      )}

      {slot.mode === 'zip' && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <Field label="Архив предмета (.zip): папки «Русский» и «Тоҷикӣ» и файл ключей, как скачан из «Архива билетов»">
            <FileDrop accept=".zip" file={slot.zipFile} onFile={(f) => onChange({ zipFile: f, archive: null })} />
          </Field>
          <Button variant="primary" size="sm" loading={slot.loading} disabled={!slot.zipFile} onClick={load}>Разобрать</Button>
        </div>
      )}
      {slot.mode === 'zip' && slot.archive && (
        <div className="space-y-2">
          <p className="text-xs text-slate-700">
            <strong>{slot.label}</strong>: вариантов {slot.archive.variants.length} ({slot.archive.variants.map((v) => v.number).join(', ')}); в варианте тестов {slot.archive.variants[0].snaps.filter((q) => q.type === 'test').length}, соответствий {slot.archive.variants[0].snaps.filter((q) => q.type === 'matching').length}, открытых {slot.archive.variants[0].snaps.filter((q) => q.type === 'open').length}
          </p>
          {slot.archive.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{w}</span>
            </p>
          ))}
          {slot.archive.variants.some((v) => v.skipped.length > 0) && (
            <details className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              <summary className="cursor-pointer font-semibold">Не разобрано заданий — в книжку не попали</summary>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">{slot.archive.variants.flatMap((v) => v.skipped.map((t) => `Вариант ${v.number}, ${t}`)).map((t, i) => <li key={i}>{t}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {slot.mode === 'file' && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <Field label="Русский файл (.docx)">
            <FileDrop accept=".docx" file={slot.ruFile} onFile={(f) => onChange({ ruFile: f, snaps: null })} />
          </Field>
          <Field label="Таджикский файл (.docx)">
            <FileDrop accept=".docx" file={slot.tgFile} onFile={(f) => onChange({ tgFile: f, snaps: null })} />
          </Field>
          <Button variant="primary" size="sm" loading={slot.loading} disabled={!slot.ruFile || !slot.tgFile} onClick={load}>Разобрать</Button>
        </div>
      )}
      {slot.mode === 'file' && !slot.snaps && (
        <p className="text-xs text-slate-500">Подходят и сборники не из системы: задания с номером «1.», варианты «A) … D)», соответствия — таблицей в две колонки («A) … D)» и «1) … 5)») или строками. Нумерация в русском и таджикском файлах должна совпадать. В банк вопросы не добавляются.</p>
      )}

      {slot.error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{slot.error}</p>}

      {slot.snaps && check && (
        <div className="space-y-2">
          <p className="text-xs text-slate-700">
            <strong>{slot.label}</strong>: тестов {check.counts.test}, соответствий {check.counts.matching}, открытых {check.counts.open}
          </p>
          {check.notes.length > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Состав не как в книжке НЦТ ({def.counts.test} + {def.counts.matching} + {def.counts.open}): {check.notes.join(', ')}. Книжка всё равно соберётся.</span>
            </p>
          )}
          {slot.skipped.length > 0 && (
            <details className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              <summary className="cursor-pointer font-semibold">Не разобрано заданий: {slot.skipped.length} — в книжку не попали</summary>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">{slot.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

export const ClusterFromTickets: React.FC<{
  settings: ClusterSettings;
  subjects: Array<{ id: string; name: string }>;
  subjectIds: string[];
  onSubject: (index: number, id: string) => void;
}> = ({ settings, subjects, subjectIds, onSubject }) => {
  const [slots, setSlots] = useState<Slot[]>(() => CLUSTER_SLOTS.map(emptySlot));
  const [variantNo, setVariantNo] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; fileName: string } | null>(null);

  const patch = (i: number, p: Partial<Slot>) => {
    setResult(null);
    setSlots((all) => all.map((s, j) => (j === i ? { ...s, ...p } : s)));
  };

  // Готовый состав: выбранные предметы включаются (с прежним источником), остальные — «Не включать»
  const applyPreset = (kinds: string[]) => {
    setResult(null);
    setSlots((all) => all.map((s, i) => {
      const want = kinds.includes(CLUSTER_SLOTS[i].kind);
      if (want && s.mode === 'off') return { ...s, mode: 'archive' };
      if (!want && s.mode !== 'off') return { ...s, mode: 'off', snaps: null, error: null, skipped: [] };
      return s;
    }));
  };

  const active = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.mode !== 'off');
  const ready = active.length > 0 && active.every(({ s }) => (s.mode === 'zip' ? s.archive : s.snaps && s.snaps.length > 0));

  const build = async () => {
    setError(null);
    setResult(null);
    try {
      if (!settings.code.trim()) throw new Error('Укажите код кластера (например, А.5)');
      if (!settings.exam.trim()) throw new Error('Укажите название экзамена (например, Авг)');
      if (!settings.date.trim()) throw new Error('Выберите дату экзамена в календаре');
      if (!active.length) throw new Error('Включите хотя бы один предмет');
      const notLoaded = active.find(({ s }) => (s.mode === 'zip' ? !s.archive : !s.snaps));
      if (notLoaded) throw new Error(`Предмет «${CLUSTER_SLOTS[notLoaded.i].name}»: сначала возьмите билет (кнопка «Взять билет» или «Разобрать»)`);
      const zips = active.filter(({ s }) => s.mode === 'zip');
      if (zips.length && zips.length !== active.length) throw new Error('Архивы ZIP нельзя смешивать с одиночными билетами: у всех включённых предметов выберите «Архив ZIP» или ни у одного');
      setBusy(true);
      let variants: Array<{ number: number; subjects: Array<Snap[] | null> }>;
      if (zips.length) {
        // Книжка N — вариант N каждого предмета; номера вариантов во всех архивах должны совпасть
        const nums = (a: ParsedArchive) => a.variants.map((v) => v.number).join(', ');
        const first = nums(zips[0].s.archive!);
        const diff = zips.find(({ s }) => nums(s.archive!) !== first);
        if (diff) throw new Error(`Номера вариантов в архивах разные: у «${CLUSTER_SLOTS[zips[0].i].name}» — ${first}, у «${CLUSTER_SLOTS[diff.i].name}» — ${nums(diff.s.archive!)}`);
        variants = zips[0].s.archive!.variants.map((v) => ({
          number: v.number,
          subjects: slots.map((s) => (s.mode === 'off' ? null : s.archive!.variants.find((x) => x.number === v.number)!.snaps)),
        }));
      } else {
        variants = [{ number: variantNo, subjects: slots.map((s) => (s.mode === 'off' ? null : s.snaps)) }];
      }
      // Одиночные билеты — только книжки RU и TJ; из архивов — ещё и ключи: готовые файлы из архивов с новой шапкой (код кластера)
      const file = await buildClusterZip(settings, variants, { keys: zips.length > 0, readyKeys: slots.map((sl) => (sl.mode === 'zip' ? sl.archive?.keyBytes ?? null : null)) });
      setResult({ blob: file.blob, fileName: file.fileName });
    } catch (e) {
      setError(describeError(e, 'Не удалось собрать книжку'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card padding="none" className="p-5 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">2. Билеты по предметам</h3>
        <p className="text-xs text-slate-500">
          Для каждого предмета возьмите один готовый билет из «Архива билетов» или загрузите пару файлов Word — получится один вариант книжки на русском и таджикском, без ключей. Либо загрузите по одному ZIP-архиву на предмет (как скачан из «Архива билетов», с ключами): вариант N каждого предмета станет книжкой N, и для 4 вариантов выйдет 8 книжек (4 русских и 4 таджикских) и готовые ключи из архивов с шапкой кластера.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">Состав книжки:</span>
          {PRESETS.map((p) => {
            const on = slots.every((s, i) => (s.mode !== 'off') === p.kinds.includes(CLUSTER_SLOTS[i].kind));
            return (
              <button key={p.label} type="button" onClick={() => applyPreset(p.kinds)}
                className={`px-3 min-h-[40px] rounded-lg text-sm font-semibold border ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
                {p.label}
              </button>
            );
          })}
        </div>
        <Field label="Номер варианта в книжке" className="max-w-[220px]">
          <input
            type="number" min={1} max={99} className="w-24 text-sm px-2 py-2 border border-slate-300 rounded-lg text-center"
            value={variantNo} onChange={(e) => { setResult(null); setVariantNo(Math.max(1, Math.min(99, Number(e.target.value) || 1))); }}
          />
        </Field>
        <div className="space-y-3">
          {slots.map((s, i) => (
            <SlotCard key={CLUSTER_SLOTS[i].kind} index={i} slot={s} subjectId={subjectIds[i] ?? ''} subjects={subjects}
              onSubject={(id) => onSubject(i, id)} onChange={(p) => patch(i, p)} />
          ))}
        </div>
      </Card>

      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

      <Button variant="primary" className="w-full sm:w-auto disabled:bg-slate-300" onClick={build} disabled={busy || !ready}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        <span>{busy ? 'Сборка книжек…' : 'Собрать книжку'}</span>
      </Button>

      {result && !busy && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 text-sm text-emerald-800">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>Книжка готова: <strong>{result.fileName}</strong> ({(result.blob.size / 1048576).toFixed(1)} МБ)</span>
          </div>
          <Button variant="primary" onClick={() => saveAs(result.blob, result.fileName)}>
            <Download className="w-4 h-4" />
            <span>Скачать архив</span>
          </Button>
        </div>
      )}
    </>
  );
};
