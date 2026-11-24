import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { describeError, must } from '../../lib/errors';
import type { Question, QuestionType } from '../../types/database';
import { useAuth } from '../../hooks/useAuth';
import { PASSAGE_QUESTIONS } from '../../lib/passages';
import { openAnswerProblem } from '../../lib/openAnswer';
import type { MatchingItemState, TestOptionState } from '../../lib/questionDraft';

// Всё, что сохранение читает из формы (состояние остаётся в QuestionForm)
export interface SaveQuestionDeps {
  initialData?: Question | null;
  uploadingImage: boolean;
  pendingUploads: number;
  subjectId: string;
  /** Название предмета: по нему считается число клеток открытого ответа */
  subjectName: string;
  chapterId: string;
  topicId: string;
  sourceId: string;
  nctType: string;
  nctDifficulty: string;
  type: QuestionType;
  /** Тестовый вопрос привязан к тексту темы */
  withPassage: boolean;
  passageId: string;
  passageOrder: string;
  contentRu: string;
  contentTg: string;
  imageUrl: string | null;
  correctNumeric: string;
  options: TestOptionState[];
  leftItems: MatchingItemState[];
  rightItems: MatchingItemState[];
  clearDraft: () => void;
  resetForNext: () => void;
  onSuccess: () => void;
  setErrorMsg: (msg: string | null) => void;
}

