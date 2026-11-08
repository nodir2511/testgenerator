import React from 'react';
import { Check, Eye } from 'lucide-react';
import { FormattedText } from './FormulaEditor';
import { Card, CardTitle } from './ui';
import type { QuestionType } from '../types/database';

interface Item { text?: string; text_ru?: string; text_tg?: string; image_url?: string | null; is_correct?: boolean; match?: number | null }

const LETTERS = 'АБВГДЕЖЗ';

/** Живой предпросмотр вопроса рядом с формой (широкие экраны): так вопрос выглядит в банке и в билете */
export const QuestionPreview: React.FC<{
  type: QuestionType;
  contentRu: string;
  contentTg: string;
  imageUrl: string | null;
  options: Item[];
  leftItems: Item[];
  rightItems: Item[];
  correctNumeric: string;
  mode: 'both' | 'ru' | 'tg';
}> = ({ type, contentRu, contentTg, imageUrl, options, leftItems, rightItems, correctNumeric, mode }) => {
  const showRu = mode !== 'tg';
  const showTg = mode !== 'ru';
  const t = (i: Item, lang: 'ru' | 'tg') => (lang === 'ru' ? i.text_ru ?? i.text : i.text_tg) || '';
  const Text: React.FC<{ ru: string; tg: string }> = ({ ru, tg }) => (
    <>
      {showRu && ru && <div><FormattedText text={ru} /></div>}
      {showTg && tg && <div className={showRu && ru ? 'text-slate-600' : ''}><FormattedText text={tg} /></div>}
    </>
  );
  const empty = !(showRu && contentRu.trim()) && !(showTg && contentTg.trim());

  return (
    <Card padding="md" className="space-y-3">
      <CardTitle icon={Eye}>Предпросмотр</CardTitle>
      {empty ? (
        <p className="text-sm text-slate-600">Начните вводить текст вопроса — здесь сразу будет видно, как он выглядит.</p>
      ) : (
        <div className="text-sm text-slate-900 leading-relaxed space-y-1 break-words"><Text ru={contentRu} tg={contentTg} /></div>
      )}
      {imageUrl && <img src={imageUrl} alt="" className="max-h-40 rounded-xl border border-slate-200 bg-white object-contain" />}

      {type === 'test' && (
        <ul className="space-y-1.5">
          {options.map((o, i) => {
            const ru = t(o, 'ru'), tg = t(o, 'tg');
            if (!ru && !tg && !o.image_url) return null;
            return (
              <li key={i} className={`flex gap-2 items-start rounded-xl border px-2.5 py-2 text-sm ${o.is_correct ? 'border-success-line bg-success-soft' : 'border-slate-200 bg-white'}`}>
                <span className={`w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${o.is_correct ? 'bg-success-solid text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {o.is_correct ? <Check className="w-3.5 h-3.5" /> : LETTERS[i]}
                </span>
                <span className="min-w-0 break-words space-y-0.5"><Text ru={ru} tg={tg} /></span>
              </li>
            );
          })}
        </ul>
      )}

      {type === 'matching' && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <ol className="space-y-1.5">
            {leftItems.map((l, i) => (t(l, 'ru') || t(l, 'tg')) && (
              <li key={i} className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 break-words">
                <b className="text-slate-500 mr-1">{i + 1}.</b><Text ru={t(l, 'ru')} tg={t(l, 'tg')} />
                {l.match != null && <span className="block text-xs font-semibold text-success mt-0.5">Ответ: {LETTERS[l.match]}</span>}
              </li>
            ))}
          </ol>
          <ol className="space-y-1.5">
            {rightItems.map((r, i) => (t(r, 'ru') || t(r, 'tg')) && (
              <li key={i} className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 break-words">
                <b className="text-slate-500 mr-1">{LETTERS[i]}.</b><Text ru={t(r, 'ru')} tg={t(r, 'tg')} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {type === 'open' && correctNumeric !== '' && (
        <p className="text-sm font-semibold text-success">Верный ответ: {correctNumeric}</p>
      )}
    </Card>
  );
};
