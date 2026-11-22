import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Subject, Chapter, Topic } from '../../types/database';
import { plural } from '../../lib/generatorHelpers';
import { CustomSelect } from '../CustomSelect';
import { Card } from '../ui';
import { TriCheckbox } from './Controls';

export type ScopeMode = 'all' | 'pick';

interface ScopeColumnProps {
  subjects: Subject[];
  subjectId: string;
  applyPresetForSubject: (sId: string) => void;
  scopeMode: ScopeMode;
  setScopeMode: React.Dispatch<React.SetStateAction<ScopeMode>>;
  chapters: Chapter[];
  allTopics: Topic[];
  pickEmpty: boolean;
  selectedChaptersCount: number;
  selectedTopicIds: string[];
  setSelectedTopicIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedChapterIds: string[];
  setSelectedChapterIds: React.Dispatch<React.SetStateAction<string[]>>;
  expandedChapterIds: Record<string, boolean>;
  handleSelectChapterTopics: (chId: string) => void;
  handleDeselectChapterTopics: (chId: string) => void;
  handleToggleTopic: (tpId: string, chId: string, checked: boolean) => void;
  toggleChapterExpanded: (chId: string) => void;
}

// Левая колонка генератора: предмет, главы и темы. Состояние и обработчики — в TicketGenerator
export const ScopeColumn: React.FC<ScopeColumnProps> = ({
  subjects, subjectId, applyPresetForSubject, scopeMode, setScopeMode, chapters, allTopics, pickEmpty, selectedChaptersCount, selectedTopicIds,
  setSelectedTopicIds, selectedChapterIds, setSelectedChapterIds, expandedChapterIds, handleSelectChapterTopics, handleDeselectChapterTopics,
  handleToggleTopic, toggleChapterExpanded,
}) => (
  <div className="md:col-span-3 xl:col-span-7 space-y-4 sm:space-y-5">
    {/* 1. Предмет */}
    <Card as="section" padding="none" className="p-4 sm:p-5 space-y-3">
      <h3 className="font-bold text-slate-900 text-base">1. Предмет</h3>
      {subjects.length <= 8 ? (
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => s.id !== subjectId && applyPresetForSubject(s.id)}
              className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold border transition active:scale-95 ${
                s.id === subjectId
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
              aria-pressed={s.id === subjectId}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : (
        <CustomSelect
          value={subjectId}
          onChange={(val) => applyPresetForSubject(val)}
          className="w-full min-h-[44px] text-base px-3 bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-900"
        >
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </CustomSelect>
      )}
    </Card>

    {/* 2. Что включить: весь предмет или выбранные главы */}
    <Card as="section" padding="none" className="p-4 sm:p-5 space-y-3">
      <h3 className="font-bold text-slate-900 text-base">2. Какие главы</h3>
      <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-2xl" role="radiogroup" aria-label="Какие главы">
        {([['all', 'Весь предмет'], ['pick', 'Выбрать главы']] as const).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={scopeMode === mode}
            onClick={() => setScopeMode(mode)}
            className={`min-h-[44px] rounded-xl text-sm font-semibold transition ${
              scopeMode === mode ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {scopeMode === 'all' ? (
        <p className="text-sm text-slate-600 px-1">
          В билеты войдут все {chapters.length} {plural(chapters.length, 'глава', 'главы', 'глав')} и {allTopics.length} {plural(allTopics.length, 'тема', 'темы', 'тем')}.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-sm text-slate-600">
              {pickEmpty ? 'Отметьте нужные главы' : `Выбрано глав: ${selectedChaptersCount} из ${chapters.length}`}
            </span>
            {!pickEmpty && (
              <button
                type="button"
                onClick={() => { setSelectedTopicIds([]); setSelectedChapterIds([]); }}
                className="min-h-[36px] px-2 text-sm font-semibold text-slate-500 hover:text-slate-800"
              >
                Снять всё
              </button>
            )}
          </div>
          <div className="space-y-2 md:max-h-[60vh] md:overflow-y-auto md:pr-1">
            {chapters.map((ch, chIdx) => {
              const chTopics = allTopics.filter(t => t.chapter_id === ch.id);
              const chSelected = chTopics.filter(t => selectedTopicIds.includes(t.id)).length;
              const isAll = chTopics.length > 0 ? chSelected === chTopics.length : selectedChapterIds.includes(ch.id);
              const isExpanded = expandedChapterIds[ch.id] ?? false;
              return (
                <div key={ch.id} className={`border rounded-2xl overflow-hidden transition ${chSelected > 0 || isAll ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-stretch">
                    <label className="flex items-start gap-3 flex-1 min-w-0 p-3 cursor-pointer select-none">
                      <TriCheckbox
                        checked={isAll}
                        indeterminate={chSelected > 0}
                        onChange={(v) => (v ? handleSelectChapterTopics(ch.id) : handleDeselectChapterTopics(ch.id))}
                        className="mt-0.5 w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900 leading-snug break-words">{ch.name}</span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                          {chSelected > 0 && !isAll ? `Тем: ${chSelected} из ${chTopics.length}` : `${chTopics.length} ${plural(chTopics.length, 'тема', 'темы', 'тем')}`}
                        </span>
                      </span>
                    </label>
                    {chTopics.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleChapterExpanded(ch.id)}
                        className="w-12 shrink-0 flex items-center justify-center text-slate-500 hover:text-slate-700 border-l border-slate-100 min-h-[40px]"
                        aria-label={isExpanded ? `Свернуть темы главы ${chIdx + 1}` : `Показать темы главы ${chIdx + 1}`}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? <ChevronDown className="w-5 h-5 text-indigo-600" /> : <ChevronRight className="w-5 h-5" />}
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="px-2 pb-2 space-y-1 border-t border-slate-100 bg-white">
                      {chTopics.map((tp, tpIdx) => {
                        const isChecked = selectedTopicIds.includes(tp.id);
                        return (
                          <label
                            key={tp.id}
                            className={`flex items-start gap-3 px-2.5 py-2.5 mt-1 rounded-xl cursor-pointer text-sm transition ${
                              isChecked ? 'bg-indigo-50 text-slate-900 font-medium' : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => handleToggleTopic(tp.id, ch.id, e.target.checked)}
                              className="mt-0.5 w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 shrink-0"
                            />
                            <span className="leading-snug">{tpIdx + 1}. {tp.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  </div>
);
