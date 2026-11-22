// Импорт: сохранение партии вопросов в базу и откат партии.
import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAllPages } from '../../lib/fetchAllPages';
import { supabase } from '../../lib/supabase';
import { must, notifySuccess } from '../../lib/errors';
import { softDeletePassages } from '../../lib/passages';
import { uploadQuestionImage } from '../../lib/imageCompression';
import type { Subject, Chapter, Topic, Source } from '../../types/database';
import { isCorrectLetter, langFields, normText, parseNumericAnswer, type ImportLang, type ImportReport, type ParsedRow } from '../../lib/importParse';

interface Deps {
  user: { id: string } | null | undefined;
  /** Картинки из документов: временные blob-ссылки -> файлы */
  imagesRef: React.MutableRefObject<Map<string, File>>;
  setImportReport: (r: ImportReport | null) => void;
  setParsedRows: (rows: ParsedRow[]) => void;
  onSuccess: () => void;
}

export function useImportMutations({ user, imagesRef, setImportReport, setParsedRows, onSuccess }: Deps) {
  const queryClient = useQueryClient();

  // Сохранение проверенной партии в базу данных Supabase.
  // Каждая строка сохраняется независимо: ошибка одной не останавливает остальные и попадает в отчёт.
  // Уже имеющиеся в теме вопросы (тот же текст и варианты) пропускаются — повторный запуск не плодит дубли.
  const importMutation = useMutation({
    mutationFn: async (rowsToImport: ParsedRow[]): Promise<ImportReport> => {
      const report: ImportReport = { total: rowsToImport.length, inserted: 0, skipped: 0, failed: [] };

      const { data: batch, error: bErr } = await supabase
        .from('import_batches')
        .insert({
          created_by: user?.id,
          filename: `Партия от ${new Date().toLocaleDateString('ru-RU')} (${rowsToImport.length} вопр.)`,
          items_count: rowsToImport.length,
        })
        .select()
        .single();
      if (bErr || !batch) throw bErr;

      // Справочники читаем заново: глава или тема, добавленная в другом разделе за последние минуты,
      // иначе создалась бы второй раз
      const fresh = async <T,>(table: string): Promise<T[]> => {
        const { data, error } = await fetchAllPages<T>(() => supabase.from(table).select('*').eq('is_deleted', false));
        if (error) throw error;
        return data || [];
      };
      const [localSubjects, localChapters, localTopics, localSources] = await Promise.all([
        fresh<Subject>('subjects'), fresh<Chapter>('chapters'), fresh<Topic>('topics'), fresh<Source>('sources'),
      ]);

      // Картинки загружаем в хранилище только сейчас (и каждую один раз)
      const uploaded = new Map<string, string>();
      const resolveImage = async (url?: string | null): Promise<string | null> => {
        if (!url) return null;
        if (!url.startsWith('blob:')) return url;
        const cached = uploaded.get(url);
        if (cached) return cached;
        const file = imagesRef.current.get(url);
        if (!file) throw new Error('Рисунок документа потерян — разберите файл заново');
        const publicUrl = await uploadQuestionImage(file);
        uploaded.set(url, publicUrl);
        return publicUrl;
      };

      // Отпечатки уже имеющихся в теме вопросов
      const fingerprints = new Map<string, Set<string>>();
      const fingerprint = (content: string, opts: string[], items: string[]) =>
        [normText(content), opts.map(normText).join('|'), items.map(normText).join('|')].join('#');
      const loadFingerprints = async (topicId: string): Promise<Set<string>> => {
        const known = fingerprints.get(topicId);
        if (known) return known;
        const set = new Set<string>();
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .from('questions')
            .select('id, content, options:question_options(text, order_index), matching_items:matching_items(text, side, order_index)')
            .eq('topic_id', topicId)
            .eq('is_deleted', false)
            .order('id')
            .range(from, from + 999);
          if (error) throw error;
          for (const q of (data || []) as any[]) {
            const opts = [...(q.options || [])].sort((x, y) => x.order_index - y.order_index).map(o => o.text);
            const items = [...(q.matching_items || [])]
              .sort((x, y) => (x.side === y.side ? x.order_index - y.order_index : x.side < y.side ? -1 : 1))
              .map(m => m.text);
            set.add(fingerprint(q.content, opts, items));
          }
          if (!data || data.length < 1000) break;
        }
        fingerprints.set(topicId, set);
        return set;
      };

      const createTaxonomy = async <T,>(what: string, req: PromiseLike<{ data: T | null; error: any }>): Promise<T> => {
        const { data, error } = await req;
        if (error || !data) throw new Error(`не удалось создать ${what}: ${error?.message || 'нет прав'}`);
        return data;
      };

      interface Prepared {
        row: ParsedRow;
        topicId: string;
        key: string;
        question: Record<string, unknown>;
        options: Record<string, unknown>[];
        items: Record<string, unknown>[];
      }

      // Разбираем строку: раздел, источник, рисунки, строки вопроса/вариантов
      const prepare = async (row: ParsedRow): Promise<Prepared | null> => {
        const subj: Subject =
          localSubjects.find(s => s.name.toLowerCase() === row.subjectName.toLowerCase()) ||
          (await createTaxonomy<Subject>('предмет', supabase.from('subjects').insert({ name: row.subjectName }).select().single()).then(x => { localSubjects.push(x); return x; }));
        const chap: Chapter =
          localChapters.find(c => c.subject_id === subj.id && c.name.toLowerCase() === row.chapterName.toLowerCase()) ||
          (await createTaxonomy<Chapter>('главу', supabase.from('chapters').insert({ subject_id: subj.id, name: row.chapterName }).select().single()).then(x => { localChapters.push(x); return x; }));
        const top: Topic =
          localTopics.find(t => t.chapter_id === chap.id && t.name.toLowerCase() === row.topicName.toLowerCase()) ||
          (await createTaxonomy<Topic>('тему', supabase.from('topics').insert({ chapter_id: chap.id, name: row.topicName }).select().single()).then(x => { localTopics.push(x); return x; }));
        let src: Source | undefined = row.sourceName ? localSources.find(s => s.name.toLowerCase() === row.sourceName!.toLowerCase()) : undefined;
        if (row.sourceName && !src) {
          src = await createTaxonomy<Source>('источник', supabase.from('sources').insert({ name: row.sourceName }).select().single());
          localSources.push(src);
        }

        // Тексты вариантов/элементов в порядке документа
        let optionDefs: { text: string; textTg?: string; imageUrl?: string | null }[] = [];
        if (row.type === 'test') {
          optionDefs = row.rawOptions && row.rawOptions.length > 0
            ? row.rawOptions
            : (row.optionsText || '').split(/[|;]/).map(t => t.trim()).filter(Boolean).map(t => ({ text: t }));
        }
        let itemDefs: { side: 'left' | 'right'; text: string; text_tg?: string; image_url?: string | null; order_index: number }[] = [];
        if (row.type === 'matching') {
          if (row.rawMatchingItems && row.rawMatchingItems.length > 0) {
            itemDefs = row.rawMatchingItems;
          } else if (row.matchingText) {
            const [leftPart, rightPart] = row.matchingText.split('||');
            const split = (x?: string) => (x || '').split(';').map(t => t.trim()).filter(Boolean);
            itemDefs = [
              ...split(leftPart).map((l, i) => ({ side: 'left' as const, text: l.replace(/^[А-ЯA-Z]:\s*/i, ''), order_index: i + 1 })),
              ...split(rightPart).map((r, i) => ({ side: 'right' as const, text: r.replace(/^[0-9]+:\s*/, ''), order_index: i + 1 })),
            ];
          }
        }

        const set = await loadFingerprints(top.id);
        const key = fingerprint(
          row.content,
          optionDefs.map(o => o.text),
          [...itemDefs].sort((x, y) => (x.side === y.side ? x.order_index - y.order_index : x.side < y.side ? -1 : 1)).map(m => m.text)
        );
        if (set.has(key)) return null; // дубль

        const bilingual = row.contentTg !== undefined;
        const lang: ImportLang = row.lang || 'ru';
        const imageUrl = await resolveImage(row.imageUrl);
        const optionRows: Record<string, unknown>[] = [];
        for (let i = 0; i < optionDefs.length; i++) {
          const o = optionDefs[i];
          optionRows.push({
            ...langFields(lang, o.text, bilingual ? (o.textTg ?? '') : undefined),
            image_url: await resolveImage(o.imageUrl),
            is_correct: isCorrectLetter(row.correctAnswer, i),
            order_index: i + 1,
          });
        }
        const itemRows: Record<string, unknown>[] = [];
        for (const m of itemDefs) {
          itemRows.push({
            side: m.side,
            ...langFields(lang, m.text, bilingual ? (m.text_tg ?? '') : undefined),
            image_url: await resolveImage(m.image_url),
            order_index: m.order_index,
          });
        }

        return {
          row,
          topicId: top.id,
          key,
          question: {
            batch_id: batch.id,
            subject_id: subj.id,
            chapter_id: chap.id,
            topic_id: top.id,
            source_id: src?.id || null,
            type: row.type,
            content: row.content || row.contentTg || '',
            content_ru: lang === 'tg' && !bilingual ? null : row.content || null,
            content_tg: bilingual ? row.contentTg || null : lang === 'tg' ? row.content : null,
            image_url: imageUrl,
            correct_numeric_answer: row.type === 'open' ? parseNumericAnswer(row.correctAnswer) : null,
            created_by: user?.id,
            version: 1,
          },
          options: optionRows,
          items: itemRows,
        };
      };

      // Пишем пачку вопросов одним запросом; при любой ошибке откатываем пачку и повторяем по одному
      const writeChunk = async (chunk: Prepared[]): Promise<void> => {
        const { data: ins, error } = await supabase.from('questions').insert(chunk.map(c => c.question)).select('id');
        let ids: string[] = [];
        try {
          if (error || !ins || ins.length !== chunk.length) throw error || new Error('база вернула не все строки');
          ids = ins.map((x: any) => x.id);
          const opts = chunk.flatMap((c, i) => c.options.map(o => ({ ...o, question_id: ids[i] })));
          const items = chunk.flatMap((c, i) => c.items.map(o => ({ ...o, question_id: ids[i] })));
          if (opts.length) await must(supabase.from('question_options').insert(opts));
          if (items.length) await must(supabase.from('matching_items').insert(items));
        } catch (e: any) {
          const toDrop = ids.length ? ids : (ins || []).map((x: any) => x.id);
          if (toDrop.length) {
            await supabase.from('questions').update({ is_deleted: true, deleted_at: new Date().toISOString() }).in('id', toDrop);
          }
          if (chunk.length === 1) throw e;
          for (const one of chunk) await writeChunk([one]).catch((err: any) => {
            report.failed.push({ rowNum: one.row.rowNum, message: err?.message || String(err) });
          });
          return;
        }
        chunk.forEach(c => fingerprints.get(c.topicId)?.add(c.key));
        report.inserted += chunk.length;
      };

      const pending: Prepared[] = [];
      const flush = async () => {
        const chunk = pending.splice(0, pending.length);
        if (chunk.length) {
          await writeChunk(chunk).catch((err: any) => {
            report.failed.push({ rowNum: chunk[0].row.rowNum, message: err?.message || String(err) });
          });
        }
      };

      for (const row of rowsToImport) {
        try {
          const prepared = await prepare(row);
          if (!prepared) { report.skipped++; continue; }
          // Одинаковые строки внутри самого файла тоже считаем дублями
          if (pending.some(p => p.key === prepared.key && p.topicId === prepared.topicId)) { report.skipped++; continue; }
          pending.push(prepared);
          if (pending.length >= 50) await flush();
        } catch (e: any) {
          report.failed.push({ rowNum: row.rowNum, message: e?.message || String(e) });
        }
      }
      await flush();

      await supabase.from('import_batches').update({ items_count: report.inserted }).eq('id', batch.id);
      return report;
    },
    meta: { action: 'Не удалось выполнить импорт' },
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      queryClient.invalidateQueries({ queryKey: ['question_counts'] });
      queryClient.invalidateQueries({ queryKey: ['passage_counts'] });
      queryClient.invalidateQueries({ queryKey: ['import_batches'] });
      queryClient.invalidateQueries({ queryKey: ['pool_stats'] });
      // Импорт мог создать предмет, главу, тему или источник: обновляем списки во всех разделах
      for (const key of ['all_chapters', 'all_topics', 'subjects', 'chapters', 'topics', 'topics_for_generation', 'sources']) queryClient.invalidateQueries({ queryKey: [key] });
      // Картинки из Word больше не нужны: освобождаем память
      imagesRef.current.forEach((_f, url) => { try { URL.revokeObjectURL(url); } catch { /* не страшно */ } });
      imagesRef.current.clear();
      setImportReport(report);
      if (report.failed.length === 0 && report.skipped === 0) {
        notifySuccess(`Импорт завершён: добавлено вопросов — ${report.inserted}`);
        onSuccess();
      } else {
        // Есть пропуски или ошибки — остаёмся на странице, показываем отчёт
        setParsedRows([]);
      }
    },
  });

  const revertBatchMutation = useMutation({
    mutationFn: async (batchId: string) => {
      await must(supabase.from('questions').update({ is_deleted: true }).eq('batch_id', batchId).eq('is_deleted', false));
      await softDeletePassages({ batchId }); // тексты партии (английский); без таблицы ничего не делает
      await must(supabase.from('import_batches').update({ is_reverted: true }).eq('id', batchId));
    },
    meta: { action: 'Не удалось откатить импорт', success: 'Импорт отменён: вопросы партии удалены из базы' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['passages'] });
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      queryClient.invalidateQueries({ queryKey: ['question_counts'] });
      queryClient.invalidateQueries({ queryKey: ['passage_counts'] });
      queryClient.invalidateQueries({ queryKey: ['import_batches'] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
  });

  return { importMutation, revertBatchMutation };
}
