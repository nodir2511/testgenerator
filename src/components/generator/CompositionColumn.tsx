import React from 'react';
import { Sparkles, Loader2, ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { NctConfig, NctDifficultyShares } from '../../../supabase/functions/_shared/nct';
import type { fitSettings } from '../../../supabase/functions/_shared/ticketing';
import { plural, type standardFor } from '../../lib/generatorHelpers';
import { Badge, Card, Field } from '../ui';
import { Stepper } from './Controls';
import type { ScopeMode } from './ScopeColumn';
import type { GenCfg } from './useGenerate';

// Сколько вопросов и текстов есть в выбранных главах и темах
export interface PoolCounts { total: number; test: number; matching: number; open: number; reading: number; cloze: number }

// Индикатор готовности: хватает ли вопросов и чем это исправить
export interface HealthInfo {
  status: 'red' | 'amber' | 'green';
  title: string;
  desc: string;
  safe: number;
  fixCounts?: boolean;
  fixTickets?: boolean;
}

interface CompositionColumnProps {
  subjectName: string;
  isStaff: boolean;
  isOwner: boolean;
  limits: { perType: number; tickets: number };
  userLimits: { perDay: number };
  leftToday: number | null;
  editComposition: boolean;
  setEditComposition: React.Dispatch<React.SetStateAction<boolean>>;
  testCount: number;
  setTestCount: React.Dispatch<React.SetStateAction<number>>;
  matchingCount: number;
  setMatchingCount: React.Dispatch<React.SetStateAction<number>>;
  openCount: number;
  setOpenCount: React.Dispatch<React.SetStateAction<number>>;
  readingCount: number;
  setReadingCount: React.Dispatch<React.SetStateAction<number>>;
  clozeCount: number;
  setClozeCount: React.Dispatch<React.SetStateAction<number>>;
  showTexts: boolean;
  standard: ReturnType<typeof standardFor>;
  isStandard: boolean;
  poolStats: PoolCounts | undefined;
  isChem: boolean;
  nctCfg: NctConfig;
  nctPref: boolean;
  setNctPref: React.Dispatch<React.SetStateAction<boolean>>;
  nctMode: boolean;
  diffShares: NctDifficultyShares;
  setDiffShare: (key: keyof NctDifficultyShares, raw: string) => void;
  diffSum: number;
  permAvailable: boolean;
  permPref: boolean;
  setPermPref: React.Dispatch<React.SetStateAction<boolean>>;
  variantChoices: number[];
  ticketCount: number;
  setTicketCount: React.Dispatch<React.SetStateAction<number>>;
  pickEmpty: boolean;
  health: HealthInfo | null;
  healthDot: string;
  fitted: ReturnType<typeof fitSettings>;
  fittedTotal: number;
  scopeMode: ScopeMode;
  setScopeMode: React.Dispatch<React.SetStateAction<ScopeMode>>;
  showExtra: boolean;
  setShowExtra: React.Dispatch<React.SetStateAction<boolean>>;
  customTitle: string;
  setCustomTitle: React.Dispatch<React.SetStateAction<string>>;
  autoTitle: string;
  shuffleOptions: boolean;
  setShuffleOptions: React.Dispatch<React.SetStateAction<boolean>>;
  shuffleMatching: boolean;
  setShuffleMatching: React.Dispatch<React.SetStateAction<boolean>>;
  handleGenerate: (cfg?: GenCfg) => Promise<void>;
  isGenerating: boolean;
  genProgress: { percent: number; stage: string };
  blockReason: string | null;
  /** созданный набор (нужен только факт, что он есть) */
  generatedBatch: any | null;
}

// Правая колонка генератора: состав билета, режим НЦТ, число вариантов, готовность, название и кнопка создания.
// Состояние и обработчики — в TicketGenerator
export const CompositionColumn: React.FC<CompositionColumnProps> = ({
  subjectName, isStaff, isOwner, limits, userLimits, leftToday, editComposition, setEditComposition, testCount, setTestCount, matchingCount,
  setMatchingCount, openCount, setOpenCount, readingCount, setReadingCount, clozeCount, setClozeCount, showTexts, standard, isStandard, poolStats,
  isChem, nctCfg, nctPref, setNctPref, nctMode, diffShares, setDiffShare, diffSum, permAvailable, permPref, setPermPref, variantChoices, ticketCount,
  setTicketCount, pickEmpty, health, healthDot, fitted, fittedTotal, scopeMode, setScopeMode, showExtra, setShowExtra, customTitle, setCustomTitle,
  autoTitle, shuffleOptions, setShuffleOptions, shuffleMatching, setShuffleMatching, handleGenerate, isGenerating, genProgress, blockReason,
  generatedBatch,
}) => (
  <div className="md:col-span-2 xl:col-span-5 space-y-4 sm:space-y-5 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:pb-1">
    {/* 3. Состав билета: по умолчанию — стандарт предмета одной строкой */}
    <Card as="section" padding="none" className="p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-slate-900 text-base">3. Состав билета</h3>
          {!editComposition && (
            <p className="text-sm text-slate-700 mt-1">
              <b>{testCount + matchingCount + openCount}</b> {plural(testCount + matchingCount + openCount, 'вопрос', 'вопроса', 'вопросов')}: {testCount} тест. · {matchingCount} соотв. · {openCount} откр.
              {showTexts && readingCount + clozeCount > 0 && ` (в тестах: ${readingCount} ${plural(readingCount, 'текст', 'текста', 'текстов')} для чтения, ${clozeCount} с пропусками)`}
            </p>
          )}
          {!editComposition && isStandard && (
            <Badge tone="success" className="mt-1.5 rounded-full">
              Стандарт для предмета «{subjectName}»
            </Badge>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditComposition((v) => !v)}
          className="min-h-[40px] px-3 rounded-xl text-sm font-semibold text-indigo-700 hover:bg-indigo-50 shrink-0"
        >
          {editComposition ? 'Готово' : 'Изменить'}
        </button>
      </div>

      {isChem && (
        <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={nctPref}
            onChange={(e) => { setNctPref(e.target.checked); try { localStorage.setItem('examiner_nct_mode', String(e.target.checked)); } catch { /* память недоступна */ } }}
          />
          <span className="text-sm text-slate-700">
            <b className="text-slate-900">Билет по формату НЦТ</b>
            <span className="block text-slate-500 mt-0.5">
              {nctCfg.composition.test + nctCfg.composition.matching + nctCfg.composition.open} заданий ({nctCfg.composition.test} тест. + {nctCfg.composition.matching} соотв. + {nctCfg.composition.open} откр.), {nctCfg.composition.points} баллов. {nctCfg.textSections ? <>Как в НЦТ 2026: сначала текст для чтения и 8 вопросов к нему (№ 1–8), затем текст с 8 пропусками (№ 9–16), потом 4 отдельных теста, 4 соответствия и 2 задания на порядок. Тексты берутся целиком, в разных вариантах — разные. Тип отдельного задания берётся по меткам, если они есть.</> : <>Задания идут блоками разделов, как в НЦТ: {nctCfg.sections.map((x) => x.name.toLowerCase()).join(' → ')}; баллы делятся между пройденными разделами. {nctCfg.uiNote ?? 'На каждое место берётся тип задания по меткам (в билете типы не повторяются), около 16 баллов — из сборника НЦТ (источник «ЦВЭ»). Берутся главы 1–6 и темы 7.4–7.12 (растворы); остальные темы пока не берутся.'}</>}
            </span>
          </span>
        </label>
      )}

      {nctMode && isOwner && (
        <div className="rounded-xl border border-slate-200 p-3 space-y-2.5">
          <div className="text-sm">
            <b className="text-slate-900">Сложность тестов и соответствий</b>
            <span className="block text-slate-500 mt-0.5">Сколько процентов лёгких, средних и сложных заданий в билете. Сумма — 100 %.</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([['easy', 'Лёгкие'], ['medium', 'Средние'], ['hard', 'Сложные']] as const).map(([key, label]) => (
              <label key={key} className="block text-xs font-semibold text-slate-600">
                {label}, %
                <input
                  type="number" inputMode="numeric" min={0} max={100}
                  value={diffShares[key]}
                  onChange={(e) => setDiffShare(key, e.target.value)}
                  className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>
            ))}
          </div>
          <div className={`text-xs ${diffSum === 100 ? 'text-slate-500' : 'text-rose-600 font-semibold'}`}>
            Сумма: {diffSum} %. Открытые задачи всегда: {nctCfg.openDifficulty[0]} лёгких, {nctCfg.openDifficulty[1]} средних, {nctCfg.openDifficulty[2]} сложных.
          </div>
        </div>
      )}

      {nctMode && (
        <label className={`flex items-start gap-2.5 rounded-xl border border-slate-200 p-3 ${permAvailable ? 'cursor-pointer' : 'opacity-60'}`}>
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={permPref && permAvailable}
            disabled={!permAvailable}
            onChange={(e) => { setPermPref(e.target.checked); try { localStorage.setItem('examiner_nct_perm', String(e.target.checked)); } catch { /* память недоступна */ } }}
          />
          <span className="text-sm text-slate-700">
            <b className="text-slate-900">Переставленные варианты</b>
            <span className="block text-slate-500 mt-0.5">
              Разных вариантов только 2: вариант 3 — это вариант 1, а вариант 4 — вариант 2 с переставленными заданиями (тесты среди тестов, соответствия среди соответствий, открытые среди открытых). {permAvailable ? '' : 'Доступно при чётном числе вариантов от 4.'}
            </span>
          </span>
        </label>
      )}

      {editComposition && (
        <div className="divide-y divide-slate-100 -mt-1">
          {showTexts && (
            <>
              <Stepper label="Текстов для чтения" hint={`Доступно: ${poolStats?.reading ?? 0} (по 8 вопросов)`} value={readingCount} min={0} max={3} onChange={setReadingCount} />
              <Stepper label="Текстов с пропусками" hint={`Доступно: ${poolStats?.cloze ?? 0} (по 8 вопросов)`} value={clozeCount} min={0} max={3} onChange={setClozeCount} />
            </>
          )}
          <Stepper
            label="Тестовые"
            hint={showTexts ? `Вместе с вопросами текстов. Отдельных в билете: ${Math.max(0, testCount - 8 * (readingCount + clozeCount))}, доступно: ${poolStats?.test ?? 0}` : `Доступно: ${poolStats?.test ?? 0}`}
            value={testCount} min={0} max={limits.perType} onChange={setTestCount}
          />
          <Stepper label="На соответствие" hint={`Доступно: ${poolStats?.matching ?? 0}`} value={matchingCount} min={0} max={limits.perType} onChange={setMatchingCount} />
          <Stepper label="Открытые" hint={`Доступно: ${poolStats?.open ?? 0}`} value={openCount} min={0} max={limits.perType} onChange={setOpenCount} />
          {standard && !isStandard && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => { setTestCount(standard.test); setMatchingCount(standard.matching); setOpenCount(standard.open); setReadingCount(standard.reading ?? 0); setClozeCount(standard.cloze ?? 0); }}
                className="min-h-[40px] text-sm font-semibold text-indigo-700"
              >
                Вернуть стандарт: {standard.test} + {standard.matching} + {standard.open}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Число вариантов — меняют чаще всего, поэтому всегда на виду */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-slate-800">Вариантов</span>
          {isStaff && <span className="text-xs text-slate-500">до {limits.tickets}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {variantChoices.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTicketCount(n)}
              className={`min-w-[48px] min-h-[44px] px-3 rounded-xl text-base font-bold border transition active:scale-95 ${
                ticketCount === n ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
              aria-pressed={ticketCount === n}
            >
              {n}
            </button>
          ))}
        </div>
        {isStaff && (
          <Stepper label="Другое число" value={ticketCount} min={1} max={limits.tickets} onChange={setTicketCount} />
        )}
      </div>

      {/* Готовность: один блок и одна кнопка, которая исправляет проблему */}
      {pickEmpty ? (
        <div className="p-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
          Отметьте хотя бы одну главу — или выберите «Весь предмет».
        </div>
      ) : health && (
        <div className={`p-3 rounded-2xl border ${
          health.status === 'green' ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
          : health.status === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-900'
          : 'bg-rose-50 border-rose-200 text-rose-900'
        }`}>
          <div className="flex items-start gap-2.5">
            <span className={`w-3 h-3 rounded-full mt-1 shrink-0 ${healthDot}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold leading-snug">{health.title}</div>
              {health.desc && <p className="text-sm mt-0.5 leading-snug opacity-90">{health.desc}</p>}
              {health.status !== 'green' && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {'fixTickets' in health && health.fixTickets && (
                    <button
                      type="button"
                      onClick={() => setTicketCount(health.safe)}
                      className="min-h-[40px] px-3 rounded-xl bg-white border border-black/10 text-sm font-semibold active:scale-95"
                    >
                      Сделать {health.safe} {plural(health.safe, 'вариант', 'варианта', 'вариантов')}
                    </button>
                  )}
                  {'fixCounts' in health && health.fixCounts && (
                    <button
                      type="button"
                      onClick={() => { setTestCount(fitted.settings.testCount); setMatchingCount(fitted.settings.matchingCount); setOpenCount(fitted.settings.openCount); setReadingCount(fitted.settings.readingCount ?? 0); setClozeCount(fitted.settings.clozeCount ?? 0); }}
                      className="min-h-[40px] px-3 rounded-xl bg-white border border-black/10 text-sm font-semibold active:scale-95"
                    >
                      Сделать билет из {fittedTotal} вопр.
                    </button>
                  )}
                  {scopeMode === 'pick' && (
                    <button
                      type="button"
                      onClick={() => setScopeMode('all')}
                      className="min-h-[40px] px-3 rounded-xl bg-white border border-black/10 text-sm font-semibold active:scale-95"
                    >
                      Взять весь предмет
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Дополнительно: название и перемешивание — нужны редко */}
      <div className="border-t border-slate-100 pt-1">
        <button
          type="button"
          onClick={() => setShowExtra((v) => !v)}
          className="w-full min-h-[44px] flex items-center justify-between text-sm font-semibold text-slate-600"
        >
          <span className="flex items-center gap-2"><SlidersHorizontal className="w-4 h-4" /> Дополнительно</span>
          <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${showExtra ? 'rotate-180' : ''}`} />
        </button>
        {showExtra && (
          <div className="space-y-3 pb-1">
            <Field
              label="Название набора"
              hint={customTitle.trim() ? (
                <button type="button" onClick={() => setCustomTitle('')} className="font-semibold text-indigo-700 min-h-[32px]">
                  Вернуть автоматическое название
                </button>
              ) : 'Можно не заполнять — название подставится само'}
            >
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder={autoTitle}
                maxLength={100}
                className="w-full min-h-[44px] text-base px-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </Field>
            <label className="flex items-center gap-3 min-h-[40px] text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={shuffleOptions}
                onChange={(e) => setShuffleOptions(e.target.checked)}
                className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
              />
              <span>Перемешать варианты ответов (A, B, C, D)</span>
            </label>
            <label className="flex items-center gap-3 min-h-[40px] text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={shuffleMatching}
                onChange={(e) => setShuffleMatching(e.target.checked)}
                className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
              />
              <span>Перемешать пары в заданиях на соответствие</span>
            </label>
          </div>
        )}
      </div>
    </Card>

    {/* Кнопка генерации: на телефоне закреплена над нижним меню, на компьютере — под настройками */}
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-3 pb-2 pt-2 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent md:static md:inset-auto md:z-auto md:p-0 md:bg-none">
      <Card padding="none" className="max-w-5xl mx-auto p-2 pl-3.5 flex items-center gap-3 shadow-lg md:shadow-sm md:p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${healthDot}`} />
            <span className="truncate">{ticketCount} вар. × {fittedTotal} вопр.</span>
          </div>
          <div className="text-xs text-slate-500 leading-tight">
            {leftToday !== null
              ? `Сегодня ещё ${leftToday} из ${userLimits.perDay}`
              : subjectName}
          </div>
        </div>
        <button
          onClick={() => handleGenerate()}
          disabled={isGenerating || !!blockReason}
          className={`relative overflow-hidden min-h-[52px] px-3 min-[360px]:px-5 shrink-0 max-w-[62%] rounded-xl text-base font-bold flex ${generatedBatch && !isGenerating ? 'bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/25'} items-center justify-center gap-2 transition active:scale-[0.98] disabled:bg-slate-300 disabled:border-transparent disabled:text-slate-600 disabled:shadow-none shrink-0 max-w-[60%]`}
        >
          {isGenerating && (
            <div
              className="absolute left-0 top-0 bottom-0 bg-indigo-400/60 transition-all duration-300 ease-out"
              style={{ width: `${Math.max(10, genProgress.percent)}%` }}
            />
          )}
          <span className="relative z-10 flex items-center gap-2 min-w-0">
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                <span className="truncate">{genProgress.percent}%</span>
              </>
            ) : blockReason ? (
              <span className="truncate text-sm">{blockReason}</span>
            ) : (
              <>
                <Sparkles className="w-5 h-5 shrink-0" />
                <span className="truncate">Генерировать</span>
              </>
            )}
          </span>
        </button>
      </Card>
    </div>
    {/* Место под закреплённой кнопкой, чтобы она не закрывала конец страницы */}
    <div className="h-20 md:hidden" aria-hidden />
  </div>
);