// Сохранение вопроса (Create / Update)
export function useSaveQuestion(deps: SaveQuestionDeps) {
  const queryClient = useQueryClient();
  const { user, isOwner } = useAuth();
  const {
    initialData, uploadingImage, pendingUploads,
    subjectId, subjectName, chapterId, topicId, sourceId, nctType, nctDifficulty,
    type, withPassage, passageId, passageOrder,
    contentRu, contentTg, imageUrl, correctNumeric,
    options, leftItems, rightItems,
    clearDraft, resetForNext, onSuccess, setErrorMsg,
  } = deps;

  const saveMutation = useMutation({
    // next — «Сохранить и добавить следующий»: форма остаётся открытой и очищается
    mutationFn: async (_next: boolean = false) => {
      if (uploadingImage || pendingUploads > 0) throw new Error('Картинка ещё загружается. Дождитесь окончания и сохраните снова.');
      if (!subjectId || !chapterId || !topicId) {
        throw new Error('Пожалуйста, выберите предмет, главу и тему');
      }
      // Вопрос к тексту может быть без условия: пропуск в тексте с пропусками
      if (!withPassage && !contentRu.trim() && !contentTg.trim()) {
        throw new Error('Пожалуйста, заполните текст вопроса (хотя бы на одном языке)');
      }
      if (withPassage && passageOrder && !(Number(passageOrder) >= 1 && Number(passageOrder) <= PASSAGE_QUESTIONS)) {
        throw new Error(`Место в тексте — число от 1 до ${PASSAGE_QUESTIONS}`);
      }

      if (type === 'test') {
        const validOptions = options.filter(
          o => (o.text_ru?.trim() || o.text_tg?.trim() || o.text?.trim() || o.image_url)
        );
        if (validOptions.length < 2) {
          throw new Error('Тестовый вопрос должен содержать минимум 2 варианта ответа');
        }
      }

      if (type === 'matching') {
        const validLeft = leftItems.filter(
          l => (l.text_ru?.trim() || l.text_tg?.trim() || l.text?.trim() || l.image_url)
        );
        const validRight = rightItems.filter(
          r => (r.text_ru?.trim() || r.text_tg?.trim() || r.text?.trim() || r.image_url)
        );
        if (validLeft.length === 0 || validRight.length === 0) {
          throw new Error('Заполните элементы в обеих колонках задания на соответствие');
        }
        const filledRight = (k: number | null | undefined) => k != null && !!rightItems[k] && !!(rightItems[k].text_ru?.trim() || rightItems[k].text_tg?.trim() || rightItems[k].text?.trim() || rightItems[k].image_url);
        if (validLeft.some(l => !filledRight(l.match))) {
          throw new Error('Укажите правильный ответ (номер из правой колонки) для каждого элемента левой колонки');
        }
        if (new Set(validLeft.map(l => l.match)).size !== validLeft.length) {
          throw new Error('Два элемента левой колонки не могут иметь один и тот же ответ');
        }
      }

      const numericVal = type === 'open' && correctNumeric.trim() !== '' ? Number(correctNumeric) : null;
      // Ключ открытого вопроса должен вписываться в клетки бланка: целое, без минуса, не длиннее клеток предмета
      const keyProblem = type === 'open' ? openAnswerProblem(numericVal, subjectName) : null;
      if (keyProblem) throw new Error(keyProblem);
      const primaryContent = contentRu.trim() || contentTg.trim();

      const buildOptionRows = (qid: string) =>
        options
          .filter(o => o.text_ru?.trim() || o.text_tg?.trim() || o.text?.trim() || o.image_url)
          .map((o, idx) => {
            const rText = (o.text_ru || o.text || '').trim();
            const tText = (o.text_tg || '').trim();
            return {
              question_id: qid,
              text: rText || tText,
              text_ru: rText || null,
              text_tg: tText || null,
              image_url: o.image_url,
              is_correct: o.is_correct || false,
              order_index: idx + 1,
            };
          });

      const buildItemRows = (qid: string) => {
        const map = (side: 'left' | 'right') => (x: MatchingItemState, idx: number) => {
          const rText = (x.text_ru || x.text || '').trim();
          const tText = (x.text_tg || '').trim();
          return {
            question_id: qid,
            side,
            text: rText || tText,
            text_ru: rText || null,
            text_tg: tText || null,
            image_url: x.image_url,
            order_index: idx + 1,
          };
        };
        const filled = (x: MatchingItemState) => x.text_ru?.trim() || x.text_tg?.trim() || x.text?.trim() || x.image_url;
        return [...leftItems.filter(filled).map(map('left')), ...rightItems.filter(filled).map(map('right'))];
      };

      // Записывает ответы (correct_match_id) для только что вставленных элементов соответствия
      const applyMatches = async (rows: any[]) => {
        const filled = (x: MatchingItemState) => x.text_ru?.trim() || x.text_tg?.trim() || x.text?.trim() || x.image_url;
        const lefts = leftItems.map((x, i) => ({ x, i })).filter(({ x }) => filled(x));
        const rights = rightItems.map((x, i) => ({ x, i })).filter(({ x }) => filled(x));
        for (let p = 0; p < lefts.length; p++) {
          const k = lefts[p].x.match;
          const rp = rights.findIndex(({ i }) => i === k);
          if (rp < 0) continue;
          const leftRow = rows.find(r => r.side === 'left' && r.order_index === p + 1);
          const rightRow = rows.find(r => r.side === 'right' && r.order_index === rp + 1);
          if (!leftRow || !rightRow) throw new Error('Не удалось сохранить ответы соответствия');
          await must(supabase.from('matching_items').update({ correct_match_id: rightRow.id }).eq('id', leftRow.id));
        }
      };

      const questionFields = {
        subject_id: subjectId,
        chapter_id: chapterId,
        topic_id: topicId,
        source_id: sourceId || null,
        // метку типа НЦТ меняет только главный админ; у остальных поле не трогаем
        ...(isOwner ? { nct_type: nctType || null } : {}),
        ...(isOwner ? { nct_difficulty: nctDifficulty ? Number(nctDifficulty) : null } : {}),
        type,
        content: primaryContent,
        content_ru: contentRu.trim() || null,
        content_tg: contentTg.trim() || null,
        image_url: imageUrl,
        correct_numeric_answer: numericVal,
        // Колонки текста пишем, только если они нужны: на базе без миграции остальные предметы сохраняются как прежде
        ...(withPassage || initialData?.passage_id
          ? { passage_id: withPassage ? passageId : null, passage_order: withPassage && passageOrder ? Number(passageOrder) : null }
          : {}),
      };

      if (initialData?.id) {
        // Обновление существующего вопроса. Порядок защищает от потери данных при сбое связи:
        // 1) вставляем новые варианты, 2) обновляем вопрос (проверка версии), 3) только потом удаляем старые.
        const oldOptionIds = (initialData.options || []).map(o => o.id);
        const oldItemIds = (initialData.matching_items || []).map(m => m.id);

        const insertRows = async (table: 'question_options' | 'matching_items', rows: any[]): Promise<any[]> => {
          const { data, error } = await supabase.from(table).insert(rows).select('*');
          if (error) throw error;
          return (data || []) as any[];
        };
        const newOptions = type === 'test' ? await insertRows('question_options', buildOptionRows(initialData.id)) : [];
        const newItems = type === 'matching' ? await insertRows('matching_items', buildItemRows(initialData.id)) : [];
        if (type === 'matching') {
          try {
            await applyMatches(newItems);
          } catch (e) {
            await supabase.from('matching_items').delete().in('id', newItems.map(x => x.id));
            throw e;
          }
        }
        const dropNew = async () => {
          const o = newOptions;
          const m = newItems;
          if (o.length) await supabase.from('question_options').delete().in('id', o.map(x => x.id));
          if (m.length) await supabase.from('matching_items').delete().in('id', m.map(x => x.id));
        };

        const { data: updatedQuestion, error: qErr } = await supabase
          .from('questions')
          .update({ ...questionFields, updated_by: user?.id, version: initialData.version + 1 })
          .eq('id', initialData.id)
          .eq('version', initialData.version)
          .select()
          .single();

        if (qErr || !updatedQuestion) {
          await dropNew();
          if (qErr && qErr.code !== 'PGRST116') throw qErr;
          throw new Error(
            'Конфликт одновременного редактирования! Вопрос был изменен другим пользователем. Обновите страницу.'
          );
        }

        // Старые варианты и элементы (и оставшиеся от прежнего типа вопроса) удаляем в последнюю очередь
        try {
          const oldOpts = type === 'test' ? oldOptionIds : null;
          const oldMatch = type === 'matching' ? oldItemIds : null;
          if (type === 'test') {
            if (oldOpts && oldOpts.length) await must(supabase.from('question_options').delete().in('id', oldOpts));
            await must(supabase.from('matching_items').delete().eq('question_id', initialData.id));
          } else if (type === 'matching') {
            if (oldMatch && oldMatch.length) await must(supabase.from('matching_items').delete().in('id', oldMatch));
            await must(supabase.from('question_options').delete().eq('question_id', initialData.id));
          } else {
            await must(supabase.from('question_options').delete().eq('question_id', initialData.id));
            await must(supabase.from('matching_items').delete().eq('question_id', initialData.id));
          }
        } catch (cleanupErr) {
          await dropNew();
          throw new Error('Вопрос сохранён, но варианты не обновились (ошибка связи). Обновите страницу и сохраните ещё раз.');
        }
      } else {
        // Создание нового вопроса
        const { data: newQ, error: qErr } = await supabase
          .from('questions')
          .insert({ ...questionFields, created_by: user?.id, version: 1 })
          .select()
          .single();

        if (qErr || !newQ) throw qErr;

        try {
          if (type === 'test') await must(supabase.from('question_options').insert(buildOptionRows(newQ.id)));
          if (type === 'matching') {
            const { data: created, error: insErr } = await supabase.from('matching_items').insert(buildItemRows(newQ.id)).select('*');
            if (insErr) throw insErr;
            await applyMatches(created || []);
          }
        } catch (childErr) {
          // Не оставляем вопрос без вариантов
          await supabase.from('questions').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', newQ.id);
          throw childErr;
        }

        // Запоминаем таксономию для следующего добавления
        localStorage.setItem('examiner_last_new_subject_id', subjectId);
        localStorage.setItem('examiner_last_new_chapter_id', chapterId);
        localStorage.setItem('examiner_last_new_topic_id', topicId);
        if (sourceId) localStorage.setItem('examiner_last_new_source_id', sourceId);
        localStorage.setItem('examiner_last_new_type', type);
      }
    },
    meta: { success: initialData?.id ? 'Изменения вопроса сохранены в базе' : 'Новый вопрос добавлен в базу' },
    onSuccess: (_data, next) => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      queryClient.invalidateQueries({ queryKey: ['question_counts'] });
      queryClient.invalidateQueries({ queryKey: ['passage_counts'] });
      clearDraft();
      if (next) resetForNext();
      else onSuccess();
    },
    onError: (err: any) => {
      setErrorMsg(describeError(err, 'Ошибка сохранения вопроса'));
    },
  });

  return saveMutation;
}
