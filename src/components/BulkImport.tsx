import React, { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { must } from '../lib/errors';
import { Subject, Chapter, Topic, Source, QuestionType } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { parseDocxFile } from '../lib/docxImport';
import { FormattedText } from './FormulaEditor';
import { 
  Upload, 
  FileSpreadsheet, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  Trash2, 
  Loader2,
  Undo2,
  Image as ImageIcon,
  X,
  Sparkles,
  Layers
} from 'lucide-react';

interface ParsedRow {
  rowNum: number;
  type: QuestionType;
  content: string;
  imageUrl?: string | null;
  subjectName: string;
  chapterName: string;
  topicName: string;
  sourceName?: string;
  optionsText?: string;
  rawOptions?: { text: string; imageUrl?: string | null }[];
  matchingText?: string;
  rawMatchingItems?: { side: 'left' | 'right'; text: string; image_url?: string | null; order_index: number }[];
  correctAnswer?: string;
  section?: string;
  errors: string[];
}

function parseNumericAnswer(raw?: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(',', '.').replace(/\s+/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isCorrectLetter(answer: string | undefined, optionIndex: number): boolean {
  return !!answer && answer.trim().toUpperCase() === 'ABCDEF'[optionIndex];
}

export const BulkImport: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const queryClient = useQueryClient();
  const { user, isAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState<'file' | 'text' | 'history'>('file');
  const [pastedText, setPastedText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState('');

  // Таксономия по умолчанию для импорта (сохраняется в localStorage)
  const [defaultSubjectId, setDefaultSubjectId] = useState(
    () => localStorage.getItem('examiner_import_subject_id') || ''
  );
  const [defaultChapterId, setDefaultChapterId] = useState(
    () => localStorage.getItem('examiner_import_chapter_id') || ''
  );
  const [defaultTopicId, setDefaultTopicId] = useState(
    () => localStorage.getItem('examiner_import_topic_id') || ''
  );

  React.useEffect(() => {
    localStorage.setItem('examiner_import_subject_id', defaultSubjectId);
  }, [defaultSubjectId]);

  React.useEffect(() => {
    localStorage.setItem('examiner_import_chapter_id', defaultChapterId);
  }, [defaultChapterId]);

  React.useEffect(() => {
    localStorage.setItem('examiner_import_topic_id', defaultTopicId);
  }, [defaultTopicId]);

  // Справочники
  const { data: subjects = [] } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data } = await supabase.from('subjects').select('*').eq('is_deleted', false).order('name');
      return (data || []) as Subject[];
    },
  });

  const { data: chapters = [] } = useQuery({
    queryKey: ['all_chapters'],
    queryFn: async () => {
      const { data } = await supabase.from('chapters').select('*').eq('is_deleted', false).order('order_index');
      return (data || []) as Chapter[];
    },
  });

  const { data: topics = [] } = useQuery({
    queryKey: ['all_topics'],
    queryFn: async () => {
      const { data } = await supabase.from('topics').select('*').eq('is_deleted', false).order('order_index');
      return (data || []) as Topic[];
    },
  });

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data } = await supabase.from('sources').select('*').eq('is_deleted', false);
      return (data || []) as Source[];
    },
  });

  // Автовыбор первого предмета при первом запуске
  React.useEffect(() => {
    if (!defaultSubjectId && subjects.length > 0) {
      setDefaultSubjectId(subjects[0].id);
    }
  }, [subjects, defaultSubjectId]);

  const availableChapters = chapters.filter(c => !defaultSubjectId || c.subject_id === defaultSubjectId);
  const availableTopics = topics.filter(t => !defaultChapterId || t.chapter_id === defaultChapterId);

  // Найти текущие имена для назначения
  const getTaxonomyNames = () => {
    const subj = subjects.find(s => s.id === defaultSubjectId) || subjects[0];
    const chap = availableChapters.find(c => c.id === defaultChapterId) || availableChapters[0] || chapters[0];
    const top = availableTopics.find(t => t.id === defaultTopicId) || availableTopics[0] || topics[0];
    return {
      subjectName: subj?.name || 'Химия',
      chapterName: chap?.name || 'Общая химия',
      topicName: top?.name || 'Общие вопросы',
    };
  };

  // Парсинг сырых строковых данных (из CSV или Excel)
  const validateAndProcessRawData = (rows: any[]) => {
    const { subjectName: defSubj, chapterName: defChap, topicName: defTop } = getTaxonomyNames();
    const processed: ParsedRow[] = [];

    rows.forEach((row, idx) => {
      // Поддержка русских и английских названий колонок
      const typeRaw = (row['Тип вопроса'] || row['Type'] || row['type'] || 'test').toString().trim().toLowerCase();
      const content = (row['Текст вопроса'] || row['Question'] || row['content'] || '').toString().trim();
      const subjectName = (row['Предмет'] || row['Subject'] || row['subject'] || defSubj).toString().trim();
      const chapterName = (row['Глава'] || row['Chapter'] || row['chapter'] || defChap).toString().trim();
      const topicName = (row['Тема'] || row['Topic'] || row['topic'] || defTop).toString().trim();
      const sourceName = (row['Источник'] || row['Source'] || row['source'] || '').toString().trim();
      const optionsText = (row['Варианты ответа'] || row['Options'] || row['options'] || '').toString().trim();
      const matchingText = (row['Элементы соответствия'] || row['Matching'] || row['matching'] || '').toString().trim();
      const correctAnswer = (row['Ответ'] || row['Answer'] || row['answer'] || '').toString().trim();

      if (!content && !subjectName) return; // Пропуск пустых строк

      const errors: string[] = [];
      let type: QuestionType = 'test';
      if (typeRaw === 'test' || typeRaw === 'тест') type = 'test';
      else if (typeRaw === 'matching' || typeRaw === 'соответствие') type = 'matching';
      else if (typeRaw === 'open' || typeRaw === 'открытый') type = 'open';
      else errors.push(`Неизвестный тип вопроса "${typeRaw}". Разрешены: test, matching, open`);

      if (!content) errors.push('Отсутствует текст вопроса');
      if (!subjectName) errors.push('Не указан предмет');
      if (!chapterName) errors.push('Не указана глава');
      if (!topicName) errors.push('Не указана тема');

      if (type === 'test') {
        const opts = optionsText.split(/[|;]/).map((s: string) => s.trim()).filter(Boolean);
        if (opts.length < 2) errors.push('Для теста нужно минимум 2 варианта ответа (через разделитель | или ;)');
      }

      if (type === 'matching') {
        if (!matchingText.includes('||')) {
          errors.push('Для соответствия разделите левую и правую части знаками "||"');
        }
      }

      processed.push({
        rowNum: idx + 1,
        type,
        content,
        subjectName,
        chapterName,
        topicName,
        sourceName,
        optionsText,
        matchingText,
        correctAnswer,
        errors,
      });
    });

    setParsedRows(processed);
  };

  // Загрузка файла (.docx / .xlsx / .xls / .csv)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setGlobalError(null);
    setStatusMessage(null);
    setSectionFilter('');

    const isDocx = file.name.endsWith('.docx');
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

    // 1. ИМПОРТ ИЗ WORD (.DOCX) С АВТОМАТИЧЕСКИМ ИЗВЛЕЧЕНИЕМ ИЗОБРАЖЕНИЙ
    if (isDocx) {
      try {
        const docxQuestions = await parseDocxFile(file, (msg) => setStatusMessage(msg));
        const { subjectName, chapterName, topicName } = getTaxonomyNames();
        const sourceName = file.name.replace(/\.[^/.]+$/, '');

        const processed: ParsedRow[] = docxQuestions.map((q, idx) => {
          const errors: string[] = [];
          if (!q.content && !q.imageUrl) errors.push('Отсутствует текст и рисунок вопроса');
          if (q.type === 'test' && (!q.options || q.options.length < 2)) {
            errors.push('Меньше 2 вариантов ответа');
          }

          return {
            rowNum: idx + 1,
            type: q.type,
            content: q.content,
            imageUrl: q.imageUrl || null,
            subjectName,
            chapterName,
            topicName,
            sourceName,
            optionsText: q.options ? q.options.map(o => o.text).join(' | ') : '',
            rawOptions: q.options,
            rawMatchingItems: q.matchingItems ? q.matchingItems.map(m => ({
              side: m.side,
              text: m.text,
              image_url: m.imageUrl || null,
              order_index: m.orderIndex,
            })) : undefined,
            correctAnswer: q.correctAnswer || '',
            section: q.section || undefined,
            errors,
          };
        });

        setParsedRows(processed);
      } catch (err: any) {
        setGlobalError('Ошибка импорта Word (.docx): ' + (err.message || String(err)));
      } finally {
        setIsProcessing(false);
        setStatusMessage(null);
      }
      return;
    }

    // 2. ИМПОРТ ИЗ EXCEL
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json(ws);
          validateAndProcessRawData(data);
        } catch (err: any) {
          setGlobalError('Ошибка чтения Excel: ' + err.message);
        } finally {
          setIsProcessing(false);
        }
      };
      reader.readAsBinaryString(file);
    } else {
      // 3. ИМПОРТ ИЗ CSV
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          validateAndProcessRawData(results.data);
          setIsProcessing(false);
        },
        error: (err) => {
          setGlobalError('Ошибка парсинга CSV: ' + err.message);
          setIsProcessing(false);
        },
      });
    }
  };

  // Парсинг вставленного текста
  const handleParseText = () => {
    setIsProcessing(true);
    Papa.parse(pastedText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        validateAndProcessRawData(results.data);
        setIsProcessing(false);
      },
      error: (err: any) => {
        setGlobalError('Ошибка парсинга текста: ' + err.message);
        setIsProcessing(false);
      },
    });
  };

  // Применить выбранную таксономию ко всем строкам предпросмотра
  const handleApplyTaxonomyToAll = () => {
    const { subjectName, chapterName, topicName } = getTaxonomyNames();
    setParsedRows(prev =>
      prev.map(r => ({
        ...r,
        subjectName,
        chapterName,
        topicName,
      }))
    );
  };

  // Скачивание готового шаблона Excel
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Тип вопроса': 'test',
        'Текст вопроса': 'Какая формула у серной кислоты?',
        'Варианты ответа': 'H2SO4 | HCl | HNO3 | H3PO4',
        'Элементы соответствия': '',
        'Ответ': '',
        'Предмет': 'Химия',
        'Глава': 'Неорганическая химия',
        'Тема': 'Кислоты и основания',
        'Источник': 'Демоверсия 2025',
      },
      {
        'Тип вопроса': 'matching',
        'Текст вопроса': 'Установите соответствие между формулой и классом веществ',
        'Варианты ответа': '',
        'Элементы соответствия': 'А: NaOH; Б: H2SO4; В: NaCl || 1: Кислота; 2: Основание; 3: Соль; 4: Оксид',
        'Ответ': '',
        'Предмет': 'Химия',
        'Глава': 'Неорганическая химия',
        'Тема': 'Классификация веществ',
        'Источник': 'Сборник Кузьменко',
      },
      {
        'Тип вопроса': 'open',
        'Текст вопроса': 'Определите молярную массу метана CH4 (г/моль)',
        'Варианты ответа': '',
        'Элементы соответствия': '',
        'Ответ': '16',
        'Предмет': 'Химия',
        'Глава': 'Органическая химия',
        'Тема': 'Алканы',
        'Источник': 'ЕГЭ 2024',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Шаблон');
    XLSX.writeFile(wb, 'shablon_voprosov.xlsx');
  };

  // Сохранение проверенной партии в базу данных Supabase
  const importMutation = useMutation({
    mutationFn: async (rowsToImport: ParsedRow[]) => {
      // 1. Создаем запись партии
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

      // Кэши справочников для быстрого разрешения ID
      let localSubjects = [...subjects];
      let localChapters = [...chapters];
      let localTopics = [...topics];
      let localSources = [...sources];

      for (const row of rowsToImport) {
        // Предмет
        let subj = localSubjects.find(s => s.name.toLowerCase() === row.subjectName.toLowerCase());
        if (!subj) {
          const { data: newS } = await supabase.from('subjects').insert({ name: row.subjectName }).select().single();
          if (newS) { subj = newS; localSubjects.push(newS); }
        }

        // Глава
        let chap = localChapters.find(c => c.subject_id === subj?.id && c.name.toLowerCase() === row.chapterName.toLowerCase());
        if (!chap && subj) {
          const { data: newC } = await supabase.from('chapters').insert({ subject_id: subj.id, name: row.chapterName }).select().single();
          if (newC) { chap = newC; localChapters.push(newC); }
        }

        // Тема
        let top = localTopics.find(t => t.chapter_id === chap?.id && t.name.toLowerCase() === row.topicName.toLowerCase());
        if (!top && chap) {
          const { data: newT } = await supabase.from('topics').insert({ chapter_id: chap.id, name: row.topicName }).select().single();
          if (newT) { top = newT; localTopics.push(newT); }
        }

        // Источник
        let src = row.sourceName ? localSources.find(s => s.name.toLowerCase() === row.sourceName!.toLowerCase()) : null;
        if (row.sourceName && !src) {
          const { data: newSrc } = await supabase.from('sources').insert({ name: row.sourceName }).select().single();
          if (newSrc) { src = newSrc; localSources.push(newSrc); }
        }

        if (!subj || !chap || !top) continue;

        // Вставляем вопрос с сохранением картинки
        const { data: q, error: qErr } = await supabase
          .from('questions')
          .insert({
            batch_id: batch.id,
            subject_id: subj.id,
            chapter_id: chap.id,
            topic_id: top.id,
            source_id: src?.id || null,
            type: row.type,
            content: row.content,
            content_ru: row.content,
            image_url: row.imageUrl || null,
            correct_numeric_answer: row.type === 'open' ? parseNumericAnswer(row.correctAnswer) : null,
            created_by: user?.id,
            version: 1,
          })
          .select()
          .single();

        if (qErr || !q) continue;

        // Вставляем варианты тестового вопроса
        if (row.type === 'test') {
          if (row.rawOptions && row.rawOptions.length > 0) {
            const optionRows = row.rawOptions.map((opt, i) => ({
              question_id: q.id,
              text: opt.text,
              text_ru: opt.text,
              image_url: opt.imageUrl || null,
              is_correct: isCorrectLetter(row.correctAnswer, i),
              order_index: i + 1,
            }));
            await must(supabase.from('question_options').insert(optionRows));
          } else if (row.optionsText) {
            const opts = row.optionsText.split(/[|;]/).map(s => s.trim()).filter(Boolean);
            const optionRows = opts.map((optText, i) => ({
              question_id: q.id,
              text: optText,
              text_ru: optText,
              is_correct: isCorrectLetter(row.correctAnswer, i),
              order_index: i + 1,
            }));
            await must(supabase.from('question_options').insert(optionRows));
          }
        }

        // Вставляем элементы задания на соответствие
        if (row.type === 'matching') {
          if (row.rawMatchingItems && row.rawMatchingItems.length > 0) {
            const allItems = row.rawMatchingItems.map((m) => ({
              question_id: q.id,
              side: m.side,
              text: m.text,
              text_ru: m.text,
              image_url: m.image_url || null,
              order_index: m.order_index,
            }));
            await must(supabase.from('matching_items').insert(allItems));
          } else if (row.matchingText) {
            const [leftPart, rightPart] = row.matchingText.split('||');
            const leftItems = (leftPart || '').split(/[;]/).map(s => s.trim()).filter(Boolean);
            const rightItems = (rightPart || '').split(/[;]/).map(s => s.trim()).filter(Boolean);

            const allItems = [
              ...leftItems.map((l, i) => ({
                question_id: q.id,
                side: 'left' as const,
                text: l.replace(/^[А-ЯA-Z]:\s*/i, ''),
                text_ru: l.replace(/^[А-ЯA-Z]:\s*/i, ''),
                order_index: i + 1,
              })),
              ...rightItems.map((r, i) => ({
                question_id: q.id,
                side: 'right' as const,
                text: r.replace(/^[0-9]+:\s*/, ''),
                text_ru: r.replace(/^[0-9]+:\s*/, ''),
                order_index: i + 1,
              })),
            ];
            await must(supabase.from('matching_items').insert(allItems));
          }
        }
      }
    },
    meta: { action: 'Не удалось выполнить импорт', success: 'Импорт завершён: вопросы добавлены в базу' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      queryClient.invalidateQueries({ queryKey: ['import_batches'] });
      onSuccess();
    },
  });

  // История партий и откат для администратора
  const { data: batches = [] } = useQuery({
    queryKey: ['import_batches'],
    enabled: activeTab === 'history',
    queryFn: async () => {
      const { data } = await supabase.from('import_batches').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const revertBatchMutation = useMutation({
    mutationFn: async (batchId: string) => {
      await must(supabase.from('questions').update({ is_deleted: true }).eq('batch_id', batchId));
      await must(supabase.from('import_batches').update({ is_reverted: true }).eq('id', batchId));
    },
    meta: { action: 'Не удалось откатить импорт', success: 'Импорт отменён: вопросы партии удалены из базы' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      queryClient.invalidateQueries({ queryKey: ['import_batches'] });
    },
  });

  const sectionNames = Array.from(new Set(parsedRows.map(r => r.section).filter((x): x is string => !!x)));
  const visibleRows = sectionFilter ? parsedRows.filter(r => r.section === sectionFilter) : parsedRows;
  const validRows = visibleRows.filter(r => r.errors.length === 0);
  const errorRowsCount = visibleRows.filter(r => r.errors.length > 0).length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden max-w-5xl mx-auto my-6">
      {/* Header */}
      <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <Upload className="w-5 h-5 mr-2 text-blue-600" />
            Импорт вопросов (Word .docx, Excel, CSV)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Прямой импорт документов Word с автоматическим извлечением картинок и формул
          </p>
        </div>

        <button
          onClick={handleDownloadTemplate}
          className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-300 shadow-sm flex items-center space-x-1.5 transition"
        >
          <Download className="w-4 h-4 text-emerald-600" />
          <span>Скачать шаблон Excel</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 px-6 bg-white text-xs font-semibold">
        <button
          onClick={() => setActiveTab('file')}
          className={`py-3 px-4 border-b-2 transition flex items-center space-x-1.5 ${
            activeTab === 'file' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Word (.docx) / Excel / CSV</span>
        </button>
        <button
          onClick={() => setActiveTab('text')}
          className={`py-3 px-4 border-b-2 transition flex items-center space-x-1.5 ${
            activeTab === 'text' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Вставка текста</span>
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 px-4 border-b-2 transition flex items-center space-x-1.5 ${
              activeTab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>История партий и откат</span>
          </button>
        )}
      </div>

      <div className="p-6 space-y-6">
        {globalError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {globalError}
          </div>
        )}

        {/* Панель выбора раздела по умолчанию (для документов Word и общих таблиц) */}
        {activeTab !== 'history' && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center">
                <Layers className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                Раздел для вопросов (по умолчанию):
              </span>
              {parsedRows.length > 0 && (
                <button
                  type="button"
                  onClick={handleApplyTaxonomyToAll}
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold underline"
                >
                  Применить ко всем ({parsedRows.length})
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Предмет</label>
                <select
                  value={defaultSubjectId}
                  onChange={(e) => {
                    setDefaultSubjectId(e.target.value);
                    setDefaultChapterId('');
                    setDefaultTopicId('');
                  }}
                  className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Глава</label>
                <select
                  value={defaultChapterId}
                  onChange={(e) => {
                    setDefaultChapterId(e.target.value);
                    setDefaultTopicId('');
                  }}
                  className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Выберите главу --</option>
                  {availableChapters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Тема</label>
                <select
                  value={defaultTopicId}
                  onChange={(e) => setDefaultTopicId(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Выберите тему --</option>
                  {availableTopics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Вкладка 1: Файл (Word / Excel / CSV) */}
        {activeTab === 'file' && (
          <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center bg-slate-50 hover:bg-slate-100/60 transition cursor-pointer relative">
            <input
              type="file"
              accept=".docx, .xlsx, .xls, .csv, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
              onChange={handleFileUpload}
              disabled={isProcessing}
              className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            {isProcessing ? (
              <div className="space-y-2 py-4">
                <Loader2 className="w-10 h-10 text-blue-600 mx-auto animate-spin" />
                <p className="font-bold text-slate-800 text-sm">Обработка документа...</p>
                {statusMessage && <p className="text-xs text-blue-600 font-medium">{statusMessage}</p>}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-center space-x-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 shadow-sm">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-sm">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                </div>
                <p className="font-bold text-slate-800 text-sm">
                  Нажмите для выбора файла Word (.docx), Excel или CSV
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Картинки из файлов Word (.docx) извлекаются, сжимаются и прикрепляются к вопросам автоматически!
                </p>
              </>
            )}
          </div>
        )}

        {/* Вкладка 2: Текст */}
        {activeTab === 'text' && (
          <div className="space-y-3">
            <textarea
              rows={6}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Вставьте таблицу с заголовками (например, скопированную из Excel или CSV)..."
              className="w-full p-3 font-mono text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleParseText}
              disabled={!pastedText.trim() || isProcessing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              Распознать и проверить текст
            </button>
          </div>
        )}

        {/* Вкладка 3: История партий (для админа) */}
        {activeTab === 'history' && (
          <div className="space-y-3">
            <h3 className="font-semibold text-slate-900 text-sm">Ранее загруженные партии вопросов</h3>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {batches.map((b: any) => (
                <div key={b.id} className="p-4 flex items-center justify-between bg-white hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-xs text-slate-900">{b.filename}</div>
                    <div className="text-[11px] text-slate-400">
                      Вопросов: {b.items_count} • Дата: {new Date(b.created_at).toLocaleString('ru-RU')}
                    </div>
                  </div>
                  <div>
                    {b.is_reverted ? (
                      <span className="text-xs text-slate-400 font-medium">Откачено</span>
                    ) : (
                      <button
                        onClick={() => {
                          if (confirm(`Откатить эту партию (${b.items_count} вопр.)? Все они будут скрыты.`)) {
                            revertBatchMutation.mutate(b.id);
                          }
                        }}
                        className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 border border-red-200 rounded-lg flex items-center space-x-1 font-semibold"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>Откатить партию</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Предпросмотр распознанных строк */}
        {parsedRows.length > 0 && activeTab !== 'history' && (
          <div className="space-y-4 pt-4 border-t border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Предварительный просмотр перед сохранением</h3>
                <p className="text-xs text-slate-500">
                  Готово к импорту: <span className="font-bold text-emerald-600">{validRows.length}</span> • 
                  Ошибок: <span className="font-bold text-red-600">{errorRowsCount}</span>
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setParsedRows([])}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg"
                >
                  Очистить
                </button>
                <button
                  onClick={() => importMutation.mutate(validRows)}
                  disabled={validRows.length === 0 || importMutation.isPending}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {importMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Импортировать в базу ({validRows.length})</span>
                </button>
              </div>
            </div>

            {sectionNames.length > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <label className="font-semibold text-slate-600 shrink-0">Раздел документа:</label>
                <select
                  value={sectionFilter}
                  onChange={(e) => setSectionFilter(e.target.value)}
                  className="flex-1 min-w-0 text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Все разделы ({parsedRows.length} вопр.)</option>
                  {sectionNames.map(name => (
                    <option key={name} value={name}>
                      {name} ({parsedRows.filter(r => r.section === name).length})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
              {visibleRows.map((r, i) => (
                <div key={i} className={`p-3 ${r.errors.length > 0 ? 'bg-red-50/50' : 'bg-white'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-slate-400 font-semibold">#{r.rowNum}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          r.type === 'test' ? 'bg-blue-100 text-blue-800' : r.type === 'matching' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {r.type === 'test' ? 'Тест' : r.type === 'matching' ? 'Соответствие' : 'Открытый'}
                        </span>
                        <div className="font-semibold text-slate-800 leading-snug">
                          <FormattedText text={r.content} />
                        </div>
                      </div>

                      {r.errors.length > 0 ? (
                        <div className="mt-1 text-red-600 text-[11px] flex items-center space-x-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{r.errors.join('; ')}</span>
                        </div>
                      ) : (
                        <div className="mt-1 text-slate-500 text-[11px]">
                          {r.type === 'test' && r.rawOptions && (
                            <div className="flex flex-wrap gap-2 pt-0.5">
                              {r.rawOptions.map((opt, oIdx) => (
                                <span key={oIdx} className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                                  <strong className="mr-1">{['A', 'B', 'C', 'D', 'E'][oIdx] || String(oIdx + 1)})</strong>
                                  <FormattedText text={opt.text} />
                                  {opt.imageUrl && <ImageIcon className="w-3 h-3 text-blue-500 ml-1 inline" />}
                                </span>
                              ))}
                            </div>
                          )}
                          {r.type === 'test' && !r.rawOptions && r.optionsText && (
                            <span>Варианты: {r.optionsText}</span>
                          )}
                          {r.type === 'test' && r.correctAnswer && (
                            <div className="pt-0.5">Ответ: <strong className="text-slate-700">{r.correctAnswer}</strong></div>
                          )}
                          {r.type === 'matching' && r.rawMatchingItems && (
                            <span className="text-purple-700 font-medium">
                              Элементов соответствия: {r.rawMatchingItems.length} (ABCD / 12345)
                            </span>
                          )}
                          {r.type === 'open' && (
                            <span>Ответ: <strong className="text-slate-700">{r.correctAnswer || 'не указан'}</strong></span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-3 shrink-0">
                      {r.imageUrl && (
                        <img
                          src={r.imageUrl}
                          alt="Изображение"
                          onClick={() => setPreviewImage(r.imageUrl || null)}
                          className="w-12 h-12 object-contain rounded-lg border border-slate-200 bg-slate-50 p-0.5 cursor-pointer hover:opacity-90 hover:scale-105 transition shadow-sm"
                          title="Нажмите для просмотра"
                        />
                      )}
                      <div className="text-[11px] text-slate-400 text-right">
                        <div>{r.subjectName}</div>
                        <div className="text-[10px] text-slate-300">{r.chapterName}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Модальное окно увеличения картинки (Lightbox) */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-11 right-0 text-white hover:text-slate-300 p-2 rounded-full bg-black/50 hover:bg-black/75 transition"
              title="Закрыть (Esc)"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={previewImage}
              alt="Увеличенное изображение"
              className="max-h-[85vh] max-w-full rounded-2xl shadow-2xl object-contain border border-white/20 bg-white p-2"
            />
          </div>
        </div>
      )}
    </div>
  );
};
